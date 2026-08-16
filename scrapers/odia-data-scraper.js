const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs-extra');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'scraped_odia_data.json');

// Curated Odia knowledge base entries for MSME, culture, schemes, and education
const INITIAL_ODIA_KNOWLEDGE = [
  {
    title: 'ସୁଭଦ୍ରା ଯୋଜନା (Subhadra Yojana Overview)',
    category: 'Government Schemes',
    content: 'ସୁଭଦ୍ରା ଯୋଜନା ଓଡ଼ିଶା ସରକାରଙ୍କ ଦ୍ୱାରା ମହିଳାମାନଙ୍କ ଆର୍ଥିକ ସଶକ୍ତୀକରଣ ପାଇଁ ଆରମ୍ଭ କରାଯାଇଛି। ଏଥିରେ ଯୋଗ୍ୟ ମହିଳାମାନଙ୍କୁ ବାର୍ଷିକ ୧୦,୦୦୦ ଟଙ୍କା (୫ ବର୍ଷରେ ୫୦,୦୦୦ ଟଙ୍କା) ମିଳିଥାଏ। ଆବଶ୍ୟକ ଦଲିଲ: ଆଧାର କାର୍ଡ, ବ୍ୟାଙ୍କ ଖାତା, ମୋବାଇଲ ନମ୍ବର।',
    source_url: 'https://subhadra.odisha.gov.in',
    language: 'odia'
  },
  {
    title: 'କାଳିଆ ଯୋଜନା (KALIA Scheme for Farmers)',
    category: 'Agriculture',
    content: 'କାଳିଆ ଯୋଜନା ଓଡ଼ିଶାର କ୍ଷୁଦ୍ର, ନାମମାତ୍ର ଚାଷୀ ଓ ଭାଗଚାଷୀମାନଙ୍କୁ କୃଷି ସହାୟତା ଯୋଗାଇଦିଏ। ଏହା ଦ୍ୱାରା ବିହନ, ସାର, ଔଷଧ କିଣିବା ପାଇଁ ଆର୍ଥିକ ସହାୟତା ମିଳିଥାଏ।',
    source_url: 'https://kalia.odisha.gov.in',
    language: 'odia'
  },
  {
    title: 'ଓଡ଼ିଆ ବର୍ଣ୍ଣମାଳା ଓ ସ୍ୱରବର୍ଣ୍ଣ (Odia Alphabets & Vowels)',
    category: 'Education',
    content: 'ଓଡ଼ିଆ ବର୍ଣ୍ଣମାଳାରେ ୧୨ଟି ସ୍ୱରବର୍ଣ୍ଣ (ଅ, ଆ, ଇ, ଈ, ଉ, ଊ, ଋ, ଏ, ଐ, ଓ,  ഔ, ଅଂ, ଅଃ) ଏବଂ ବ୍ୟଞ୍ଜନବର୍ଣ୍ଣ ରହିଛି। ପିଲାଙ୍କୁ ଚିତ୍ର ଓ ଗୀତ ମାଧ୍ୟମରେ ସହଜରେ ଶିଖାଯାଇପାରିବ।',
    source_url: 'https://or.wikipedia.org/wiki/Odia_alphabet',
    language: 'odia'
  },
  {
    title: 'ଓଡ଼ିଆ ଢଗଢମାଳି ଓ ପ୍ରବାଦ (Odia Proverbs & Wisdom)',
    category: 'Culture',
    content: 'ଓଡ଼ିଆ ସଂସ୍କୃତିରେ ଢଗଢମାଳିର ପ୍ରସିଦ୍ଧି ରହିଛି। ଯେପରି: "ଅତି ଭକ୍ତି ଚୋରର ଲକ୍ଷଣ", "ଆପଣା ହାତ ଜଗନ୍ନାଥ", "କଷ୍ଟ କଲେ କୃଷ୍ଣ ମିଳେ"। ଏଗୁଡ଼ିକ ଜୀବନର ମୂଲ୍ୟବାନ ଉପଦେଶ ଦିଅନ୍ତି।',
    source_url: 'https://or.wikipedia.org/wiki/Odia_proverbs',
    language: 'odia'
  },
  {
    title: 'ଓଡ଼ିଶାର କ୍ଷୁଦ୍ର ଓ ମଧ୍ୟମ ଉଦ୍ୟୋଗ (MSME Business Guidance)',
    category: 'Business',
    content: 'ଓଡ଼ିଶାରେ ନୂତନ ବ୍ୟବସାୟ ଆରମ୍ଭ କରିବା ପାଇଁ MSME ସିଙ୍ଗଲ ୱିଣ୍ଡୋ ପୋର୍ଟାଲ (GO-SWIFT) ମାଧ୍ୟମରେ ସହଜରେ ଲାଇସେନ୍ସ ଓ ସବସିଡି ଆବେଦନ କରାଯାଇପାରିବ।',
    source_url: 'https://msme.odisha.gov.in',
    language: 'odia'
  }
];

async function scrapeOdiaWikipedia() {
  console.log('🌐 Fetching latest Odia content from Odia Wikipedia API...');
  try {
    const wikiUrl = 'https://or.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=%E0%AC%93%E0%AC%A1%E0%AC%BF%E0%AC%AA%E0%AC%BE&utf8=1';
    const res = await axios.get(wikiUrl, { timeout: 8000 });
    const searchResults = res.data?.query?.search || [];

    return searchResults.map(item => {
      const cleanSnippet = item.snippet.replace(/<[^>]*>?/gm, '');
      return {
        title: item.title,
        category: 'Wikipedia Odia',
        content: cleanSnippet,
        source_url: `https://or.wikipedia.org/wiki/${encodeURIComponent(item.title)}`,
        language: 'odia'
      };
    });
  } catch (error) {
    console.warn('⚠️ Wikipedia Odia fetch timed out/failed. Using curated dataset fallback:', error.message);
    return [];
  }
}

async function runScraper() {
  console.log('🚀 Starting Odia Data Scraper process...');
  await fs.ensureDir(path.dirname(OUTPUT_FILE));

  const wikiData = await scrapeOdiaWikipedia();
  const combinedData = [...INITIAL_ODIA_KNOWLEDGE, ...wikiData];

  await fs.writeJson(OUTPUT_FILE, combinedData, { spaces: 2 });
  console.log(`✅ Odia Data Scraper finished successfully!`);
  console.log(`📁 Saved ${combinedData.length} records to: ${OUTPUT_FILE}`);
}

if (require.main === module) {
  runScraper().catch(err => {
    console.error('❌ Scraper process failed:', err);
    process.exit(1);
  });
}

module.exports = {
  runScraper
};
