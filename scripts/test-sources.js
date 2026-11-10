require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');

async function inspectContent() {
  console.log('=== Testing Live Sources ===\n');

  // 1. IMD Bhubaneswar
  try {
    const resp = await axios.get('https://mausam.imd.gov.in/bhubaneswar/', {
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    const $ = cheerio.load(resp.data);
    const marquee = $('marquee').text().replace(/\s+/g, ' ').trim();
    console.log('1. IMD Bhubaneswar Portal: REACHABLE (HTTP 200)');
    console.log('   Marquee bulletin:', marquee.slice(0, 160) || 'Active bulletin present');
  } catch (e) {
    console.log('1. IMD Portal error:', e.message);
  }

  // 2. SRC Odisha
  try {
    const resp = await axios.get('https://srcodisha.nic.in', {
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    const $ = cheerio.load(resp.data);
    const title = $('title').text().trim();
    const marquee = $('marquee').text().replace(/\s+/g, ' ').trim();
    console.log('2. SRC Odisha Portal: REACHABLE (HTTP 200)');
    console.log('   Title:', title);
    console.log('   Alerts / marquee:', marquee.slice(0, 160) || 'None active');
  } catch (e) {
    console.log('2. SRC Portal error:', e.message);
  }

  // 3. Tavily Gold & Mandi query tests
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (tavilyKey && !tavilyKey.includes('your_')) {
    try {
      const gResp = await axios.post('https://api.tavily.com/search', {
        api_key: tavilyKey,
        query: 'today gold price in Odisha 24k 22k per gram Goodreturns NDTV',
        include_answer: true,
        max_results: 3
      }, { timeout: 8000 });
      console.log('3. Gold Price (Tavily Search): REACHABLE');
      console.log('   Direct Answer:', gResp.data?.answer?.slice(0, 150));
      console.log('   Top Source:', gResp.data?.results?.[0]?.title, '|', gResp.data?.results?.[0]?.url);
    } catch (e) {
      console.log('3. Gold query error:', e.message);
    }

    try {
      const mResp = await axios.post('https://api.tavily.com/search', {
        api_key: tavilyKey,
        query: 'Odisha mandi paddy price today Agmarknet rate per quintal',
        include_answer: true,
        max_results: 3
      }, { timeout: 8000 });
      console.log('4. Mandi Rates (Tavily / Agmarknet): REACHABLE');
      console.log('   Direct Answer:', mResp.data?.answer?.slice(0, 150));
      console.log('   Top Source:', mResp.data?.results?.[0]?.title, '|', mResp.data?.results?.[0]?.url);
    } catch (e) {
      console.log('4. Mandi query error:', e.message);
    }
  } else {
    console.log('TAVILY_API_KEY not configured or placeholder');
  }
}

inspectContent().catch(console.error);

