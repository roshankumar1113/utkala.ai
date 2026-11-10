/**
 * services/collectors/srcAlertsCollector.js
 * Collector for Special Relief Commissioner (SRC), Odisha alerts.
 * Monitors cyclone warnings, flood bulletins, heavy rainfall alerts, and disaster advisories.
 * Source: https://srcodisha.nic.in + Tavily official government news fallback.
 * Cache duration: 15 minutes (strictly fresh for disaster preparedness).
 */

const axios = require('axios');
const cheerio = require('cheerio');

let srcCache = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

async function fetchFromSrcPortal() {
  try {
    const resp = await axios.get('https://srcodisha.nic.in', {
      timeout: 6000,
      headers: {
        'User-Agent': 'UtkalAI-DisasterAlertBot/1.0',
        'Accept': 'text/html,application/xhtml+xml',
      }
    });

    if (resp.status === 200 && resp.data) {
      const $ = cheerio.load(resp.data);
      const marqueeText = $('marquee').text().replace(/\s+/g, ' ').trim();
      const newsItems = [];

      $('a, li, p').each((_, el) => {
        const t = $(el).text().replace(/\s+/g, ' ').trim();
        if (/warning|cyclone|flood|alert|situation report|heavy rain|ସତର୍କ|ବାତ୍ୟା|ବନ୍ୟା/i.test(t) && t.length > 20 && t.length < 250) {
          if (!newsItems.includes(t)) newsItems.push(t);
        }
      });

      return {
        marquee: marqueeText || null,
        alerts: newsItems.slice(0, 4),
      };
    }
  } catch (err) {
    console.warn('[SrcAlertsCollector] Direct portal error:', err.message);
  }
  return null;
}

async function fetchFromTavilyFallback() {
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (!tavilyKey || tavilyKey.includes('your_') || tavilyKey.includes('placeholder')) {
    return null;
  }

  try {
    const resp = await axios.post(
      'https://api.tavily.com/search',
      {
        api_key: tavilyKey,
        query: 'Odisha SRC Special Relief Commissioner cyclone rain alert weather warning today',
        search_depth: 'basic',
        include_answer: true,
        max_results: 3,
      },
      { timeout: 6000 }
    );

    const answer = resp.data?.answer || '';
    const results = resp.data?.results || [];
    if (answer || results.length > 0) {
      return {
        summary: answer,
        sources: results.map(r => r.title || 'SRC Odisha Update').slice(0, 2),
      };
    }
  } catch (err) {
    console.warn('[SrcAlertsCollector] Tavily fallback error:', err.message);
  }
  return null;
}

/**
 * Collects live SRC Odisha disaster warnings and emergency alerts.
 * @returns {Promise<Object|null>}
 */
async function collectSrcAlerts() {
  const now = Date.now();
  if (srcCache && (now - lastCacheTime < CACHE_TTL_MS)) {
    return srcCache;
  }

  const portalData = await fetchFromSrcPortal();
  const todayDate = new Date().toISOString().split('T')[0];
  const timeStr = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });

  if (portalData && (portalData.marquee || portalData.alerts.length > 0)) {
    const alertsList = portalData.alerts.length > 0
      ? portalData.alerts.map((a, i) => `${i + 1}. ${a}`).join('\n')
      : 'ବର୍ତ୍ତମାନ କୌଣସି ଜରୁରୀକାଳୀନ ସତର୍କ ସୂଚନା (Emergency Alert) ଜାରି କରାଯାଇ ନାହିଁ। ପରିସ୍ଥିତି ସ୍ୱାଭାବିକ ଅଛି।';

    const contextText = [
      `[LIVE SRC ODISHA DISASTER & WEATHER ALERTS]`,
      `ତାରିଖ (Date): ${todayDate} (${timeStr} IST ରେ ପ୍ରାପ୍ତ ତଥ୍ୟ)`,
      `ସରକାରୀ ସଂସ୍ଥା: ସ୍ୱତନ୍ତ୍ର ରିଲିଫ୍ କମିଶନର (SRC), ଓଡ଼ିଶା ସରକାର`,
      `ସଦ୍ୟତମ ସୂଚନା / ବୁଲେଟିନ୍:\n${portalData.marquee || 'ଦୈନିକ ପାଣିପାଗ ଏବଂ ସ୍ଥିତି ରିପୋର୍ଟ ସ୍ୱାଭାବିକ'}`,
      `ମୁଖ୍ୟ ସତର୍କତା (Alerts):\n${alertsList}`,
      `ଉତ୍ସ (Source): SRC Odisha Official Portal (srcodisha.nic.in)`,
    ].join('\n');

    const result = {
      category: 'src_alert',
      hasActiveAlert: portalData.alerts.length > 0,
      alerts: portalData.alerts,
      marquee: portalData.marquee,
      sources: ['SRC Odisha Portal'],
      contextText,
      timestamp: new Date().toISOString(),
    };

    srcCache = result;
    lastCacheTime = now;
    return result;
  }

  // If direct portal was unreachable, try live web fallback
  const tavilyData = await fetchFromTavilyFallback();
  if (tavilyData) {
    const contextText = [
      `[LIVE SRC ODISHA DISASTER & WEATHER ALERTS]`,
      `ତାରିଖ (Date): ${todayDate} (${timeStr} IST ରେ ପ୍ରାପ୍ତ ତଥ୍ୟ)`,
      `ସରକାରୀ ସଂସ୍ଥା: ସ୍ୱତନ୍ତ୍ର ରିଲିଫ୍ କମିଶନର (SRC) / ସରକାରୀ ସୂଚନା`,
      `ପ୍ରମୁଖ ବିବରଣୀ: ${tavilyData.summary || 'ବର୍ତ୍ତମାନ କୌଣସି ବଡ଼ ବାତ୍ୟା ବା ବନ୍ୟା ସତର୍କତା ନାହିଁ।'}`,
      `ଉତ୍ସ (Source): SRC Odisha / Public Advisory`,
    ].join('\n');

    const result = {
      category: 'src_alert',
      hasActiveAlert: Boolean(tavilyData.summary),
      alerts: [tavilyData.summary],
      sources: ['SRC Odisha / Public Advisory'],
      contextText,
      timestamp: new Date().toISOString(),
    };

    srcCache = result;
    lastCacheTime = now;
    return result;
  }

  // Honest "not available" response if both failed (NEVER invent alerts)
  return null;
}

module.exports = {
  collectSrcAlerts,
};

