const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');

/**
 * WebScraper Class for RAG Systems
 * Scrapes website content, extracts titles & clean body paragraphs, and structures data with metadata.
 */
class WebScraper {
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs || 10000; // 10-second timeout
    this.userAgent = options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 UtkalAIRAG/1.0';
  }

  /**
   * Scrapes text content and metadata from a single website URL
   * @param {string} url - Target website URL
   * @returns {Promise<Object|null>} - Structured page object or null on failure
   */
  async scrapeWebsite(url) {
    console.log(`🌐 [WebScraper] Scraping URL: "${url}"...`);

    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      console.error(`❌ [WebScraper] Invalid URL provided: "${url}"`);
      return null;
    }

    try {
      // 1. Send HTTP GET request with User-Agent & 10s Timeout
      const response = await axios.get(url, {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'or,en-US,en;q=0.9'
        },
        timeout: this.timeoutMs,
        maxRedirects: 5
      });

      const html = response.data;
      if (!html || typeof html !== 'string') {
        console.warn(`⚠️ [WebScraper] No HTML content returned from "${url}"`);
        return null;
      }

      // 2. Load HTML into Cheerio
      const $ = cheerio.load(html);

      // 3. Remove non-content elements (scripts, styles, navs, footers)
      $('script, style, noscript, iframe, header, footer, nav, svg, form').remove();

      // 4. Extract Page Title
      let title = $('title').text().trim() || $('h1').first().text().trim() || 'Untitled Page';
      // Clean title whitespace
      title = title.replace(/\s+/g, ' ');

      // 5. Extract Main Content Text
      // Target main content containers if available, fallback to body
      let contentSelector = $('main, article, #content, .content, .main-content, body');
      let paragraphs = [];

      contentSelector.find('p, h1, h2, h3, h4, li').each((_, element) => {
        const text = $(element).text().trim();
        if (text.length > 20) { // Filter out tiny UI snippets or buttons
          paragraphs.push(text);
        }
      });

      let content = paragraphs.join('\n\n');

      // Fallback: If paragraph extraction is sparse, extract body text
      if (!content || content.length < 50) {
        content = $('body').text().replace(/\s+/g, ' ').trim();
      }

      if (!content || content.length === 0) {
        console.warn(`⚠️ [WebScraper] No meaningful content found on "${url}"`);
        return null;
      }

      // 6. Extract Domain Metadata
      const parsedUrl = new URL(url);
      const domain = parsedUrl.hostname;

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

      console.log(`✅ [WebScraper] Successfully scraped "${title}" (${content.length} chars) from ${domain}`);
      return result;

    } catch (error) {
      // 7. Error Handling: Timeout, CORS, Network Errors (Skip gracefully)
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        console.error(`⏱️ [WebScraper] Timeout (>${this.timeoutMs}ms) fetching URL: "${url}". Skipping...`);
      } else {
        console.error(`❌ [WebScraper] Error scraping "${url}": ${error.message}`);
      }
      return null;
    }
  }

  /**
   * Scrapes text content from an array of website URLs
   * @param {Array<string>} urls - List of website URLs
   * @returns {Promise<Array<Object>>} - Array of structured website objects
   */
  async scrapeBatch(urls) {
    console.log(`📂 [WebScraper] Starting batch scrape for ${urls.length} URLs...`);

    if (!Array.isArray(urls) || urls.length === 0) {
      console.warn(`⚠️ [WebScraper] Empty or invalid URL list provided.`);
      return [];
    }

    const results = [];
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      console.log(`[Batch Scrape ${i + 1}/${urls.length}] Scraping: ${url}`);
      
      const pageData = await this.scrapeWebsite(url);
      if (pageData) {
        results.push(pageData);
      }
    }

    console.log(`🎉 [WebScraper] Batch scrape complete. Successfully scraped ${results.length}/${urls.length} URLs.`);
    return results;
  }
}

module.exports = WebScraper;
