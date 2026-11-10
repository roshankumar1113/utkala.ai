/**
 * services/collectors/imdWeatherCollector.js
 * Weather & IMD Forecast Collector for Odisha.
 * Sources: Open-Meteo live API (numerical forecasts) + IMD Bhubaneswar bulletins.
 * Covers all 30 Odisha districts and major urban centers in Odia & English.
 * Cache duration: 1 hour.
 */

const axios = require('axios');
const cheerio = require('cheerio');

// All 30 Odisha districts and major cities mapped with latitude/longitude
const ODISHA_DISTRICTS = [
  { name: 'Bhubaneswar', nameOr: 'ଭୁବନେଶ୍ୱର', alt: /bhubaneswar|ଭୁବନେଶ୍ୱର|ଭୁବନେଶ୍ବର|bbsr/i, lat: 20.2961, lon: 85.8245 },
  { name: 'Cuttack', nameOr: 'କଟକ', alt: /cuttack|କଟକ/i, lat: 20.4625, lon: 85.8828 },
  { name: 'Puri', nameOr: 'ପୁରୀ', alt: /puri|ପୁରୀ/i, lat: 19.8135, lon: 85.8312 },
  { name: 'Rourkela', nameOr: 'ରାଉରକେଲା', alt: /rourkela|ରାଉରକେଲା/i, lat: 22.2604, lon: 84.8536 },
  { name: 'Sambalpur', nameOr: 'ସମ୍ବଲପୁର', alt: /sambalpur|ସମ୍ବଲପୁର/i, lat: 21.4669, lon: 83.9812 },
  { name: 'Berhampur', nameOr: 'ବ୍ରହ୍ମପୁର', alt: /berhampur|brahmapur|ବ୍ରହ୍ମପୁର|ଗଞ୍ଜାମ|ganjam/i, lat: 19.3149, lon: 84.7941 },
  { name: 'Balasore', nameOr: 'ବାଲେଶ୍ୱର', alt: /balasore|baleswar|ବାଲେଶ୍ୱର|ବାଲେଶ୍ବର/i, lat: 21.4934, lon: 86.9135 },
  { name: 'Baripada', nameOr: 'ବାରିପଦା', alt: /baripada|ମୟୂରଭଞ୍ଜ|mayurbhanj|ବାରିପଦା/i, lat: 21.9346, lon: 86.7368 },
  { name: 'Angul', nameOr: 'ଅନୁଗୋଳ', alt: /angul|ଅନୁଗୋଳ/i, lat: 20.8444, lon: 85.1511 },
  { name: 'Bhadrak', nameOr: 'ଭଦ୍ରକ', alt: /bhadrak|ଭଦ୍ରକ/i, lat: 21.0544, lon: 86.5186 },
  { name: 'Balangir', nameOr: 'ବଲାଙ୍ଗୀର', alt: /balangir|bolangir|ବଲାଙ୍ଗୀର|ବଲାଙ୍ଗିର/i, lat: 20.7107, lon: 83.4862 },
  { name: 'Bargarh', nameOr: 'ବରଗଡ଼', alt: /bargarh|ବରଗଡ଼|ବରଗଡ/i, lat: 21.3333, lon: 83.6167 },
  { name: 'Boudh', nameOr: 'ବୌଦ୍ଧ', alt: /boudh|bauda|ବୌଦ୍ଧ/i, lat: 20.8417, lon: 84.3264 },
  { name: 'Deogarh', nameOr: 'ଦେବଗଡ଼', alt: /deogarh|debagarh|ଦେବଗଡ଼/i, lat: 21.5333, lon: 84.7333 },
  { name: 'Dhenkanal', nameOr: 'ଢେଙ୍କାନାଳ', alt: /dhenkanal|ଢେଙ୍କାନାଳ/i, lat: 20.6667, lon: 85.6000 },
  { name: 'Gajapati', nameOr: 'ଗଜପତି', alt: /gajapati|paralakhemundi|ଗଜପତି|ପାରଳାଖେମୁଣ୍ଡି/i, lat: 18.7758, lon: 84.0911 },
  { name: 'Jagatsinghpur', nameOr: 'ଜଗତସିଂହପୁର', alt: /jagatsinghpur|paradeep|ପାରାଦୀପ|ଜଗତସିଂହପୁର/i, lat: 20.2667, lon: 86.1667 },
  { name: 'Jajpur', nameOr: 'ଯାଜପୁର', alt: /jajpur|ଯାଜପୁର/i, lat: 20.8500, lon: 86.3333 },
  { name: 'Jharsuguda', nameOr: 'ଝାରସୁଗୁଡ଼ା', alt: /jharsuguda|ଝାରସୁଗୁଡ଼ା|ଝାରସୁଗୁଡା/i, lat: 21.8554, lon: 84.0062 },
  { name: 'Kalahandi', nameOr: 'କଳାହାଣ୍ଡି', alt: /kalahandi|bhawanipatna|କଳାହାଣ୍ଡି|ଭବାନୀପାଟଣା/i, lat: 19.9075, lon: 83.1647 },
  { name: 'Kandhamal', nameOr: 'କନ୍ଧମାଳ', alt: /kandhamal|phulbani|କନ୍ଧମାଳ|ଫୁଲବାଣୀ/i, lat: 20.4792, lon: 84.2342 },
  { name: 'Kendrapara', nameOr: 'କେନ୍ଦ୍ରାପଡ଼ା', alt: /kendrapara|କେନ୍ଦ୍ରାପଡ଼ା|କେନ୍ଦ୍ରାପଡା/i, lat: 20.5000, lon: 86.4167 },
  { name: 'Kendujhar', nameOr: 'କେନ୍ଦୁଝର', alt: /kendujhar|keonjhar|କେନ୍ଦୁଝର/i, lat: 21.6333, lon: 85.5833 },
  { name: 'Khordha', nameOr: 'ଖୋର୍ଦ୍ଧା', alt: /khordha|khurda|ଖୋର୍ଦ୍ଧା|ଖୋର୍ଦ୍ଧା/i, lat: 20.1833, lon: 85.6167 },
  { name: 'Koraput', nameOr: 'କୋରାପୁଟ', alt: /koraput|jeypore|କୋରାପୁଟ|ଜୟପୁର/i, lat: 18.8135, lon: 82.7123 },
  { name: 'Malkangiri', nameOr: 'ମାଲକାନଗିରି', alt: /malkangiri|ମାଲକାନଗିରି/i, lat: 18.3500, lon: 81.9000 },
  { name: 'Nabarangpur', nameOr: 'ନବରଙ୍ଗପୁର', alt: /nabarangpur|nowrangpur|ନବରଙ୍ଗପୁର/i, lat: 19.2333, lon: 82.5500 },
  { name: 'Nayagarh', nameOr: 'ନୟାଗଡ଼', alt: /nayagarh|ନୟାଗଡ଼|ନୟାଗଡ/i, lat: 20.1333, lon: 85.1000 },
  { name: 'Nuapada', nameOr: 'ନୂଆପଡ଼ା', alt: /nuapada|ନୂଆପଡ଼ା|ନୂଆପଡା/i, lat: 20.8333, lon: 82.5333 },
  { name: 'Rayagada', nameOr: 'ରାୟଗଡ଼', alt: /rayagada|ରାୟଗଡ଼|ରାୟଗଡ/i, lat: 19.1667, lon: 83.4167 },
  { name: 'Subarnapur', nameOr: 'ସୁବର୍ଣ୍ଣପୁର', alt: /subarnapur|sonepur|ସୁବର୍ଣ୍ଣପୁର|ସୋନପୁର/i, lat: 20.8333, lon: 83.9167 },
  { name: 'Sundargarh', nameOr: 'ସୁନ୍ଦରଗଡ଼', alt: /sundargarh|ସୁନ୍ଦରଗଡ଼|ସୁନ୍ଦରଗଡ/i, lat: 22.1167, lon: 84.0333 },
];

