"""
discovery_agent.py — Agent 1: Odia Data Discovery Agent.
Discovers publicly accessible web pages and PDF links within configured categories and domains.
"""

import time
import json
import logging
from datetime import datetime, timezone
from urllib.parse import urlparse, urljoin, urldefrag
from urllib.robotparser import RobotFileParser
from typing import Dict, List, Set, Any, Optional

from bs4 import BeautifulSoup

from .config import AgentConfig
from .security import is_safe_public_url, safe_http_get

logger = logging.getLogger(__name__)


class DiscoveryAgent:
    """
    Discovers, filters, and categorizes accessible Odia public data links.
    Adheres strictly to robots.txt, domain scope, and SSRF restrictions.
    """

    def __init__(self, config: Optional[AgentConfig] = None):
        self.config = config or AgentConfig()
        self.robot_parsers: Dict[str, RobotFileParser] = {}
        self.discovered_urls: List[Dict[str, Any]] = []
        self.seen_urls: Set[str] = set()
        self.domain_counts: Dict[str, int] = {}

    def _is_allowed_by_robots(self, url: str) -> bool:
        parsed = urlparse(url)
        domain = parsed.netloc
        if domain not in self.robot_parsers:
            robots_url = f"{parsed.scheme}://{domain}/robots.txt"
            rp = RobotFileParser()
            try:
                # Check SSRF before fetching robots.txt
                is_safe, _ = is_safe_public_url(robots_url)
                if is_safe:
                    rp.set_url(robots_url)
                    rp.read()
                else:
                    rp = None
            except Exception as e:
                logger.debug(f"Could not read robots.txt for {domain}: {e}")
                rp = None
            self.robot_parsers[domain] = rp

        rp = self.robot_parsers.get(domain)
        if rp is None:
            return True  # If unreadable or missing, default to permitted within configured scope
        try:
            return rp.can_fetch(self.config.user_agent, url)
        except Exception:
            return True

    def _clean_url(self, raw_url: str, base_url: str) -> Optional[str]:
        """Resolves relative links, strips fragments, verifies scheme and safety."""
        joined = urljoin(base_url, raw_url)
        clean, _ = urldefrag(joined)
        clean = clean.strip()
        parsed = urlparse(clean)
        if parsed.scheme.lower() not in ("http", "https"):
            return None
        # Ignore common non-content extensions
        ignored_exts = (
            ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico",
            ".mp3", ".mp4", ".avi", ".zip", ".tar", ".gz", ".exe", ".css", ".js"
        )
        if any(parsed.path.lower().endswith(ext) for ext in ignored_exts):
            return None
        return clean

    def discover(self, seeds: Optional[Dict[str, List[str]]] = None) -> List[Dict[str, Any]]:
        """
        Executes discovery pass across configured seed URLs by category.
        """
        target_seeds = seeds or self.config.seeds
        logger.info(f"🔍 [Agent 1: Discovery] Starting crawl with {sum(len(v) for v in target_seeds.values())} seed(s)...")

        queue: List[Dict[str, Any]] = []
        for category, url_list in target_seeds.items():
            for u in url_list:
                clean_seed = self._clean_url(u, u)
                if clean_seed and clean_seed not in self.seen_urls:
                    self.seen_urls.add(clean_seed)
                    parsed = urlparse(clean_seed)
                    item = {
                        "url": clean_seed,
                        "category": category,
                        "domain": parsed.netloc,
                        "depth": 0,
                        "parent_url": None,
                        "content_type": "application/pdf" if clean_seed.lower().endswith(".pdf") else "text/html",
                        "discovered_at": datetime.now(timezone.utc).isoformat(),
                    }
                    queue.append(item)
                    self.discovered_urls.append(item)
                    self.domain_counts[parsed.netloc] = self.domain_counts.get(parsed.netloc, 0) + 1

        # Breadth-first crawl up to max_depth
        while queue:
            current = queue.pop(0)
            cur_url = current["url"]
            cur_depth = current["depth"]
            cur_cat = current["category"]
            cur_domain = current["domain"]

            if cur_depth >= self.config.max_depth or cur_url.lower().endswith(".pdf"):
                continue

            # Respect robots.txt
            if not self._is_allowed_by_robots(cur_url):
                logger.info(f"🚫 [Robots.txt] Blocked URL: {cur_url}")
                continue

            time.sleep(self.config.request_delay)

            # Fetch page safely
            body_bytes, content_type, err = safe_http_get(
                cur_url,
                user_agent=self.config.user_agent,
                timeout=self.config.request_timeout,
                max_bytes=self.config.max_response_bytes,
            )

            if err or not body_bytes:
                logger.debug(f"Skip discovery fetch on {cur_url}: {err}")
                continue

            # Parse out links
            try:
                html_text = body_bytes.decode("utf-8", errors="replace") if isinstance(body_bytes, bytes) else str(body_bytes)
                soup = BeautifulSoup(html_text, "html.parser")
                for a_tag in soup.find_all("a", href=True):
                    raw_href = a_tag["href"]
                    clean_link = self._clean_url(raw_href, cur_url)
                    if not clean_link or clean_link in self.seen_urls:
                        continue

                    link_parsed = urlparse(clean_link)
                    # Stay within same domain for discovery to respect boundary limits
                    if link_parsed.netloc != cur_domain:
                        continue

                    # Check domain quota limit
                    domain_count = self.domain_counts.get(link_parsed.netloc, 0)
                    if domain_count >= self.config.max_urls_per_domain:
                        continue

                    is_safe, _ = is_safe_public_url(clean_link)
                    if not is_safe:
                        continue

                    self.seen_urls.add(clean_link)
                    self.domain_counts[link_parsed.netloc] = domain_count + 1

                    is_pdf = clean_link.lower().endswith(".pdf")
                    discovered_item = {
                        "url": clean_link,
                        "category": cur_cat,
                        "domain": link_parsed.netloc,
                        "depth": cur_depth + 1,
                        "parent_url": cur_url,
                        "content_type": "application/pdf" if is_pdf else "text/html",
                        "discovered_at": datetime.now(timezone.utc).isoformat(),
                    }
                    self.discovered_urls.append(discovered_item)
                    if not is_pdf:
                        queue.append(discovered_item)

            except Exception as e:
                logger.warning(f"Error extracting links from {cur_url}: {e}")

        logger.info(f"✅ [Agent 1: Discovery] Completed. Total URLs discovered: {len(self.discovered_urls)}")
        self._write_output()
        return self.discovered_urls

    def _write_output(self):
        output_path = self.config.output_dir / "discovered_urls.jsonl"
        with open(output_path, "w", encoding="utf-8") as f:
            for item in self.discovered_urls:
                f.write(json.dumps(item, ensure_ascii=False) + "\n")
        logger.info(f"📁 Discovered URLs saved to: {output_path}")
