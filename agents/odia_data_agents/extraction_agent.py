"""
extraction_agent.py — Agent 2: Odia Extraction and Cleaning Agent.
Extracts HTML and PDF content, cleans boilerplate, validates Odia Unicode content,
deduplicates via SHA-256 content hashes, and safely tracks skipped items.
"""

import io
import re
import json
import hashlib
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Set, Any, Optional, Tuple

from bs4 import BeautifulSoup

from .config import AgentConfig
from .security import safe_http_get

logger = logging.getLogger(__name__)

# Odia Unicode block: U+0B00 to U+0B7F
ODIA_CHAR_REGEX = re.compile(r"[\u0B00-\u0B7F]")


def compute_odia_metrics(text: str) -> Dict[str, Any]:
    """Calculates character counts and Odia script prevalence ratio."""
    if not text:
        return {"total_chars": 0, "odia_chars": 0, "odia_ratio": 0.0, "has_odia": False}

    non_space_chars = len(re.sub(r"\s+", "", text))
    if non_space_chars == 0:
        return {"total_chars": 0, "odia_chars": 0, "odia_ratio": 0.0, "has_odia": False}

    odia_matches = ODIA_CHAR_REGEX.findall(text)
    odia_count = len(odia_matches)
    ratio = round(odia_count / non_space_chars, 4)

    return {
        "total_chars": len(text),
        "non_space_chars": non_space_chars,
        "odia_chars": odia_count,
        "odia_ratio": ratio,
        "has_odia": odia_count > 0,
    }


def compute_content_hash(text: str) -> str:
    """Produces deterministic SHA-256 hash of normalized whitespace text."""
    normalized = re.sub(r"\s+", " ", text.strip().lower())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


