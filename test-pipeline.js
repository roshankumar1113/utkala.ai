require('dotenv').config();
const geminiService = require('./services/ledgerParserService');

// Sample Odia text phrases to test the parsing extraction and training prompts
const TEST_CASES = [
  {
    title: 'Standard Sale on Credit (Sambalpuri Saree - Ramesh)',
    text: 'ରମେଶଙ୍କୁ ୧୨,୦୦୦ ଟଙ୍କାର ସମ୍ବଲପୁରୀ ଶାଢ଼ୀ ବିକ୍ରି କଲି।'
  },
  {
    title: 'Receive Cash (500 INR - Hari)',
    text: 'ହରି ମୋତେ ନଗଦ ୫୦୦ ଟଙ୍କା ଦେଲା।'
  },
  {
    title: 'Credit Purchase of Grocery (Shyam Bhai)',
    text: 'ଶ୍ୟାମ ଭାଇଙ୍କ ଠାରୁ ୨୦୦୦ ଟଙ୍କାର ରାସନ ସାମଗ୍ରୀ ବାକିରେ ଆଣିଲି।'
  },
  {
    title: 'Online Payment (300 INR via PhonePe - Ranjan)',
    text: 'ରଞ୍ଜନ କୁ ୩୦୦ ଟଙ୍କା ଫୋନପେ ରେ ପଠେଇଲି।'
  },
  {
    title: 'Custom Sale (5000 INR of Cement - Pradhan Store in cash)',
    text: 'ପ୍ରଧାନ ଷ୍ଟୋରକୁ ପାଞ୍ଚ ହଜାର ଟଙ୍କାର ସିମେଣ୍ଟ ନଗଦ ବିକ୍ରି କଲି।'
  }
];

async function runTests() {
  console.log('==================================================');
  console.log('🧪 Starting Odia.ai Gemini Extractor Test Bench');
  console.log('==================================================');

  // Verify API Key existence
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey || geminiKey === 'your_gemini_api_key_here') {
    console.error('❌ Error: GEMINI_API_KEY is not configured in .env file.');
    console.log('Please add your API key to .env before running this test.');
    process.exit(1);
  }

  console.log('✅ GEMINI_API_KEY verified.');
  console.log(`Running ${TEST_CASES.length} test cases...\n`);

  for (let i = 0; i < TEST_CASES.length; i++) {
    const testCase = TEST_CASES[i];
    console.log(`[Test #${i + 1}] Running: "${testCase.title}"`);
    console.log(`👉 Spoken Text: "${testCase.text}"`);

    try {
      const result = await geminiService.analyzeTransaction(testCase.text);
      console.log('🟢 Output JSON:');
      console.log(JSON.stringify(result, null, 2));
      console.log('--------------------------------------------------');
    } catch (error) {
      console.error('🔴 Test Failed:');
      console.error(error.message);
      console.log('--------------------------------------------------');
    }
  }

  console.log('\n🏁 Test suite completed!');
  console.log('==================================================');
}

runTests();
