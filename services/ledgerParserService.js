const axios = require('axios');

// Endpoint for Gemini 2.5 Flash Lite Content Generation API
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent';

/**
 * System instruction defining the role, extraction variables, and few-shot examples
 * to train Gemini to act as a highly localized Odia financial ledger processor.
 */
const SYSTEM_INSTRUCTION = `You are "Odia.ai Financial Brain", a highly precise, localized financial transaction parser designed for local shopkeepers, small businesses, and MSMEs in Odisha, India.
Your task is to analyze spoken Odia text related to financial transactions (such as sales, purchases, credits, payments received, or inventory changes) and parse it into a clean, structured JSON format.

You must extract the following properties:
1. action: The type of transaction. Allowed values:
   - "SALE": Selling an item or service.
   - "RECEIVE_CASH": Receiving cash payment from a customer/party.
   - "PAY_CASH": Paying cash/money to a supplier or party.
   - "PURCHASE": Buying inventory, goods, or items for the business.
   - "CREDIT_GIVEN": Recording a credit ledger entry where a party owes money.
   - "UNKNOWN": If transaction intent cannot be understood.
2. party: The name of the person or entity involved. Transliterate this name into standard English script (Latin alphabet) with the first letter capitalized (e.g. ରମେଶ -> "Ramesh", ହରି -> "Hari", ଶ୍ୟାମ -> "Shyam"). If no party is specified, return "N/A".
3. amount: The transaction amount in Indian Rupees (INR) as a numeric value. Extract and convert any Odia numerals (୧, ୨, ୩, ୪, ୫, ୬, ୭, ୮, ୯, ୦) or spelled-out currency text (e.g., "pancha sanda" -> 500, "das hazar" -> 10000) into actual JavaScript numbers. If no amount is specified, return 0.
4. item: The item or service sold or purchased. Translate this to English if possible, or transliterate if specific (e.g., "Sambalpuri Saree", "Grocery Items", "Cement", "Rice", "Oil"). If no item is specified, return "N/A".
5. payment_type: The payment terms or method. Allowed values:
   - "CASH": If the text explicitly mentions "nagada" (cash), "cash", "hand-to-hand", or implies direct cash payment.
   - "CREDIT": If the text implies a credit entry (e.g., "khata", "baki", "dhar", "debara achhi", "dhare deli") or is a sale on credit.
   - "ONLINE": If online payment terms like "UPI", "PhonePe", "Paytm", "GPay", "online transfer" are mentioned.
   - "UNKNOWN": If not specified.

Guidelines:
- You must output ONLY a valid JSON object. Do not include markdown wraps (like \`\`\`json ... \`\`\`), preambles, or explanations.
- Transliterate names accurately from Odia to English. E.g., ରମେଶ -> Ramesh, ହରି -> Hari.
- Parse Odia numerals accurately.

Training / Few-Shot Examples:
Example 1:
- Input: "ରମେଶଙ୍କୁ ୧୨,୦୦୦ ଟଙ୍କାର ସମ୍ବଲପୁରୀ ଶାଢ଼ୀ ବିକ୍ରି କଲି।"
- Output JSON: { "action": "SALE", "party": "Ramesh", "amount": 12000, "item": "Sambalpuri Saree", "payment_type": "CREDIT" }

Example 2:
- Input: "ହରି ମୋତେ ନଗଦ ୫୦୦ ଟଙ୍କା ଦେଲା।"
- Output JSON: { "action": "RECEIVE_CASH", "party": "Hari", "amount": 500, "item": "N/A", "payment_type": "CASH" }

Example 3:
- Input: "ଶ୍ୟାମ ଭାଇଙ୍କ ଠାରୁ ୨୦୦୦ ଟଙ୍କାର ରାସନ ସାମଗ୍ରୀ ବାକିରେ ଆଣିଲି।"
- Output JSON: { "action": "PURCHASE", "party": "Shyam Bhai", "amount": 2000, "item": "Grocery Items", "payment_type": "CREDIT" }

Example 4:
- Input: "ରଞ୍ଜନ କୁ ୩୦୦ ଟଙ୍କା ଫୋନପେ ରେ ପଠେଇଲି।"
- Output JSON: { "action": "PAY_CASH", "party": "Ranjan", "amount": 300, "item": "N/A", "payment_type": "ONLINE" }`;

/**
 * Sends transcribed Odia text to Gemini to parse and extract financial variables.
 * 
 * @param {string} odiaText - Raw transcribed Odia script.
 * @returns {Promise<Object>} - Extracted transaction details in JSON.
 */
async function analyzeTransaction(odiaText) {
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey || geminiApiKey === 'your_gemini_api_key_here') {
      throw new Error('Gemini API Key is not configured in .env');
    }

    console.log(`[Ledger Parser] Analyzing text: "${odiaText}"`);

    // Prepare API call payload
    const payload = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Please parse this Odia financial transaction: "${odiaText}"`
            }
          ]
        }
      ],
      systemInstruction: {
        parts: [
          {
            text: SYSTEM_INSTRUCTION
          }
        ]
      },
      generationConfig: {
        responseMimeType: 'application/json', // Force response to be strict JSON
        temperature: 0.1 // Low temperature for high precision and factual extraction
      }
    };

    let response;
    let retries = 3;
    let delay = 1500;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        response = await axios.post(`${GEMINI_API_URL}?key=${geminiApiKey}`, payload, {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 8000
        });
        break; // Success! Break out of the retry loop.
      } catch (error) {
        const errMessage = error.response?.data?.error?.message || error.message;
        const isRateLimit = error.response?.status === 429 || errMessage.includes('429') || errMessage.includes('RESOURCE_EXHAUSTED') || errMessage.includes('quota');
        if (isRateLimit && attempt < retries) {
          console.warn(`[Ledger Parser] Quota hit (429). Retrying attempt ${attempt}/${retries} in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2; // Double the backoff delay
        } else {
          throw error; // Rethrow other errors or final attempt failure
        }
      }
    }

    if (response && response.data && response.data.candidates && response.data.candidates.length > 0) {
      const parsedText = response.data.candidates[0].content.parts[0].text;
      console.log(`[Ledger Parser] Received raw model output: ${parsedText.trim()}`);
      
      // Parse the JSON string
      const transactionData = JSON.parse(parsedText.trim());
      console.log('[Ledger Parser] Successfully parsed JSON output:', transactionData);
      return transactionData;
    } else {
      console.warn('[Ledger Parser] Response did not contain candidates:', response ? response.data : 'No response');
      throw new Error('Gemini Analysis failed. Invalid response structure from Gemini API.');
    }
  } catch (error) {
    console.error('[Ledger Parser] Error occurred during transaction analysis:', error.response?.data || error.message);
    throw new Error(`Ledger Parser Error: ${error.response?.data?.error?.message || error.message}`);
  }
}

module.exports = {
  analyzeTransaction
};
