const WebScraper = require('../services/webScraperService');

async function testWebScraper() {
  const scraper = new WebScraper({ timeoutMs: 10000 });

  console.log('--- 🧪 TESTING SINGLE WEBSITE SCRAPE ---');
  const singleResult = await scraper.scrapeWebsite('https://en.wikipedia.org/wiki/Odisha');
  console.log('Single Result Payload:\n', JSON.stringify({
    url: singleResult?.url,
    title: singleResult?.title,
    contentPreview: singleResult?.content ? singleResult.content.substring(0, 200) + '...' : null,
    metadata: singleResult?.metadata
  }, null, 2));

  console.log('\n--- 🧪 TESTING BATCH WEBSITE SCRAPE ---');
  const batchUrls = [
    'https://or.wikipedia.org/wiki/%E0%AC%93%E0%AC%A1%E0%AC%BF%E0%AC%86_%E0%AC%AD%E0%AC%BE%E0%AC%B7%E0%AC%BE', // Odia language Wikipedia
    'https://en.wikipedia.org/wiki/Bhubaneswar'
  ];

  const batchResults = await scraper.scrapeBatch(batchUrls);
  console.log(`🎉 Successfully scraped ${batchResults.length} websites.`);
}

testWebScraper().catch(err => {
  console.error('Test Runner Error:', err);
});
