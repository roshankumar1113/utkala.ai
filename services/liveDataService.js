/**
 * services/liveDataService.js
 * Comprehensive Live Odia Data Orchestration Engine.
 * 
 * Collectors:
 *  1. Weather / IMD: Open-Meteo live API + IMD Bhubaneswar bulletins (all 30 districts)
 *  2. SRC Odisha: Special Relief Commissioner alerts (cyclone, flood, heavy rain)
 *  3. Gold & Silver: Daily bullion rates (24K / 22K per gram) via Goodreturns/NDTV
 *  4. Mandi Rates: Agmarknet & APMC commodity rates (paddy, rice, vegetables)
 *  5. General Live Fallback: Real-time search via Tavily for other daily rates/news
 * 
 * Rules:
 *  - Live data is NOT permanent RAG content; fetched fresh with short cache.
 *  - Every answer includes source name and timestamp.
 *  - Never invent a number. If data is unavailable, declare honestly in Odia.
 *  - Audit logging to data/live_audit_log.jsonl.
 */

const axios = require('axios');
const { collectImdWeather, ODISHA_DISTRICTS } = require('./collectors/imdWeatherCollector');
const { collectSrcAlerts } = require('./collectors/srcAlertsCollector');
const { collectGoldRates } = require('./collectors/goldRatesCollector');
const { collectMandiRates } = require('./collectors/mandiRatesCollector');
const { recordLiveAudit } = require('./liveAuditLog');

const LIVE_PROMPT_RULE = `
### LIVE DATA RULES & CURRENT INFORMATION (MANDATORY & HIGHEST PRIORITY):
1. The user may ask about current weather, IMD bulletins, SRC cyclone/flood alerts, gold/silver rates, or mandi/crop prices.
2. If a section titled "[LIVE WEATHER ...]", "[LIVE SRC ODISHA ...]", "[LIVE GOLD ...]", "[LIVE MANDI ...]", or "[LIVE WEB RESULTS]" is present in context, answer ONLY from it.
3. STRICT SOURCE & TIMESTAMP ATTRIBUTION:
   - Always cite the exact source name (e.g. "Open-Meteo", "IMD ଭୁବନେଶ୍ୱର", "SRC Odisha", "Goodreturns", "Agmarknet").
   - Explicitly state that the data is live and current for today.
   - If sources differ or conflict, prioritize the official government bulletin (IMD/SRC/Agmarknet).
4. HONESTY GUARANTEE (ZERO HALLUCINATION):
   - If no live context is present or data is unavailable, state honestly in fluent Odia:
     "ଏହି ତଥ୍ୟ ବର୍ତ୍ତମାନ ଉପଲବ୍ଧ ନାହିଁ। ଦୟାକରି ସରକାରୀ ପୋର୍ଟାଲ୍ କିମ୍ବା ସମ୍ପୃକ୍ତ ବିଭାଗ ଯାଞ୍ଚ କରନ୍ତୁ।"
     (English: "I do not have live information for this right now. Please confirm on the official government portal.")
   - NEVER invent, extrapolate, or guess any temperature, gold rate, mandi price, date, or cyclone alert.
5. LANGUAGE & UNITS:
   - Deliver responses in authentic, respectful native Odia script (ଓଡ଼ିଆ) by default (English only if selected).
   - District names, commodities (e.g. ଧାନ, ସୁନା), and temperatures must be clear and readable.
   - For government schemes, always state "potentially suitable" (ସମ୍ଭାବ୍ୟ ଉପଯୁକ୍ତ).
`;

// Intent classification helpers
function isWeatherQuery(text) {
  return /(weather|temperature|forecast|rainfall?|monsoon|climate|humid|panipat|tapa|barsha|tapamatra|storm|ପାଣିପାଗ|ତାପମାତ୍ରା|ବର୍ଷା|ଖରା|କୁହୁଡ଼ି|ପବନ|ଶୀତ|ଗ୍ରୀଷ୍ମ|ପାଗ)/i.test(text || '');
}

function isSrcAlertQuery(text) {
  return /(src|special relief commissioner|cyclone|flood|alert|warning|disaster|heavy rain|calamity|ବାତ୍ୟା|ବନ୍ୟା|ସତର୍କ|ସତର୍କତା|ବିପର୍ଯ୍ୟୟ|ଜରୁରୀକାଳୀନ)/i.test(text || '');
}

