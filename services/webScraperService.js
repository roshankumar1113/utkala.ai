/**
 * webScraperService.js
 * Scrapes website text content, removes boilerplate, and extracts clean text with metadata.
 */

const axios = require('axios');
const cheerio = require('cheerio');

class WebScraper {
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs || 10000;
    this.userAgent = options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 UtkalAI/1.0';
  }

  /**
   * Scrape a single website URL.
   * @param {string} url - Target URL
   * @returns {Promise<Object|null>}
   */
  async scrapeWebsite(url) {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      console.warn(`[WebScraper] Invalid URL: "${url}"`);
      return null;
    }

    try {
      console.log(`🌐 [WebScraper] Scraping: "${url}"...`);
      const response = await axios.get(url, {
        timeout: this.timeoutMs,
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'or,en-US,en;q=0.9'
        }
      });

      const html = response.data;
      if (!html || typeof html !== 'string') {
        console.warn(`[WebScraper] Empty response from "${url}"`);
        return null;
      }

      const $ = cheerio.load(html);

      // Remove unwanted elements
      $('script, style, noscript, iframe, header, footer, nav, svg, form, aside').remove();

      const title = $('title').text().trim() || $('h1').first().text().trim() || 'Untitled Web Page';

      const paragraphs = [];
      $('p, h1, h2, h3, h4, h5, li').each((_, el) => {
        const text = $(el).text().replace(/\s+/g, ' ').trim();
        if (text.length > 20) {
          paragraphs.push(text);
        }
      });

      let content = paragraphs.join('\n\n').trim();
      if (!content || content.length < 50) {
        content = $('body').text().replace(/\s+/g, ' ').trim();
      }

      if (!content) {
        console.warn(`[WebScraper] No meaningful content extracted from "${url}"`);
        return null;
      }

      const domain = new URL(url).hostname;
      const result = {
        url,
        title,
        content,
        metadata: {
          source: 'Website',
          domain,
          scrapedAt: new Date().toISOString()
        }
      };

      console.log(`✅ [WebScraper] Scraped "${title}" (${content.length} chars) from ${domain}`);
      return result;
    } catch (err) {
      console.error(`❌ [WebScraper] Error scraping "${url}":`, err.message);
      return null;
    }
  }

  /**
   * Scrape a list of URLs in batch.
   * @param {string[]} urls
   * @returns {Promise<Array>}
   */
  async scrapeBatch(urls) {
    if (!Array.isArray(urls) || urls.length === 0) return [];
    console.log(`📂 [WebScraper] Starting batch scrape for ${urls.length} URLs...`);
    const results = [];

    for (const [i, url] of urls.entries()) {
      console.log(`[Batch Scrape ${i + 1}/${urls.length}] ${url}`);
      const res = await this.scrapeWebsite(url);
      if (res) results.push(res);
    }

    console.log(`🎉 [WebScraper] Batch complete: ${results.length}/${urls.length} succeeded.`);
    return results;
  }
}

module.exports = WebScraper;
