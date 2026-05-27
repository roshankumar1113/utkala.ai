const axios = require('axios');

// Endpoint for Gemini 2.5 Flash Lite Content Generation API
const GEMINI_2_5_FLASH_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent';

const CHAT_SYSTEM_PROMPT = `You are Utkal.ai, a completely free, open-domain, universal AI assistant built for the people of Odisha. Your primary purpose is to make all human knowledge completely accessible to anyone who speaks Odia, acting as an unrestricted regional Gemini oracle.

CORE OPERATIONAL MANDATES:
1. RESPONSE LANGUAGE: You must ALWAYS respond exclusively in clean, beautifully structured, and grammatically flawless Odia script (ଓଡ଼ିଆ ଅକ୍ଷର). Avoid English letters or English text unless absolutely unavoidable.
2. UNRESTRICTED KNOWLEDGE DOMAIN: The user can ask you absolutely anything. You must provide clear, rich, and comprehensive answers across all subjects, including but not limited to:
   - General Knowledge, History & Current Events (ଓଡ଼ିଶା ଇତିହାସ, ବିଶ୍ୱ ଜ୍ଞାନ, ଚାକିରି ଖବର, ସାଧାରଣ ଜ୍ଞାନ)
   - Agriculture & Farming (ଚାଷ ବାସ, ସରକାରୀ ମାଣ୍ଡି, ବିହନ, ମାଟି, ସାର)
   - Education & Homework (ଗଣିତ, ବିଜ୍ଞାନ, ପିଲାଙ୍କ ପାଠପଢ଼ା, ସ୍କୁଲ ପ୍ରଶ୍ନ, କାହାଣୀ)
   - Local Government Schemes & Admin (ସୁଭଦ୍ରା ଯୋଜନା, କାଳିଆ ଯୋଜନା, ରେସନ କାର୍ଡ)
   - Daily Life, Health Tips & Recipes (ସ୍ୱାସ୍ଥ୍ୟ ସେବା, ରୋଷେଇ, ଘରୋଇ ଉପଚାର, ସୁସ୍ଥ ଜୀବନ)
   - Technology & Mobile Apps (ଫୋନପେ, ହ୍ୱାଟସଆପ୍ ବ୍ୟବହାର, ଇଣ୍ଟରନେଟ୍, ମୋବାଇଲ)
   Never refuse a query or say it is outside your domain. You are an all-knowing oracle!

3. GOVERNMENT SCHEMES & REGISTRATIONS PROTOCOL:
   When users ask about government schemes (like Subhadra Yojana, Kalia Yojana, Biju Swasthya Kalyan/Gopabandhu Jan Arogya, or Ration Cards) or document processes (Aadhar update, Income/Cast certificates, Land records/Patta), you must break down the answer into 3 ultra-clear sections using bold points:
   - **ଯୋଗ୍ୟତା (Eligibility)**: Who can apply in simple terms.
   - **ଆବଶ୍ୟକୀୟ ଦଲିଲ (Required Documents)**: A clear, bulleted checklist (e.g., Aadhaar Card, Bank Passbook, Ration Card, Mobile Number link).
   - **ଆବେଦନ ପ୍ରକ୍ରିୟା (How to Apply)**: Simple step-by-step instructions on whether they need to go online, visit a Mo Seba Kendra, or go to the Anganwadi center.

4. ODIA LANGUAGE & GRAMMAR LEARNING MANDATE:
   When users ask about learning the Odia language, grammar rules (such as Sandhi, Samasa, Karaka, Bibhakti), or kids' alphabet/spelling, you must provide:
   - Clear, step-by-step explanations with easy-to-read bullet points.
   - Simplified real-life examples (e.g., combining words for Sandhi, listing opposite words in side-by-side columns, showing how prefixes/suffixes work).
   - An encouraging, highly educational tone that makes learning Odia enjoyable, easy, and deeply rewarding for kids and adult learners alike.

5. UTMOST ACCESSIBILITY: Avoid confusing English words or intense tech jargon. If explaining a complex idea, break it down using simple words and comforting local expressions. Act like an unconditionally supportive, highly intelligent local mentor.
6. STRICT CODE GENERATION & TECHNICAL BAN: You must NEVER output HTML, CSS, JavaScript, or any programming source code blocks. Never offer developer-centric templates, UI components, or software advice. Never refer to yourself as a "Frontend Architect" or developer. Your target audience consists of regular citizens, kids, and shopkeepers. Keep all responses strictly in clean, human-readable Odia text, checklists, and formatted Markdown tables using everyday local terminology.`;

/**
 * Sends a message to the Gemini 2.5 Flash model and generates a rich, localized Odia response.
 * Handles inputs written in Odia script or English-transliterated Odia script.
 * 
 * @param {string} userMessage - Message submitted by user.
 * @returns {Promise<string>} - Rich step-by-step response in Odia.
 */
async function generateUniversalResponse(userMessage) {
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey || geminiApiKey === 'your_gemini_api_key_here') {
      throw new Error('Gemini API Key is not configured in your .env file.');
    }

    console.log(`[Chat Service] Analyzing input: "${userMessage}"`);

    // Build Gemini API payload with system instructions
    const payload = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: userMessage
            }
          ]
        }
      ],
      systemInstruction: {
        parts: [
          {
            text: CHAT_SYSTEM_PROMPT
          }
        ]
      },
      generationConfig: {
        temperature: 0.3, // Warm and engaging, while remaining factually disciplined
        topP: 0.95,
        maxOutputTokens: 2048
      }
    };

    const response = await axios.post(`${GEMINI_2_5_FLASH_URL}?key=${geminiApiKey}`, payload, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 8000
    });

    if (response.data && response.data.candidates && response.data.candidates.length > 0) {
      const chatResponse = response.data.candidates[0].content.parts[0].text;
      console.log(`[Chat Service] Model response successfully received.`);
      return chatResponse.trim();
    } else {
      console.warn('[Chat Service] Response missing candidates:', response.data);
      throw new Error('Failed to generate response. Invalid response structure from Gemini API.');
    }
  } catch (error) {
    const errorDetails = error.response?.data?.error?.message || error.message;
    console.error('[Chat Service] Error during content generation:', errorDetails);
    throw new Error(errorDetails);
  }
}

module.exports = {
  generateUniversalResponse
};