class ExtractionAgent:
    """
    Extracts text from web pages or PDFs, preserves Odia Unicode fidelity,
    deduplicates documents, and segregates accepted vs rejected records.
    """

    def __init__(self, config: Optional[AgentConfig] = None):
        self.config = config or AgentConfig()
        self.accepted_documents: List[Dict[str, Any]] = []
        self.failed_or_skipped: List[Dict[str, Any]] = []
        self.seen_hashes: Set[str] = set()

    def clean_html(self, html_bytes: bytes, url: str) -> Tuple[Optional[str], Optional[str]]:
        """Cleans boilerplate tags and extracts structured title and paragraph content."""
        try:
            # Decode bytes to str directly to bypass charset_normalizer crash on Python 3.15 Windows
            if isinstance(html_bytes, bytes):
                html_text = html_bytes.decode("utf-8", errors="replace")
            else:
                html_text = str(html_bytes)

            soup = BeautifulSoup(html_text, "html.parser")

            # Remove unwanted tags
            for s in soup(["script", "style", "noscript", "iframe", "header", "footer", "nav", "svg", "form", "aside"]):
                s.decompose()

            title_tag = soup.find("title")
            title = title_tag.get_text().strip() if title_tag else "Untitled"

            paragraphs = []
            for element in soup.find_all(["h1", "h2", "h3", "h4", "p", "li", "blockquote"]):
                txt = element.get_text().strip()
                if len(txt) > 15:
                    paragraphs.append(txt)

            content = "\n\n".join(paragraphs).strip()
            if not content or len(content) < 50:
                content = re.sub(r"\s+", " ", soup.get_text()).strip()

            return title, content
        except Exception as e:
            logger.warning(f"HTML parsing failed for {url}: {e}")
            return None, None

    def extract_pdf(self, pdf_bytes: bytes, url: str) -> Tuple[Optional[str], Optional[str], bool]:
        """
        Extracts text from PDF bytes. Detects scanned PDFs requiring OCR.
        Returns: (title, text, is_scanned_ocr_needed)
        """
        try:
            from pypdf import PdfReader
        except ImportError:
            return None, None, False

        try:
            reader = PdfReader(io.BytesIO(pdf_bytes))
            pages = reader.pages
            if not pages:
                return None, None, False

            page_texts = []
            for p in pages:
                t = p.extract_text() or ""
                if t.strip():
                    page_texts.append(t.strip())

            full_text = "\n\n".join(page_texts).strip()

            # If PDF has pages but 0 or negligible extracted text, it is a scanned image PDF
            if len(pages) > 0 and len(full_text) < 40:
                return None, None, True

            info = reader.metadata or {}
            title = (info.get("/Title") or Path(url).stem or "PDF Document").strip()
            return title, full_text, False
        except Exception as e:
            logger.warning(f"PDF extraction error for {url}: {e}")
            return None, None, False

    def process_url_record(self, record: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Processes a single discovered URL record into an accepted document or skipped log."""
        url = record["url"]
        category = record.get("category", "general_knowledge")
        is_pdf = record.get("content_type") == "application/pdf" or url.lower().endswith(".pdf")

        # Fetch bytes safely
        body_bytes, _, err = safe_http_get(
            url,
            user_agent=self.config.user_agent,
            timeout=self.config.request_timeout,
            max_bytes=self.config.max_response_bytes,
        )

        if err or not body_bytes:
            skip_entry = {
                "url": url,
                "category": category,
                "reason": f"Fetch failed: {err}",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            self.failed_or_skipped.append(skip_entry)
            return None

        # Extract text
        if is_pdf:
            title, text, is_scanned = self.extract_pdf(body_bytes, url)
            if is_scanned:
                skip_entry = {
                    "url": url,
                    "category": category,
                    "reason": "scanned_pdf_needs_ocr",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
                self.failed_or_skipped.append(skip_entry)
                return None
        else:
            title, text = self.clean_html(body_bytes, url)

        if not text or len(text) < self.config.min_doc_chars:
            skip_entry = {
                "url": url,
                "category": category,
                "reason": f"Content too short (< {self.config.min_doc_chars} chars)",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            self.failed_or_skipped.append(skip_entry)
            return None

        # Odia Unicode validation
        metrics = compute_odia_metrics(text)
        if self.config.require_odia_script:
            if not metrics["has_odia"]:
                skip_entry = {
                    "url": url,
                    "category": category,
                    "reason": "English/non-Odia content rejected (0% Odia script found)",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
                self.failed_or_skipped.append(skip_entry)
                return None
            if metrics["odia_ratio"] < self.config.min_odia_ratio:
                skip_entry = {
                    "url": url,
                    "category": category,
                    "reason": f"Odia script ratio too low ({metrics['odia_ratio']} < {self.config.min_odia_ratio})",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
                self.failed_or_skipped.append(skip_entry)
                return None

        # Deduplication check
        content_hash = compute_content_hash(text)
        if self.config.dedup_by_hash:
            if content_hash in self.seen_hashes:
                skip_entry = {
                    "url": url,
                    "category": category,
                    "reason": "Duplicate content hash match",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
                self.failed_or_skipped.append(skip_entry)
                return None
            self.seen_hashes.add(content_hash)

        doc_entry = {
            "doc_id": f"doc_{content_hash[:12]}",
            "content_hash": content_hash,
            "title": title or "Untitled",
            "content": text,
            "source_url": url,
            "category": category,
            "domain": record.get("domain", ""),
            "language": "odia" if metrics["odia_ratio"] >= 0.5 else "mixed_odia_english",
            "metrics": metrics,
            "license_status": "review_required",
            "extracted_at": datetime.now(timezone.utc).isoformat(),
        }
        self.accepted_documents.append(doc_entry)
        return doc_entry

    def process_records(self, discovered_records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Processes all discovered records."""
        logger.info(f"⚙️ [Agent 2: Extraction] Processing {len(discovered_records)} discovered record(s)...")
        for i, rec in enumerate(discovered_records):
            self.process_url_record(rec)
            if (i + 1) % 10 == 0:
                logger.info(f"   ↳ {i + 1}/{len(discovered_records)} processed")

        logger.info(
            f"✅ [Agent 2: Extraction] Completed: "
            f"{len(self.accepted_documents)} accepted, {len(self.failed_or_skipped)} rejected/skipped."
        )
        self._write_output()
        return self.accepted_documents

    def _write_output(self):
        docs_path = self.config.output_dir / "documents.jsonl"
        with open(docs_path, "w", encoding="utf-8") as f:
            for d in self.accepted_documents:
                f.write(json.dumps(d, ensure_ascii=False) + "\n")

        skipped_path = self.config.output_dir / "failed_or_skipped.jsonl"
        with open(skipped_path, "w", encoding="utf-8") as f:
            for s in self.failed_or_skipped:
                f.write(json.dumps(s, ensure_ascii=False) + "\n")

        logger.info(f"📁 Extracted documents saved to: {docs_path}")
        logger.info(f"📁 Skipped/failed records saved to: {skipped_path}")
