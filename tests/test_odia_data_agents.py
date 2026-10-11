"""
test_odia_data_agents.py — Comprehensive Unit & Integration Test Suite
for Utkal.ai Zero-Cost Odia Data Collection Agent System.
"""

import os
import io
import json
import pytest
from unittest.mock import patch, MagicMock

from agents.odia_data_agents.config import AgentConfig
from agents.odia_data_agents.security import is_safe_public_url, safe_http_get
from agents.odia_data_agents.discovery_agent import DiscoveryAgent
from agents.odia_data_agents.extraction_agent import (
    ExtractionAgent,
    compute_odia_metrics,
    compute_content_hash,
)
from agents.odia_data_agents.chunking_agent import ChunkingAgent
from agents.odia_data_agents.validation_indexing_agent import ValidationIndexingAgent
from agents.odia_data_agents.pipeline import OdiaAgentPipeline


# ── 1. Security & SSRF Protection ─────────────────────────────────────────────

def test_security_valid_public_urls():
    # Public domain names
    safe, msg = is_safe_public_url("https://subhadra.odisha.gov.in")
    assert safe is True, f"Expected safe, got: {msg}"

    safe, msg = is_safe_public_url("https://or.wikipedia.org/wiki/Odia")
    assert safe is True, f"Expected safe, got: {msg}"


def test_security_ssrf_localhost_blocked():
    blocked_urls = [
        "http://localhost:5000",
        "http://127.0.0.1:8000/internal",
        "http://127.0.0.2",
        "http://[::1]:8080",
        "http://10.0.0.1/admin",
        "http://192.168.1.1/secret",
        "http://172.16.0.5/api",
        "http://169.254.169.254/latest/meta-data",  # Cloud metadata
        "ftp://example.com/file.txt",                # Non-http scheme
        "file:///etc/passwd",
        "",
    ]
    for url in blocked_urls:
        safe, msg = is_safe_public_url(url)
        assert safe is False, f"URL {url} should have been blocked: {msg}"


def test_safe_http_get_ssrf_prevention():
    bytes_out, content_type, err = safe_http_get(
        "http://127.0.0.1:8000/secret",
        user_agent="TestBot",
    )
    assert bytes_out is None
    assert "SSRF Block" in (err or "")


# ── 2. Agent 1: Discovery Agent ───────────────────────────────────────────────

def test_discovery_agent_deduplication_and_categorization(tmp_path):
    config = AgentConfig(output_dir=tmp_path, max_depth=0)
    agent = DiscoveryAgent(config)

    seeds = {
        "government": ["https://subhadra.odisha.gov.in", "https://subhadra.odisha.gov.in#section"],
        "education": ["https://or.wikipedia.org/wiki/Odia"],
    }

    discovered = agent.discover(seeds)

    # Fragment #section should be stripped and duplicate removed
    urls = [d["url"] for d in discovered]
    assert len(urls) == 2
    assert "https://subhadra.odisha.gov.in" in urls
    assert "https://or.wikipedia.org/wiki/Odia" in urls

    gov_item = next(d for d in discovered if d["url"] == "https://subhadra.odisha.gov.in")
    assert gov_item["category"] == "government"
    assert gov_item["domain"] == "subhadra.odisha.gov.in"

    # Verify output file
    output_file = tmp_path / "discovered_urls.jsonl"
    assert output_file.exists()


def test_discovery_agent_robots_restriction(tmp_path):
    config = AgentConfig(output_dir=tmp_path, max_depth=1)
    agent = DiscoveryAgent(config)

    mock_rp = MagicMock()
    mock_rp.can_fetch.return_value = False
    agent.robot_parsers["subhadra.odisha.gov.in"] = mock_rp

    allowed = agent._is_allowed_by_robots("https://subhadra.odisha.gov.in/disallowed-page")
    assert allowed is False


# ── 3. Agent 2: Extraction & Odia Cleaning ────────────────────────────────────