function isGoldQuery(text) {
  return /(gold|silver|bullion|24k|22k|carat|karat|sona|rupa|per gram|gold rate|silver rate|ସୁନା|ରୂପା|ସୁନା ଦର|ରୁପା|ଗହଣା)/i.test(text || '');
}

function isMandiQuery(text) {
  return /(mandi|agmarknet|paddy|dhan|rice|msp|crop price|market rate|vegetable price|onion|potato|ମଣ୍ଡି|ଧାନ|ଚାଉଳ|ଫସଲ ଦର|ସହାୟକ ମୂଲ୍ୟ|ଆଳୁ|ପିଆଜ)/i.test(text || '');
}

function isGeneralLiveQuery(text) {
  return /(today|current|now|latest|recent|news|update|status|price|rate|deadline|petrol|diesel|ଆଜି|ବର୍ତ୍ତମାନ|ତାଜା|ନୂଆ|ଖବର|ଦର|ମୂଲ୍ୟ|ତାରିଖ|ଅପଡେଟ)/i.test(text || '');
}

const isLiveSearchQuery = isGeneralLiveQuery;

function isAnyLiveQuery(text) {
  return isWeatherQuery(text) || isSrcAlertQuery(text) || isGoldQuery(text) || isMandiQuery(text) || isGeneralLiveQuery(text);
}

// Backward-compatible fetchWeather (delegates to imdWeatherCollector)
async function fetchWeather(userMessage) {
  const data = await collectImdWeather(userMessage);
  if (!data) return null;
  return {
    contextText: `[LIVE WEATHER - Open-Meteo live data]\n${data.contextText}`,
    sources: Array.from(new Set(['Open-Meteo live data', ...(data.sources || [])])),
  };
}

// General Web Search via Tavily
async function fetchWebSearch(userMessage) {
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (!tavilyKey || tavilyKey.includes('your_') || tavilyKey.includes('placeholder')) {
    return null;
  }

  try {
    let query = userMessage.trim();
    if (!/odisha|ଓଡ଼ିଶା/i.test(query) && !/india|ଭାରତ/i.test(query)) {
      query = `${query} Odisha`;
    }

    const resp = await axios.post(
      'https://api.tavily.com/search',
      {
        api_key: tavilyKey,
        query,
        search_depth: 'basic',
        include_answer: true,
        max_results: 4,
      },
      { timeout: 6000 }
    );

    const data = resp.data;
    const results = Array.isArray(data?.results) ? data.results : [];
    if (results.length === 0 && !data?.answer) {
      return null;
    }

    const todayDate = new Date().toISOString().split('T')[0];
    const sourceChips = [];
    const resultLines = [];

    if (data.answer) {
      resultLines.push(`Direct Live Summary: ${data.answer}`);
    }

    results.forEach((item, idx) => {
      let srcName = 'Live Web Search';
      try {
        const domain = new URL(item.url).hostname.replace(/^www\./, '');
        if (/ndtv/i.test(domain)) srcName = 'NDTV';
        else if (/sambad/i.test(domain)) srcName = 'Sambad';
        else if (/otv|odishatv/i.test(domain)) srcName = 'Odisha TV';
        else if (/dharitri/i.test(domain)) srcName = 'Dharitri';
        else if (/prameya/i.test(domain)) srcName = 'Prameya';
        else if (/thehindu/i.test(domain)) srcName = 'The Hindu';
        else if (/indianexpress/i.test(domain)) srcName = 'Indian Express';
        else if (/timesofindia|indiatimes/i.test(domain)) srcName = 'Times of India';
        else if (/odisha\.gov\.in/i.test(domain)) srcName = 'Odisha Government Portal';
        else srcName = domain || 'Live Web Source';
      } catch (_) {}

      if (!sourceChips.includes(srcName)) sourceChips.push(srcName);
      resultLines.push(
        `${idx + 1}. [${srcName}] ${item.title}\n   Snippet: ${item.content || item.raw_content || ''}\n   URL: ${item.url}`
      );
    });

    const contextText = [
      `[LIVE WEB RESULTS]`,
      `Query: "${query}" (Fetched live via Tavily Search on ${todayDate})`,
      ...resultLines,
    ].join('\n');

    return {
      contextText,
      sources: sourceChips.length > 0 ? sourceChips : ['Live Web Search'],
    };
  } catch (err) {
    console.warn('[LiveDataService Tavily] fetch error:', err.message);
    return null;
  }
}

