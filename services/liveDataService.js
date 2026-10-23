/**
 * liveDataService.js
 * Fetches real-time internet context (Live Weather via Open-Meteo and Web Search via Tavily).
 * Provides LIVE_PROMPT_RULE for strict live-data grounding and citation compliance.
 */

const axios = require('axios');

const LIVE_PROMPT_RULE = `
### LIVE DATA RULES (highest priority for current-information questions):
- The system may include a section titled "LIVE WEATHER" or "LIVE WEB RESULTS"
  in your context. That data was fetched from the internet just now.
- If live data is present and covers the question, answer ONLY from it.
  Always name the source (e.g. "according to NDTV" / "Open-Meteo live data")
  and say the information is from today.
- If two live sources give different numbers, show both briefly and say
  sources differ — do not pick one silently and do not average them.
- If the question needs current information (today's weather, prices, news,
  last dates, recent scheme updates) and NO live data section is present,
  reply exactly in this spirit: "I do not have live information for this
  right now. Please check the official website." NEVER invent a number,
  temperature, price, date or amount.
- Scheme money amounts may only be quoted from the knowledge context or the
  live results. If an amount is in neither, say "check the official portal
  for the current amount".
- For schemes, always say "potentially suitable" — never promise approval.
`;

const ODISHA_LOCATIONS = [
  { name: 'Bhubaneswar', alt: /bhubaneswar|ଭୁବନେଶ୍ୱର|ଭୁବନେଶ୍ବର/i, lat: 20.2961, lon: 85.8245 },
  { name: 'Cuttack', alt: /cuttack|କଟକ/i, lat: 20.4625, lon: 85.8828 },
  { name: 'Puri', alt: /puri|ପୁରୀ/i, lat: 19.8135, lon: 85.8312 },
  { name: 'Rourkela', alt: /rourkela|ରାଉରକେଲା/i, lat: 22.2604, lon: 84.8536 },
  { name: 'Sambalpur', alt: /sambalpur|ସମ୍ବଲପୁର/i, lat: 21.4669, lon: 83.9812 },
  { name: 'Berhampur', alt: /berhampur|brahmapur|ବ୍ରହ୍ମପୁର/i, lat: 19.3149, lon: 84.7941 },
  { name: 'Balasore', alt: /balasore|baleswar|ବାଲେଶ୍ୱର|ବାଲେଶ୍ବର/i, lat: 21.4934, lon: 86.9135 },
  { name: 'Baripada', alt: /baripada|ବାରିପଦା/i, lat: 21.9346, lon: 86.7368 },
  { name: 'Koraput', alt: /koraput|କୋରାପୁଟ/i, lat: 18.8135, lon: 82.7123 },
  { name: 'Jharsuguda', alt: /jharsuguda|ଝାରସୁଗୁଡ଼ା/i, lat: 21.8554, lon: 84.0062 },
  { name: 'Angul', alt: /angul|ଅନୁଗୋଳ/i, lat: 20.8444, lon: 85.1511 },
];

function weatherCodeText(code) {
  if (code === 0) return 'Clear sky / ସ୍ୱଚ୍ଛ ଆକାଶ';
  if ([1, 2, 3].includes(code)) return 'Partly cloudy / ଆଂଶିକ ମେଘୁଆ';
  if ([45, 48].includes(code)) return 'Foggy / କୁହୁଡ଼ି';
  if ([51, 53, 55].includes(code)) return 'Light drizzle / ହାଲୁକା ବର୍ଷା';
  if ([61, 63, 65].includes(code)) return 'Rain / ବର୍ଷା';
  if ([80, 81, 82].includes(code)) return 'Rain showers / ବର୍ଷା ଝଲକ';
  if ([95, 96, 99].includes(code)) return 'Thunderstorm / ବିଜୁଳି ଘଡ଼ଘଡ଼ି ସହ ବର୍ଷା';
  return 'Cloudy / ମେଘାଚ୍ଛନ୍ନ';
}

function isWeatherQuery(text) {
  return /(weather|temperature|forecast|rainfall?|monsoon|climate|humid|panipat|tapa|barsha|tapamatra|ପାଣିପାଗ|ତାପମାତ୍ରା|ବର୍ଷା|ଖରା|କୁହୁଡ଼ି|ପବନ)/i.test(text || '');
}

function isLiveSearchQuery(text) {
  return /(today|current|now|latest|recent|news|update|status|price|rate|mandigate|deadline|last date|gold rate|petrol|diesel|score|match|winner|result|ଆଜି|ବର୍ତ୍ତମାନ|ତାଜା|ନୂଆ|ଖବର|ଦର|ମୂଲ୍ୟ|ତାରିଖ|ଶେଷ ତାରିଖ|ଅପଡେଟ|ଫଳାଫଳ)/i.test(text || '');
}