function weatherCodeToOdia(code) {
  if (code === 0) return { odia: 'ନିର୍ମଳ ସ୍ୱଚ୍ଛ ଆକାଶ', en: 'Clear sky' };
  if ([1, 2, 3].includes(code)) return { odia: 'ଆଂଶିକ ମେଘୁଆ ପାଗ', en: 'Partly cloudy' };
  if ([45, 48].includes(code)) return { odia: 'କୁହୁଡ଼ିଆ ପାଗ', en: 'Foggy' };
  if ([51, 53, 55].includes(code)) return { odia: 'ହାଲୁକା ଝିପିଝିପି ବର୍ଷା', en: 'Light drizzle' };
  if ([61, 63, 65].includes(code)) return { odia: 'ବର୍ଷା ସମ୍ଭାବନା', en: 'Rain showers' };
  if ([80, 81, 82].includes(code)) return { odia: 'ପ୍ରବଳ ବର୍ଷା', en: 'Heavy rain' };
  if ([95, 96, 99].includes(code)) return { odia: 'ବିଜୁଳି ଘଡ଼ଘଡ଼ି ସହ ବର୍ଷା', en: 'Thunderstorm' };
  return { odia: 'ମେଘାଚ୍ଛନ୍ନ ପାଗ', en: 'Overcast cloudy' };
}