def test_odia_unicode_metrics():
    # Authentic Odia sentence
    odia_text = "ସୁଭଦ୍ରା ଯୋଜନା ଓଡ଼ିଶାର ଏକ ସରକାରୀ ଯୋଜନା।"
    metrics = compute_odia_metrics(odia_text)
    assert metrics["has_odia"] is True
    assert metrics["odia_ratio"] > 0.8
    assert metrics["odia_chars"] > 15

    # English-only sentence
    english_text = "This is a completely English government notification with no Odia text."
    en_metrics = compute_odia_metrics(english_text)
    assert en_metrics["has_odia"] is False
    assert en_metrics["odia_ratio"] == 0.0

    # Mixed Odia + English
    mixed_text = "Subhadra Yojana: ସୁଭଦ୍ରା ଯୋଜନା ସମ୍ପର୍କରେ ତଥ୍ୟ।"
    mixed_metrics = compute_odia_metrics(mixed_text)
    assert mixed_metrics["has_odia"] is True
    assert 0.2 < mixed_metrics["odia_ratio"] < 0.9


def test_content_hash_deterministic():
    text_a = "ଓଡ଼ିଶା ସରକାରଙ୍କ   କୃଷି ବିଭାଗ।"
    text_b = "ଓଡ଼ିଶା ସରକାରଙ୍କ କୃଷି ବିଭାଗ।"
    # Whitespace-collapsed normalized hashes must match
    assert compute_content_hash(text_a) == compute_content_hash(text_b)


def test_extraction_agent_html_cleaning_and_odia_filter(tmp_path):
    config = AgentConfig(output_dir=tmp_path, min_doc_chars=30, min_odia_ratio=0.15)
    agent = ExtractionAgent(config)

    mock_html = """
    <!DOCTYPE html>
    <html>
      <head><title>ସାରଥି ପୋର୍ଟାଲ</title></head>
      <body>
        <nav><a href="/home">Menu</a></nav>
        <header>Header Bar</header>
        <h1>ସାରଥି ଯୋଜନା</h1>
        <p>ଓଡ଼ିଶା ସରକାରଙ୍କ ଦ୍ୱାରା ପରିଚାଳିତ ଏକ ସହାୟତା ଯୋଜନା। ଏଠାରେ ଯୋଗ୍ୟତା ଏବଂ ଆବେଦନ ପ୍ରକ୍ରିୟା ସମ୍ପର୍କରେ ସବିଶେଷ ବିବରଣୀ ପ୍ରଦାନ କରାଯାଇଛି। ସମସ୍ତ ନାଗରିକ ଏହି ସୁବିଧା ପାଇପାରିବେ।</p>
        <footer>Footer Copy</footer>
      </body>
    </html>
    """.encode("utf-8")

    with patch("agents.odia_data_agents.extraction_agent.safe_http_get") as mock_get:
        mock_get.return_value = (mock_html, "text/html", None)
        record = {
            "url": "https://odisha.gov.in/sarathi",
            "category": "government",
            "domain": "odisha.gov.in",
        }
        res = agent.process_url_record(record)
        assert res is not None
        assert res["language"] in ("odia", "mixed_odia_english")
        assert res["metrics"]["has_odia"] is True
        assert len(agent.accepted_documents) == 1
        assert len(agent.failed_or_skipped) == 0


def test_extraction_agent_rejects_english_only(tmp_path):
    config = AgentConfig(output_dir=tmp_path, require_odia_script=True)
    agent = ExtractionAgent(config)

    mock_html = b"<html><head><title>Notice</title></head><body><p>This is purely in English language with no Odia text at all. We provide no native script content here.</p></body></html>"

    with patch("agents.odia_data_agents.extraction_agent.safe_http_get") as mock_get:
        mock_get.return_value = (mock_html, "text/html", None)
        res = agent.process_url_record({
            "url": "https://example.com/english",
            "category": "news",
            "domain": "example.com"
        })
        assert res is None
        assert len(agent.accepted_documents) == 0
        assert len(agent.failed_or_skipped) == 1
        assert "rejected" in agent.failed_or_skipped[0]["reason"].lower()


# ── 4. Agent 3: Odia-Aware Chunking ───────────────────────────────────────────

