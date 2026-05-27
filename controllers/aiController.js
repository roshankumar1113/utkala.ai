const { GoogleGenAI } = require("@google/genai");
const { retrieveContext } = require("../services/ragService");

// Initialize the Google Gen AI SDK
let ai;
try {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    console.warn('[AI Controller] Warning: GEMINI_API_KEY is not configured in your .env file.');
  }
  ai = new GoogleGenAI({ apiKey: apiKey });
} catch (err) {
  console.error('[AI Controller] Gen AI SDK initialization error:', err.message);
}

/**
 * Endpoint handler for POST /api/query-rag
 * Retrieves context from the local Knowledge Base and runs Gemini with strict instructions.
 */
const handleUtkalQuery = async (req, res) => {
  try {
    const { query } = req.body; // Expecting user text or Sarvam transcription text
    
    if (!query || query.trim() === '') {
      return res.status(400).json({ error: "Query is required to execute the operational lookup pipeline." });
    }

    console.log(`[AI Controller RAG] Processing query: "${query}"`);

    // 1. EXECUTE THE SEARCH LOOP: Extract verified background data matching the query
    const verifiedContext = retrieveContext(query);
    console.log(`[AI Controller RAG] Context search complete. Found match: ${verifiedContext !== "No explicit matching local state schema documents found in the primary vector cluster repository."}`);

    // 2. CONTEXTUAL PROMPTING: Inject data straight into system instructions
    const systemInstruction = `
      You are Utkal.ai, a premium, empathetic widescreen AI companion designed to bridge the digital divide for native Odia speakers on both mobile and laptop interfaces.
      Your primary operational mandate is to answer the user's question using ONLY the verified context blocks provided below.
      
      STRICT CONSTRAINTS:
      1. Provide a comprehensive, step-by-step answer entirely in beautifully structured native Odia script.
      2. Completely eliminate English text leakage or transliterated Roman alphabets.
      3. For any sensitive documentation fields (such as government numbers or placeholders), write standard descriptive labels in Odia like '[ଆଧାର କାର୍ଡ ନମ୍ବର]'. Never output or invent individual numerical ID numbers.
      4. If the provided context does not contain the answer to the user's question, reply gracefully in Odia script stating that you currently do not hold that verified update in your local knowledge base.

      [VERIFIED KNOWLEDGE CONTEXT]:
      ${verifiedContext}
    `;

    if (!ai) {
      throw new Error('Google Gen AI SDK is not initialized. Please check your GEMINI_API_KEY configuration.');
    }

    // 3. EXECUTE COGNITIVE BRAIN INFERENCE WITH TIMEOUT SAFEGUARDS
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('RAG Query timed out due to network latency.')), 8000)
    );

    const apiCallPromise = ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: query,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.2, // Kept low to ensure strict factual compliance and zero hallucination
      }
    });

    const response = await Promise.race([apiCallPromise, timeoutPromise]);

    // 4. RETURN PAYLOAD FOR GRAPHICAL DASHBOARD DISPLAY
    return res.status(200).json({
      success: true,
      odiaScriptResponse: response.text,
      contextInjected: verifiedContext !== "No explicit matching local state schema documents found in the primary vector cluster repository."
    });

  } catch (error) {
    console.error("Critical Failure in Utkal AI RAG Controller Pipeline gracefully caught:", error);
    
    // Graceful fallback response payload delivered completely in native script
    return res.status(200).json({
      success: false,
      odiaScriptResponse: "କ୍ଷମା କରିବେ, ବର୍ତ୍ତମାନ ନେଟୱର୍କ କିମ୍ବା ବୈଷୟିକ ସମସ୍ୟା ଦେଖାଦେଇଛି। ଦୟାକରି ଟେକ୍ସଟ୍ (Text) ମାଧ୍ୟମରେ ପୁଣିଥରେ ଚେଷ୍ଟା କରନ୍ତୁ।",
      error: error.message,
      fallback_to_text: true
    });
  }
};

module.exports = {
  handleUtkalQuery
};
