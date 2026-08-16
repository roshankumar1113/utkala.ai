import re
import datetime
from urllib.parse import urlparse
from typing import Dict, Any, List, Optional
import requests
try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None


class WebScraper:
    """
    WebScraper Class in Python for RAG Systems.
    Scrapes website text content, cleans tags, and returns structured data with metadata.
    """
    def __init__(self, timeout_seconds: int = 10, user_agent: Optional[str] = None):
        self.timeout = timeout_seconds
        self.user_agent = user_agent or (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36 UtkalAIRAG/1.0"
        )

    def scrape_website(self, url: str) -> Optional[Dict[str, Any]]:
        print(f'🌐 [Python WebScraper] Scraping URL: "{url}"...')

        if not url or not isinstance(url, str) or not url.startswith("http"):
            print(f'❌ [Python WebScraper] Invalid URL provided: "{url}"')
            return None

        headers = {
            "User-Agent": self.user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "or,en-US,en;q=0.9"
        }

        try:
            response = requests.get(url, headers=headers, timeout=self.timeout)
            response.raise_for_status()

            html_text = response.text
            if not html_text:
                print(f'⚠️ [Python WebScraper] No content returned from "{url}"')
                return None

            if BeautifulSoup is not None:
                soup = BeautifulSoup(html_text, 'html.parser')

                # Strip script, style, nav, footer, etc.
                for s in soup(["script", "style", "noscript", "iframe", "header", "footer", "nav", "svg", "form"]):
                    s.decompose()

                title_tag = soup.find('title')
                title = title_tag.get_text().strip() if title_tag else "Untitled Page"

                paragraphs = []
                for element in soup.find_all(['p', 'h1', 'h2', 'h3', 'h4', 'li']):
                    text = element.get_text().strip()
                    if len(text) > 20:
                        paragraphs.append(text)

                content = "\n\n".join(paragraphs).strip()

                if not content or len(content) < 50:
                    content = re.sub(r'\s+', ' ', soup.get_text()).strip()
            else:
                # Basic regex fallback if BeautifulSoup is missing
                clean_text = re.sub(r'<[^>]+>', ' ', html_text)
                content = re.sub(r'\s+', ' ', clean_text).strip()
                title = "Scraped Page"

            if not content:
                print(f'⚠️ [Python WebScraper] No meaningful text content found on "{url}"')
                return None

            domain = urlparse(url).netloc

            result = {
                "url": url,
                "title": title,
                "content": content,
                "metadata": {
                    "source": "Website",
                    "domain": domain,
                    "scrapedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()
                }
            }

            print(f'✅ [Python WebScraper] Successfully scraped "{title}" ({len(content)} chars) from {domain}')
            return result

        except Exception as error:
            print(f'❌ [Python WebScraper] Error scraping "{url}": {error}')
            return None

    def scrape_batch(self, urls: List[str]) -> List[Dict[str, Any]]:
        print(f'📂 [Python WebScraper] Starting batch scrape for {len(urls)} URLs...')

        if not urls:
            return []

        results = []
        for i, url in enumerate(urls):
            print(f'[Batch Scrape {i + 1}/{len(urls)}] Scraping: {url}')
            page_data = self.scrape_website(url)
            if page_data:
                results.append(page_data)

        print(f'🎉 [Python WebScraper] Batch scrape complete. Processed {len(results)}/{len(urls)} URLs.')
        return results
