const path = require('path');
const fs = require('fs-extra');
const WebScraper = require('../services/webScraperService');

const DATA_FILE = path.join(__dirname, '..', 'data', 'scraped_odia_data.json');

const TARGET_URLS = [
  'https://en.wikipedia.org/wiki/Odisha',
  'https://en.wikipedia.org/wiki/Bhubaneswar',
  'https://en.wikipedia.org/wiki/Puri',
  'https://en.wikipedia.org/wiki/Cuttack',
  'https://en.wikipedia.org/wiki/Konark_Sun_Temple',
  'https://en.wikipedia.org/wiki/Jagannath_Temple,_Puri',
  'https://odisha.gov.in/or/odisha-profile/odia-classics/sarala-mahabharata/odia-classic-data',
  'https://odisha.gov.in/or/odisha-profile/eminent-personalities',
  'https://investodisha.gov.in/',
  'https://rocinindia.blogspot.com/2013/12/roc-at-cuttack-orissa.html',
  'https://odisha.gov.in/or/odisha-profile/eminent-personalities/bakasai-jagabanadhau',
  'https://odisha.gov.in/or/taxonomy/term/148',
  'https://odisha.gov.in/or/explore-odisha/maelaa-o-parabaparabaanai',
  'https://odisha.gov.in/or/odisha-tourism/patata-caitara',
  'https://odisha.gov.in/or/odisha-tourism/gaurautatawapauuranana-parayayatana-sathalai-bhaubanaesawara'
];

async function runBatchScrapeAndImport() {
  console.log('🚀 Starting Batch Web Scraper for RAG Knowledge Base...');

  const scraper = new WebScraper({ timeoutMs: 15000 });
  const scrapedPages = await scraper.scrapeBatch(TARGET_URLS);

  if (scrapedPages.length === 0) {
    console.warn('⚠️ No websites were scraped successfully.');
    return;
  }

  // Load existing dataset
  let dataset = [];
  if (await fs.pathExists(DATA_FILE)) {
    dataset = await fs.readJson(DATA_FILE);
  }

  let addedCount = 0;
  for (const page of scrapedPages) {
    // Avoid duplicate URL entries
    const existingIdx = dataset.findIndex(item => item.source_url === page.url);
    const record = {
      title: page.title,
      category: 'Web Knowledge',
      content: page.content,
      source_url: page.url,
      language: 'odia'
    };

    if (existingIdx >= 0) {
      dataset[existingIdx] = record;
    } else {
      dataset.push(record);
      addedCount++;
    }
  }

  await fs.ensureDir(path.dirname(DATA_FILE));
  await fs.writeJson(DATA_FILE, dataset, { spaces: 2 });

  console.log(`✅ Batch Web Scrape Complete!`);
  console.log(`📊 Added/Updated ${addedCount} web pages in RAG Knowledge Base.`);
  console.log(`📁 Total Dataset Size: ${dataset.length} records in ${DATA_FILE}`);
}

runBatchScrapeAndImport().catch(err => {
  console.error('❌ Batch Scraper Error:', err);
});
