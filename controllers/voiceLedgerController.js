const voiceService = require('../services/voiceService');
const ledgerParserService = require('../services/ledgerParserService');
const ledgerValidationService = require('../services/ledgerValidationService');

/**
 * Helper to dynamically generate a natural and grammatically correct Odia confirmation sentence
 * based on the structured transaction data extracted by the Ledger Parser.
 * 
 * @param {Object} data - Structured transaction JSON from Gemini.
 * @returns {string} - Conversational Odia confirmation text.
 */
function generateOdiaConfirmationText(data) {
  const { action, party, amount, item, payment_type } = data;
  
  // Format variables for Odia phrasing
  const partyName = (party && party !== 'N/A') ? party : '';
  const itemName = (item && item !== 'N/A') ? item : '';
  const amtText = (amount && amount > 0) ? `${amount} ଟଙ୍କା` : '';
  
  let text = "";

  switch (action) {
    case 'SALE':
      if (payment_type === 'CREDIT') {
        text = `${partyName ? partyName + 'ଙ୍କ ଖାତାରେ ' : ''}${amtText ? amtText + 'ର ' : ''}${itemName ? itemName + ' ବିକ୍ରି ' : 'ବିକ୍ରି '}ବାକିରେ ରେକର୍ଡ ହେଲା।`;
      } else if (payment_type === 'ONLINE') {
        text = `${partyName ? partyName + 'ଙ୍କୁ ' : ''}${amtText ? amtText + 'ର ' : ''}${itemName ? itemName + ' ବିକ୍ରି ' : 'ବିକ୍ରି '}ଅନଲାଇନ୍ ମାଧ୍ୟମରେ ସଫଳ ହେଲା।`;
      } else {
        text = `${partyName ? partyName + 'ଙ୍କୁ ' : ''}${amtText ? amtText + 'ର ' : ''}${itemName ? itemName + ' ବିକ୍ରି ' : 'ବିକ୍ରି '}ନଗଦ କରାଗଲା।`;
      }
      break;

    case 'RECEIVE_CASH':
      if (payment_type === 'ONLINE') {
        text = `${partyName ? partyName + 'ଙ୍କ ଠାରୁ ' : ''}${amtText ? amtText + ' ' : ''}ଅନଲାଇନ୍ ମାଧ୍ୟମରେ ପ୍ରାପ୍ତ ହେଲା।`;
      } else {
        text = `${partyName ? partyName + 'ଙ୍କ ଠାରୁ ' : ''}${amtText ? amtText + ' ' : ''}ନଗଦ ଗ୍ରହଣ କରାଗଲା।`;
      }
      break;

    case 'PAY_CASH':
      if (payment_type === 'ONLINE') {
        text = `${partyName ? partyName + 'ଙ୍କୁ ' : ''}${amtText ? amtText + ' ' : ''}ଅନଲାଇନ୍ ମାଧ୍ୟମରେ ପଠାଗଲା।`;
      } else {
        text = `${partyName ? partyName + 'ଙ୍କୁ ' : ''}${amtText ? amtText + ' ' : ''}ନଗଦ ପ୍ରଦାନ କରାଗଲା।`;
      }
      break;

    case 'PURCHASE':
      if (payment_type === 'CREDIT') {
        text = `${partyName ? partyName + 'ଙ୍କ ଠାରୁ ' : ''}${amtText ? amtText + 'ର ' : ''}${itemName ? itemName + ' କ୍ରୟ ' : 'କ୍ରୟ '}ବାକିରେ ରେକର୍ଡ ହେଲା।`;
      } else {
        text = `${partyName ? partyName + 'ଙ୍କ ଠାରୁ ' : ''}${amtText ? amtText + 'ର ' : ''}${itemName ? itemName + ' କ୍ରୟ ' : 'କ୍ରୟ '}ନଗଦ ସଫଳ ହେଲା।`;
      }
      break;

    case 'CREDIT_GIVEN':
      text = `${partyName ? partyName + 'ଙ୍କୁ ' : ''}${amtText ? amtText + ' ' : ''}ଧାର ବା ବାକି ରେକର୍ଡ କରାଗଲା।`;
      break;

    default:
      if (partyName && amtText) {
        text = `${partyName}ଙ୍କ ସହ ${amtText}ର କାରବାର ରେକର୍ଡ କରାଗଲା।`;
      } else if (amtText) {
        text = `${amtText}ର କାରବାର ରେକର୍ଡ କରାଗଲା।`;
      } else if (partyName) {
        text = `${partyName}ଙ୍କ କାରବାର ରେକର୍ଡ କରାଗଲା।`;
      }
      break;
  }

  return text.trim();
}


/**
 * POST /api/process-voice
 * Main pipeline orchestrator endpoint. Accepts an Odia audio file, runs transcription (STT),
 * parses intent and variables (Gemini JSON extraction), generates voice confirmation (TTS),
 * and returns the structured transaction alongside the audio url.
 */