// 1-hour in-memory cache
const weatherCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000;

function resolveLocation(text) {
  if (!text) return ODISHA_DISTRICTS[0];
  for (const dist of ODISHA_DISTRICTS) {
    if (dist.alt.test(text)) return dist;
  }
  return ODISHA_DISTRICTS[0]; // Default: Bhubaneswar
}

async function fetchImdBulletin() {
  try {
    const resp = await axios.get('https://mausam.imd.gov.in/bhubaneswar/', {
      timeout: 5000,
      headers: { 'User-Agent': 'UtkalAI-WeatherBot/1.0' }
    });
    if (resp.status === 200 && resp.data) {
      const $ = cheerio.load(resp.data);
      const marquee = $('marquee').text().replace(/\s+/g, ' ').trim();
      return marquee || null;
    }
  } catch (_) {}
  return null;
}

/**
 * Collects live weather data for Odisha locations.
 * @param {string} query - user query text
 * @returns {Promise<Object|null>}
 */
async function collectImdWeather(query = '') {
  const loc = resolveLocation(query);
  const cacheKey = `weather_${loc.name}`;
  const now = Date.now();

  if (weatherCache.has(cacheKey)) {
    const cached = weatherCache.get(cacheKey);
    if (now - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto`;
    const resp = await axios.get(url, { timeout: 4500 });
    const cur = resp.data?.current;

    if (!cur) return null;

    const condition = weatherCodeToOdia(cur.weather_code);
    const todayDate = new Date().toISOString().split('T')[0];

    // Optional IMD bulletin check
    const imdNotice = await fetchImdBulletin();
    const sources = ['Open-Meteo Live Data'];
    let imdSection = '';
    if (imdNotice) {
      sources.push('IMD Bhubaneswar');
      imdSection = `\nIMD ବୁଲେଟିନ୍ / ସୂଚନା: ${imdNotice}`;
    }

    const contextText = [
      `[LIVE WEATHER & IMD UPDATE - ${loc.nameOr} (${loc.name}), ODISHA]`,
      `ସ୍ଥାନ (Location): ${loc.nameOr} (${loc.name}), ଓଡ଼ିଶା`,
      `ତାରିଖ (Date): ${todayDate} (ଲାଇଭ୍ ତଥ୍ୟ)`,
      `ତାପମାତ୍ରା (Temperature): ${cur.temperature_2m}°C`,
      `ଅନୁଭୂତ ତାପମାତ୍ରା (Feels Like): ${cur.apparent_temperature}°C`,
      `ପାଣିପାଗ ସ୍ଥିତି (Condition): ${condition.odia} (${condition.en})`,
      `ଆର୍ଦ୍ରତା (Humidity): ${cur.relative_humidity_2m}%`,
      `ପବନର ବେଗ (Wind Speed): ${cur.wind_speed_10m} km/h`,
      imdSection,
      `ଉତ୍ସ (Source): ${sources.join(', ')}`,
      `ସମୟ (Timestamp): ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`
    ].filter(Boolean).join('\n');

    const result = {
      category: 'weather',
      location: loc.name,
      locationOr: loc.nameOr,
      temperature: cur.temperature_2m,
      conditionOdia: condition.odia,
      conditionEn: condition.en,
      humidity: cur.relative_humidity_2m,
      windSpeed: cur.wind_speed_10m,
      imdBulletin: imdNotice,
      sources,
      contextText,
      timestamp: new Date().toISOString(),
    };

    weatherCache.set(cacheKey, { timestamp: now, data: result });
    return result;
  } catch (err) {
    console.warn('[ImdWeatherCollector] fetch error:', err.message);
    return null;
  }
}

module.exports = {
  collectImdWeather,
  ODISHA_DISTRICTS,
  resolveLocation,
  weatherCodeToOdia,
};