/**
 * Main Live Orchestrator: Detects category, calls dedicated collector,
 * audits transaction, and returns structured context blocks and source chips.
 * 
 * @param {string} userMessage - User query
 * @returns {Promise<{ contextText: string, sources: string[] } | null>}
 */
async function fetchLiveContext(userMessage) {
  if (!userMessage || typeof userMessage !== 'string') return null;

  const weatherNeed = isWeatherQuery(userMessage);
  const srcAlertNeed = isSrcAlertQuery(userMessage);
  const goldNeed = isGoldQuery(userMessage);
  const mandiNeed = isMandiQuery(userMessage);
  const generalLiveNeed = isGeneralLiveQuery(userMessage);

  if (!weatherNeed && !srcAlertNeed && !goldNeed && !mandiNeed && !generalLiveNeed) {
    return null;
  }

  const results = [];
  const sources = [];

  // 1. SRC Odisha Disaster & Cyclone Alerts (High Priority)
  if (srcAlertNeed) {
    const srcData = await collectSrcAlerts();
    if (srcData) {
      results.push(srcData.contextText);
      sources.push(...srcData.sources);
      recordLiveAudit({
        category: 'src_alert',
        query: userMessage,
        source: srcData.sources.join(', '),
        valuePreview: srcData.contextText.slice(0, 150),
      });
    }
  }

  // 2. Weather & IMD Bulletins
  if (weatherNeed) {
    const weatherData = await collectImdWeather(userMessage);
    if (weatherData) {
      results.push(weatherData.contextText);
      sources.push(...weatherData.sources);
      recordLiveAudit({
        category: 'weather',
        query: userMessage,
        source: weatherData.sources.join(', '),
        valuePreview: `${weatherData.location}: ${weatherData.temperature}°C, ${weatherData.conditionOdia}`,
      });
    }
  }

  // 3. Gold & Silver Prices
  if (goldNeed) {
    const goldData = await collectGoldRates();
    if (goldData) {
      results.push(goldData.contextText);
      sources.push(...goldData.sources);
      recordLiveAudit({
        category: 'gold_rate',
        query: userMessage,
        source: goldData.sources.join(', '),
        valuePreview: goldData.answer ? goldData.answer.slice(0, 150) : 'Gold price retrieved',
      });
    }
  }

  // 4. Mandi & Crop Prices (Paddy, etc.)
  if (mandiNeed) {
    const mandiData = await collectMandiRates(userMessage);
    if (mandiData) {
      results.push(mandiData.contextText);
      sources.push(...mandiData.sources);
      recordLiveAudit({
        category: 'mandi_rate',
        query: userMessage,
        source: mandiData.sources.join(', '),
        valuePreview: mandiData.answer ? mandiData.answer.slice(0, 150) : 'Mandi rate retrieved',
      });
    }
  }

  // 5. General Live Search Fallback (if specific collector did not match or for other commodities/news)
  if (generalLiveNeed && !weatherNeed && !srcAlertNeed && !goldNeed && !mandiNeed) {
    const webData = await fetchWebSearch(userMessage);
    if (webData) {
      results.push(webData.contextText);
      sources.push(...webData.sources);
      recordLiveAudit({
        category: 'general_web',
        query: userMessage,
        source: webData.sources.join(', '),
        valuePreview: webData.contextText.slice(0, 150),
      });
    }
  }

  if (results.length === 0) {
    recordLiveAudit({
      category: 'live_query_unfulfilled',
      query: userMessage,
      source: 'None',
      valuePreview: 'All live collectors returned null / unavailable',
      status: 'unfulfilled',
    });
    return null;
  }

  return {
    contextText: results.join('\n\n---\n\n'),
    sources: Array.from(new Set(sources)),
  };
}

module.exports = {
  fetchLiveContext,
  LIVE_PROMPT_RULE,
  isWeatherQuery,
  isSrcAlertQuery,
  isGoldQuery,
  isMandiQuery,
  isGeneralLiveQuery,
  isLiveSearchQuery,
  isAnyLiveQuery,
  fetchWeather,
  fetchWebSearch,
  collectImdWeather,
  collectSrcAlerts,
  collectGoldRates,
  collectMandiRates,
};