def test_chunking_agent_odia_danda_splitting(tmp_path):
    config = AgentConfig(output_dir=tmp_path, chunk_size=120, chunk_overlap=30, min_chunk_length=20)
    chunker = ChunkingAgent(config)

    long_odia_doc = {
        "doc_id": "doc_odia_001",
        "title": "ସୁଭଦ୍ରା ଯୋଜନା ବିବରଣୀ",
        "source_url": "https://subhadra.odisha.gov.in",
        "category": "government",
        "language": "odia",
        "content": (
            "ସୁଭଦ୍ରା ଯୋଜନା ଓଡ଼ିଶାର ଏକ ସର୍ବବୃହତ ମହିଳା କଲ୍ୟାଣ ଯୋଜନା। "
            "ଏହି ଯୋଜନାରେ ମହିଳାମାନଙ୍କୁ ପ୍ରତିବର୍ଷ ଦୁଇଟି କିସ୍ତିରେ ଆର୍ଥିକ ସହାୟତା ପ୍ରଦାନ କରାଯାଏ। "
            "ଆଧାର କାର୍ଡ ଓ ବ୍ୟାଙ୍କ ଖାତା ଏଥିପାଇଁ ବାଧ୍ୟତାମୂଳକ ଅଟେ। "
            "ଯୋଗ୍ୟ ହିତାଧିକାରୀ ମାନେ ନିକଟସ୍ଥ ମୋ ସେବା କେନ୍ଦ୍ରରେ ଆବେଦନ କରିପାରିବେ।"
        ),
    }

    chunks = chunker.chunk_document(long_odia_doc)
    assert len(chunks) >= 2

    # Deterministic chunk ID test
    assert chunks[0]["chunk_id"] == "doc_odia_001_c000"
    assert chunks[1]["chunk_id"] == "doc_odia_001_c001"

    # Provenance metadata preservation
    for c in chunks:
        assert c["metadata"]["source_url"] == "https://subhadra.odisha.gov.in"
        assert c["metadata"]["category"] == "government"
        assert c["metadata"]["language"] == "odia"


def test_chunking_agent_stable_ids_idempotency(tmp_path):
    config = AgentConfig(output_dir=tmp_path)
    chunker = ChunkingAgent(config)

    doc = {
        "doc_id": "doc_stable_test",
        "title": "Test Title",
        "content": "ପ୍ରଥମ ବାକ୍ୟ। ଦ୍ୱିତୀୟ ବାକ୍ୟ। ତୃତୀୟ ବାକ୍ୟ।",
    }

    run1 = chunker.chunk_document(doc)
    run2 = chunker.chunk_document(doc)

    assert len(run1) == len(run2)
    for c1, c2 in zip(run1, run2):
        assert c1["chunk_id"] == c2["chunk_id"]
        assert c1["text"] == c2["text"]


# ── 5. Agent 4: Validation & Vector Safety ────────────────────────────────────

def test_validation_dimension_mismatch_refusal(tmp_path):
    config = AgentConfig(
        output_dir=tmp_path,
        embedding_backend="ngram",      # 128-dim
        enforce_vector_dim_match=True,
        dry_run=False                   # Force indexing attempt
    )
    val_agent = ValidationIndexingAgent(config)

    # Mock detection of existing 768-dim vector store
    with patch.object(val_agent, "_detect_existing_store_dim", return_value=(768, "Mock JSON Store")):
        docs = [{"doc_id": "d1", "source_url": "https://test.com", "content": "ଟେଷ୍ଟ କଣ୍ଟେଣ୍ଟ", "metrics": {"odia_ratio": 0.9}}]
        chunks = [{"chunk_id": "d1_c000", "text": "ଟେଷ୍ଟ କଣ୍ଟେଣ୍ଟ", "metadata": {}}]

        summary = val_agent.validate(docs, chunks)
        assert summary["vector_store"]["compatible"] is False
        assert "DIMENSION MISMATCH" in summary["vector_store"]["dimension_warning"]

        # Safe index execution should REFUSE to touch the 768d store
        idx_res = val_agent.safe_index(chunks, force_index=True, allow_staging_store=True)
        assert idx_res["indexed"] is False
        assert "DIMENSION MISMATCH" in idx_res["reason"]
        assert idx_res["chunks_staged"] == 1