async function fetchWeather(userMessage) {
  try {
    let loc = ODISHA_LOCATIONS[0]; // Default to Bhubaneswar
    for (const item of ODISHA_LOCATIONS) {
      if (item.alt.test(userMessage)) {
        loc = item;
        break;
      }
    }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto`;
    const resp = await axios.get(url, { timeout: 4000 });
    const current = resp.data?.current;
    if (!current) return null;

    const todayDate = new Date().toISOString().split('T')[0];
    const condition = weatherCodeText(current.weather_code);

    const contextText = [
      `[LIVE WEATHER - Open-Meteo live data]`,
      `Location: ${loc.name}, Odisha`,
      `Date: ${todayDate} (Fetched live from Open-Meteo just now)`,
      `Current Temperature: ${current.temperature_2m}°C`,
      `Feels Like: ${current.apparent_temperature}°C`,
      `Weather Condition: ${condition}`,
      `Relative Humidity: ${current.relative_humidity_2m}%`,
      `Wind Speed: ${current.wind_speed_10m} km/h`,
      `Source: Open-Meteo live data`,
    ].join('\n');

    return {
      contextText,
      sources: ['Open-Meteo live data'],
    };
  } catch (err) {
    console.warn('[LiveDataService Weather] fetch error:', err.message);
    return null;
  }
}

function cleanSourceName(url, title) {
  try {
    const domain = new URL(url).hostname.replace(/^www\./, '');
    if (/ndtv/i.test(domain)) return 'NDTV';
    if (/sambad/i.test(domain)) return 'Sambad';
    if (/otv|odishatv/i.test(domain)) return 'Odisha TV';
    if (/dharitri/i.test(domain)) return 'Dharitri';
    if (/prameya/i.test(domain)) return 'Prameya';
    if (/thehindu/i.test(domain)) return 'The Hindu';
    if (/indianexpress/i.test(domain)) return 'Indian Express';
    if (/timesofindia|indiatimes/i.test(domain)) return 'Times of India';
    if (/odisha\.gov\.in/i.test(domain)) return 'Odisha Government Portal';
    return domain || title || 'Live Web Search';
  } catch (_) {
    return title || 'Live Web Search';
  }
}

async function fetchWebSearch(userMessage) {
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (!tavilyKey || tavilyKey.includes('your_') || tavilyKey.includes('placeholder')) {
    return null;
  }

  try {
    // Append Odisha context if not already present in search query
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
      const srcName = cleanSourceName(item.url, item.title);
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
 * Main entry point: Inspects user question and fetches live context if applicable.
 * Weather needs no key (Open-Meteo). Web search uses TAVILY_API_KEY.
 *
 * @param {string} userMessage - User's chat message
 * @returns {Promise<{ contextText: string, sources: string[] } | null>}
 */
async function fetchLiveContext(userMessage) {
  if (!userMessage || typeof userMessage !== 'string') return null;

  const weatherNeed = isWeatherQuery(userMessage);
  const liveNeed = isLiveSearchQuery(userMessage);

  // If question is neither about weather nor current live events, skip live fetch to preserve speed
  if (!weatherNeed && !liveNeed) {
    return null;
  }

  const results = [];
  const sources = [];

  // Weather query (Zero-key Open-Meteo)
  if (weatherNeed) {
    const weatherData = await fetchWeather(userMessage);
    if (weatherData) {
      results.push(weatherData.contextText);
      sources.push(...weatherData.sources);
    } else {
      console.warn('[LiveDataService] fetchWeather returned null — Open-Meteo request failed or timed out. Query:', userMessage.substring(0, 80));
    }
  }

  // Web query via Tavily
  if (liveNeed) {
    const tavilyKey = process.env.TAVILY_API_KEY;
    if (!tavilyKey || tavilyKey.includes('your_') || tavilyKey.includes('placeholder')) {
      console.warn('[LiveDataService] fetchWebSearch skipped — TAVILY_API_KEY is missing or still a placeholder. Set it in environment variables to enable live web search.');
    } else {
      const webData = await fetchWebSearch(userMessage);
      if (webData) {
        results.push(webData.contextText);
        sources.push(...webData.sources);
      } else {
        console.warn('[LiveDataService] fetchWebSearch returned null — Tavily request failed or returned no results. Query:', userMessage.substring(0, 80));
      }
    }
  }

  if (results.length === 0) {
    console.warn('[LiveDataService] fetchLiveContext returning null — all live fetches failed or were skipped. weatherNeed=%s liveNeed=%s', weatherNeed, liveNeed);
    return null;
  }

  return {
    contextText: results.join('\n\n'),
    sources: Array.from(new Set(sources)),
  };
}

module.exports = {
  fetchLiveContext,
  LIVE_PROMPT_RULE,
  isWeatherQuery,
  isLiveSearchQuery,
  fetchWeather,
  fetchWebSearch,
};