async function processVoice(req, res) {
  console.log('--------------------------------------------------');
  console.log('[Pipeline] Incoming request to /api/process-voice');
  
  try {
    // 1. File Upload Validation
    if (!req.file) {
      console.warn('[Pipeline] Request rejected: No audio file uploaded.');
      return res.status(400).json({
        success: false,
        message: 'No audio file uploaded. Please upload a valid Odia audio recording (.mp3, .wav, or similar) under the "file" form field.'
      });
    }

    console.log(`[Pipeline] File received: ${req.file.originalname} (${req.file.mimetype}), Size: ${req.file.size} bytes`);

    // Voice mode: MODE A (od-IN, default) or MODE B (auto). Never auto-detect
    // when the user explicitly selected Odia.
    const languageMode = (req.body?.languageMode === 'auto') ? 'auto' : 'od-IN';

    // --- STEP A: Speech-to-Text (Transcribe spoken Odia audio) ---
    // STT failure is terminal: we do NOT invent a transcript and do NOT run the
    // ledger parser or chat engine on fabricated text (financial safety).
    let transcribedText;
    try {
      transcribedText = await voiceService.transcribeAudio(req.file.buffer, req.file.originalname, { languageMode });
    } catch (sttError) {
      console.error('[Pipeline] Step A (STT) failed:', sttError.errorCode || 'STT_FAILED', sttError.message);
      const isQuota = sttError.errorCode === 'PROVIDER_QUOTA';
      return res.status(200).json({
        success: false,
        error_code: sttError.errorCode || 'STT_FAILED',
        transcription: '',
        message: isQuota
          ? 'ସେବା ବର୍ତ୍ତମାନ ବ୍ୟସ୍ତ ଅଛି। ଦୟାକରି କିଛି ସମୟ ପରେ ପୁଣିଥରେ ଚେଷ୍ଟା କରନ୍ତୁ।'
          : 'ମୁଁ ଠିକ୍ ଭାବରେ ଶୁଣିପାରିଲି ନାହିଁ। ଦୟାକରି ପୁଣିଥରେ କୁହନ୍ତୁ।',
      });
    }

    // Edge case: Transcription "succeeded" but returned empty text.
    if (!transcribedText || transcribedText.trim() === '') {
      console.warn('[Pipeline] Step A returned empty transcript.');
      return res.status(200).json({
        success: false,
        error_code: 'STT_EMPTY',
        transcription: '',
        message: 'ଆପଣଙ୍କ ସ୍ୱର ସ୍ପଷ୍ଟ ଶୁଭିଲା ନାହିଁ। ଦୟାକରି ପୁଣିଥରେ ସ୍ପଷ୍ଟ ଭାବରେ କୁହନ୍ତୁ।',
      });
    }

    // --- STEP B: AI Brain & JSON Extraction (Parse Odia text via Ledger Parser) ---
    const chatService = require('../services/chatService');
    let transactionJSON = { action: 'UNKNOWN', party: 'N/A', amount: 0, item: 'N/A', payment_type: 'UNKNOWN' };
    let isLedger = false;
    let ledgerValidation = null;

    try {
      transactionJSON = await ledgerParserService.analyzeTransaction(transcribedText);
      if (transactionJSON && transactionJSON.action !== 'UNKNOWN' && (transactionJSON.amount > 0 || transactionJSON.party !== 'N/A')) {
        isLedger = true;
      }
    } catch (geminiError) {
      console.warn('[Pipeline] Ledger Parser check notice:', geminiError.message);
    }

    // --- STEP B2: LEDGER SAFETY — validate before ANY confirmation/save ---
    // We NEVER auto-save and NEVER guess missing financial values. If the
    // transaction is incomplete/ambiguous, ask the user a clarifying question.
    if (isLedger) {
      ledgerValidation = ledgerValidationService.validateTransaction(transactionJSON);

      if (!ledgerValidation.valid) {
        const clarifyText = ledgerValidation.clarification;
        let audioUrl = null;
        try { audioUrl = await voiceService.generateSpeech(clarifyText); } catch (_) {}
        return res.status(200).json({
          success: true,
          requiresClarification: true,
          isLedger: true,
          transcription: transcribedText,
          transaction: ledgerValidation.normalized,
          missing: ledgerValidation.missing,
          confirmationText: clarifyText,
          audioUrl,
          fallback_to_text: !audioUrl,
        });
      }

      // Valid but must still be CONFIRMED by the user before persistence.
      const confirmationText = generateOdiaConfirmationText(ledgerValidation.normalized);
      let audioUrl = null;
      try { audioUrl = await voiceService.generateSpeech(confirmationText); } catch (_) {}
      return res.status(200).json({
        success: true,
        requiresConfirmation: true,
        isLedger: true,
        transcription: transcribedText,
        transaction: ledgerValidation.normalized,
        confirmationText,
        audioUrl,
        fallback_to_text: !audioUrl,
      });
    }

    // --- STEP C: Conversational query / RAG scheme lookup (non-ledger) ---
    let confirmationText = '';
    let aiAnswer = '';
    {
      try {
        console.log(`[Pipeline] Processing conversational voice query: "${transcribedText}"`);
        const chatRes = await chatService.generateUniversalResponse(transcribedText);
        aiAnswer = typeof chatRes === 'string' ? chatRes : (chatRes.response || '');
        // Clean markdown for spoken confirmation
        confirmationText = aiAnswer
          .replace(/[#*_\-`]/g, '')
          .replace(/\n+/g, ' ')
          .trim();
        if (confirmationText.length > 300) {
          // Take first complete sentence for concise voice playback
          const sentences = confirmationText.split(/[।!?\.]+/).filter(Boolean);
          confirmationText = sentences.slice(0, 2).join('। ') + '।';
        }
      } catch (chatErr) {
        console.warn('[Pipeline] Chat generation notice:', chatErr.message);
        confirmationText = 'ଆପଣଙ୍କ ପ୍ରଶ୍ନ ଗ୍ରହଣ କରାଗଲା । ଦୟାକରି ଡ୍ୟାସବୋର୍ଡରେ ଉତ୍ତର ଦେଖନ୍ତୁ ।';
      }
    }

    // --- STEP D: Text-to-Speech Response (Odia audio synthesis) ---
    let audioUrl = null;
    try {
      audioUrl = await voiceService.generateSpeech(confirmationText);
    } catch (ttsError) {
      console.error('[Pipeline] Step D (TTS) Failed gracefully caught:', ttsError.message);
    }

    console.log('[Pipeline] Complete voice pipeline executed successfully!');
    console.log('--------------------------------------------------');
    
    return res.status(200).json({
      success: true,
      transcription: transcribedText,
      transaction: transactionJSON,
      confirmationText: isLedger ? confirmationText : (aiAnswer || confirmationText),
      isLedger: isLedger,
      audioUrl: audioUrl,
      fallback_to_text: !audioUrl,
      notice: !audioUrl ? 'କାରବାର ସଫଳ ହେଲା, କିନ୍ତୁ କଣ୍ଠସ୍ୱର ସଂଯୋଗ ହୋଇପାରିଲା ନାହିଁ ।' : undefined
    });

  } catch (globalError) {
    console.error('[Pipeline] Global unexpected error inside voiceLedgerController:', globalError);
    return res.status(500).json({
      success: false,
      message: 'An unexpected error occurred during voice processing.',
      details: globalError.message
    });
  }
}

/**
 * POST /api/text-to-speech
 * Independent endpoint that converts any Odia text block into premium audio.
 */
async function textToSpeech(req, res) {
  const { text } = req.body;
  console.log(`[Server TTS] Received text-to-speech request for: "${text?.substring(0, 50)}..."`);
  
  if (!text || text.trim() === '') {
    return res.status(400).json({
      success: false,
      message: 'Text cannot be empty.'
    });
  }

  try {
    const audioUrl = await voiceService.generateSpeech(text);
    return res.status(200).json({
      success: true,
      audioUrl: audioUrl
    });
  } catch (error) {
    console.error('[Server TTS] Generation error gracefully caught:', error.message, '| body:', JSON.stringify(error.response?.data || {}));
    return res.status(200).json({
      success: true,
      audioUrl: null,
      fallback_to_text: true,
      notice: 'କ୍ଷମା କରିବେ, ନେଟୱର୍କ ସମସ୍ୟା ହେତୁ ଓଡ଼ିଆ କଣ୍ଠସ୍ୱର ସଂଶ୍ଳେଷଣ ସଫଳ ହେଲାନାହିଁ । ଦୟାକରି ଟେକ୍ସଟ୍ (Text) ମାଧ୍ୟମରେ ଆଲୋଚନା ଜାରି ରଖନ୍ତୁ ।'
    });
  }
}

/**
 * POST /api/transcribe
 * Independent Speech-to-Text transcription endpoint.
 */
async function transcribeOnly(req, res) {
  console.log('[Server STT] Incoming audio file for STT transcription');
  
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'No audio file uploaded.'
    });
  }

  try {
    const transcription = await voiceService.transcribeAudio(req.file.buffer, req.file.originalname);
    if (!transcription || transcription.trim() === '') {
      return res.status(200).json({
        success: false,
        message: 'ସ୍ୱର ବୁଝାପଡ଼ିଲାନାହିଁ, ଆଉଥରେ ଚେଷ୍ଟା କରନ୍ତୁ।',
        transcription: ''
      });
    }
    return res.status(200).json({
      success: true,
      transcription: transcription
    });
  } catch (error) {
    console.error('[Server STT] Transcription error gracefully caught:', error.message);
    return res.status(200).json({
      success: false,
      transcription: '',
      fallback_to_text: true,
      message: 'ସ୍ୱର ବୁଝାପଡ଼ିଲାନାହିଁ, ଆଉଥରେ ଚେଷ୍ଟା କରନ୍ତୁ।'
    });
  }
}

module.exports = {
  processVoice,
  textToSpeech,
  transcribeOnly
};