def test_validation_dry_run_protection(tmp_path):
    config = AgentConfig(output_dir=tmp_path, dry_run=True)
    val_agent = ValidationIndexingAgent(config)

    chunks = [{"chunk_id": "c1", "text": "ବାର୍ତ୍ତା", "metadata": {}}]
    res = val_agent.safe_index(chunks, force_index=False)
    assert res["indexed"] is False
    assert "Dry-run mode" in res["reason"]


# ── 6. End-to-End Orchestrator Pipeline Test ─────────────────────────────────

def test_pipeline_dry_run_complete_flow(tmp_path):
    config = AgentConfig(
        output_dir=tmp_path,
        max_depth=0,
        min_doc_chars=20,
        dry_run=True,
    )
    seeds = {
        "government": ["https://subhadra.odisha.gov.in"],
    }
    config.seeds = seeds

    pipeline = OdiaAgentPipeline(config)

    mock_html = (
        "<html><head><title>Subhadra Portal</title></head><body>"
        "<p>ସୁଭଦ୍ରା ଯୋଜନା ଓଡ଼ିଶାର ଏକ ପ୍ରମୁଖ ସରକାରୀ ଯୋଜନା ଅଟେ।</p>"
        "</body></html>"
    ).encode("utf-8")

    with patch("agents.odia_data_agents.extraction_agent.safe_http_get") as mock_get:
        mock_get.return_value = (mock_html, "text/html", None)
        result = pipeline.run()

        assert len(result["discovered_urls"]) == 1
        assert len(result["documents"]) == 1
        assert len(result["chunks"]) >= 1
        assert result["indexing"]["indexed"] is False  # Safe dry-run preserved
        assert os.path.exists(result["report_path"])
        assert (tmp_path / "discovered_urls.jsonl").exists()
        assert (tmp_path / "documents.jsonl").exists()
        assert (tmp_path / "chunks.jsonl").exists()
        assert (tmp_path / "report.json").exists()
        assert (tmp_path / "agent_run.log").exists()


# ── 7. Edge Cases: Scanned PDFs, Network Errors & Malformed Content ────────────

def test_extraction_scanned_pdf_ocr_flag(tmp_path):
    config = AgentConfig(output_dir=tmp_path)
    agent = ExtractionAgent(config)

    # Mock PdfReader returning pages with no text
    mock_page = MagicMock()
    mock_page.extract_text.return_value = ""
    mock_reader = MagicMock()
    mock_reader.pages = [mock_page, mock_page]
    mock_reader.metadata = {}

    with patch("pypdf.PdfReader", return_value=mock_reader):
        with patch("agents.odia_data_agents.extraction_agent.safe_http_get") as mock_get:
            mock_get.return_value = (b"%PDF-1.4 dummy", "application/pdf", None)
            res = agent.process_url_record({
                "url": "https://odisha.gov.in/scanned-gazette.pdf",
                "category": "government",
                "content_type": "application/pdf"
            })
            assert res is None
            assert len(agent.failed_or_skipped) == 1
            assert agent.failed_or_skipped[0]["reason"] == "scanned_pdf_needs_ocr"


def test_extraction_network_timeout_and_error_handling(tmp_path):
    config = AgentConfig(output_dir=tmp_path)
    agent = ExtractionAgent(config)

    with patch("agents.odia_data_agents.extraction_agent.safe_http_get") as mock_get:
        mock_get.return_value = (None, None, "Connection timed out after 10.0s")
        res = agent.process_url_record({
            "url": "https://odisha.gov.in/slow-portal",
            "category": "government"
        })
        assert res is None
        assert len(agent.failed_or_skipped) == 1
        assert "timed out" in agent.failed_or_skipped[0]["reason"].lower()


def test_extraction_malformed_empty_html(tmp_path):
    config = AgentConfig(output_dir=tmp_path)
    agent = ExtractionAgent(config)

    with patch("agents.odia_data_agents.extraction_agent.safe_http_get") as mock_get:
        mock_get.return_value = (b"   ", "text/html", None)
        res = agent.process_url_record({
            "url": "https://odisha.gov.in/empty",
            "category": "government"
        })
        assert res is None
        assert len(agent.failed_or_skipped) == 1
        assert "too short" in agent.failed_or_skipped[0]["reason"].lower()

