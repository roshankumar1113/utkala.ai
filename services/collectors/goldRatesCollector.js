/**
 * services/collectors/goldRatesCollector.js
 * Daily Gold & Silver Price Collector for Odisha.
 * Sources: Reputable financial market sources (Goodreturns, NDTV, Live Market Data via Tavily).
 * Purity: 24 Karat (99.9% pure) and 22 Karat (standard jewelry gold) per gram and per 10 grams.
 * Cache duration: 4 hours.
 */

const axios = require('axios');

let goldCache = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

/**
 * Collects live gold and silver rates in Odisha.
 * @param {string} [location='Odisha'] - location name
 * @returns {Promise<Object|null>}
 */
async function collectGoldRates(location = 'Odisha') {
  const now = Date.now();
  if (goldCache && (now - lastCacheTime < CACHE_TTL_MS)) {
    return goldCache;
  }

  const tavilyKey = process.env.TAVILY_API_KEY;
  if (!tavilyKey || tavilyKey.includes('your_') || tavilyKey.includes('placeholder')) {
    console.warn('[GoldRatesCollector] TAVILY_API_KEY is not configured.');
    return null;
  }

  try {
    const query = `today gold price in Odisha Bhubaneswar 24k 22k per gram rate Goodreturns NDTV`;
    const resp = await axios.post(
      'https://api.tavily.com/search',
      {
        api_key: tavilyKey,
        query,
        search_depth: 'basic',
        include_answer: true,
        max_results: 3,
      },
      { timeout: 7000 }
    );

    const data = resp.data;
    const answer = data?.answer || '';
    const results = data?.results || [];

    if (!answer && results.length === 0) {
      return null;
    }

    const todayDate = new Date().toISOString().split('T')[0];
    const timeStr = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });

    const sources = [];
    results.forEach(r => {
      if (r.url && r.url.includes('goodreturns')) sources.push('Goodreturns');
      else if (r.url && r.url.includes('ndtv')) sources.push('NDTV Profit');
      else if (r.title) sources.push(r.title.slice(0, 30));
    });
    const finalSources = sources.length > 0 ? Array.from(new Set(sources)) : ['Live Bullion Market Feed'];

    const contextText = [
      `[LIVE GOLD & SILVER PRICE - ODISHA / BHUBANESWAR]`,
      `ତାରିଖ (Date): ${todayDate} (${timeStr} IST ରେ ପ୍ରାପ୍ତ ତଥ୍ୟ)`,
      `ବଜାର ସ୍ଥାନ (Market): ଭୁବନେଶ୍ୱର / ଓଡ଼ିଶା (Odisha)`,
      `ସଦ୍ୟତମ ସୁନା ଦର ବିବରଣୀ (Live Summary):\n${answer || results[0]?.content || 'ଦୈନିକ ସୁନା ଦର'}\n`,
      `ମାନକ ପରିମାଣ (Standards):`,
      `- ୨୪ କ୍ୟାରେଟ୍ (24K Gold - 99.9% ଶୁଦ୍ଧ ସୁନା): ପ୍ରତି ଗ୍ରାମ୍ ଏବଂ ୧୦ ଗ୍ରାମ୍ ଦର`,
      `- ୨୨ କ୍ୟାରେଟ୍ (22K Gold - ଗହଣା ସୁନା): ପ୍ରତି ଗ୍ରାମ୍ ଏବଂ ୧୦ ଗ୍ରାମ୍ ଦର`,
      `ସୂଚନା: ଏଥିରେ GST (3%) ଏବଂ ଗହଣା ତିଆରି ଖର୍ଚ୍ଚ (Making Charges) ସାମିଲ ନଥାଇପାରେ।`,
      `ଉତ୍ସ (Sources): ${finalSources.join(', ')}`,
    ].join('\n');

    const result = {
      category: 'gold_rate',
      location,
      answer,
      sources: finalSources,
      contextText,
      timestamp: new Date().toISOString(),
    };

    goldCache = result;
    lastCacheTime = now;
    return result;
  } catch (err) {
    console.warn('[GoldRatesCollector] fetch error:', err.message);
    return null;
  }
}

module.exports = {
  collectGoldRates,
};

