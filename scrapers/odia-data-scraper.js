const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'scraped_odia_data.json');

// Base curated dataset for MSME, schemes, and Odia learning
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
    content: 'ଓଡ଼ିଆ ବର୍ଣ୍ଣମାଳାରେ ୧୨ଟି ସ୍ୱରବର୍ଣ୍ଣ (ଅ, ଆ, ଇ, ଈ, ଉ, ଊ, ଋ, ଏ, ଐ, ଓ, ঔ, ଅଂ, ଅଃ) ଏବଂ ବ୍ୟଞ୍ଜନବର୍ଣ୍ଣ ରହିଛି। ପିଲାଙ୍କୁ ଚିତ୍ର ଓ ଗୀତ ମାଧ୍ୟମରେ ସହଜରେ ଶିଖାଯାଇପାରିବ।',
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

// Helper to fetch dataset rows safely from HuggingFace
async function fetchHuggingFaceRows(datasetName, config = 'default', limit = 20) {
  try {
    const encoded = encodeURIComponent(datasetName);
    const url = `https://datasets-server.huggingface.co/rows?dataset=${encoded}&config=${config}&split=train&offset=0&length=${limit}`;
    console.log(`🌐 Fetching HuggingFace dataset: ${datasetName}...`);
    const res = await axios.get(url, { timeout: 10000 });
    return res.data?.rows?.map(r => r.row) || [];
  } catch (err) {
    console.warn(`⚠️ Failed to fetch HuggingFace dataset ${datasetName}:`, err.message);
    return [];
  }
}

async function scrapeAllSources() {
  console.log('🚀 Starting Comprehensive Odia AI Data Scraper...');

  // 1. Fetch Odia Context 10K Llama2 Set
  const contextRows = await fetchHuggingFaceRows('OdiaGenAI/odia_context_10K_llama2_set', 'default', 25);
  const parsedContextData = contextRows.map((item, idx) => {
    const rawText = item.text || item.instruction || '';
    const cleanContent = rawText.replace(/<s>|<\/s>|\[INST\]|\[\/INST\]/g, '').trim();
    return {
      title: `Odia Context Dataset #${idx + 1}`,
      category: 'Odia Context & Domain Knowledge',
      content: cleanContent,
      source_url: 'https://huggingface.co/datasets/OdiaGenAI/odia_context_10K_llama2_set',
      language: 'odia'
    };
  });

  // 2. Fetch Roleplay Odia Set
  const roleplayRows = await fetchHuggingFaceRows('OdiaGenAI/roleplay_odia', 'default', 15);
  const parsedRoleplayData = roleplayRows.map((item, idx) => {
    const convoText = Array.isArray(item.conversations)
      ? item.conversations.map(c => `${c.from}: ${c.value}`).join('\n')
      : JSON.stringify(item);
    return {
      title: `Odia Roleplay Conversation #${idx + 1} (${item.user || 'General'})`,
      category: 'Odia Roleplay Instructions',
      content: convoText,
      source_url: 'https://huggingface.co/datasets/OdiaGenAI/roleplay_odia',
      language: 'odia'
    };
  });

  // 3. Fetch Master Odia Llama2 Set
  const masterRows = await fetchHuggingFaceRows('OdiaGenAI/odia_master_data_llama2', 'default', 15);
  const parsedMasterData = masterRows.map((item, idx) => {
    const rawText = item.merged || item.text || '';
    const cleanContent = rawText.replace(/<s>|<\/s>|\[INST\]|\[\/INST\]/g, '').trim();
    return {
      title: `Odia Master Instruction #${idx + 1}`,
      category: 'Odia Master Instruction Set',
      content: cleanContent,
      source_url: 'https://huggingface.co/datasets/OdiaGenAI/odia_master_data_llama2',
      language: 'odia'
    };
  });

  const allScrapedData = [
    ...INITIAL_ODIA_KNOWLEDGE,
    ...parsedContextData,
    ...parsedRoleplayData,
    ...parsedMasterData
  ];

  await fs.ensureDir(path.dirname(OUTPUT_FILE));
  await fs.writeJson(OUTPUT_FILE, allScrapedData, { spaces: 2 });

  console.log(`✅ Odia Data Scraper complete!`);
  console.log(`📁 Total ${allScrapedData.length} records saved to: ${OUTPUT_FILE}`);
  return allScrapedData;
}

if (require.main === module) {
  scrapeAllSources().catch(err => {
    console.error('❌ Scraper error:', err);
    process.exit(1);
  });
}

module.exports = {
  scrapeAllSources
};
