const voiceService = require('../services/voiceService');
const ledgerParserService = require('../services/ledgerParserService');

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
  
  // Default fallback transaction confirmation in Odia ("Transaction recorded successfully.")
  let text = "ବ୍ୟବସାୟିକ କାରବାର ସଫଳତାର ସହ ଲିପିବଦ୍ଧ ହେଲା।";

  switch (action) {
    case 'SALE':
      if (payment_type === 'CREDIT') {
        text = `${partyName ? partyName + 'ଙ୍କ ଖାତାରେ ' : ''}${amtText ? amtText + 'ର ' : ''}${itemName ? itemName + ' ବିକ୍ରି ' : '비크리 '}ବାକିରେ ଲିପିବଦ୍ଧ କରାଗଲା।`;
      } else if (payment_type === 'ONLINE') {
        text = `${partyName ? partyName + 'ଙ୍କୁ ' : ''}${amtText ? amtText + 'ର ' : ''}${itemName ? itemName + ' ବିକ୍ରି ' : '비크리 '}ଅନଲାଇନ୍ ମାଧ୍ୟମରେ ସଫଳ ହେଲା।`;
      } else {
        text = `${partyName ? partyName + 'ଙ୍କୁ ' : ''}${amtText ? amtText + 'ର ' : ''}${itemName ? itemName + ' ବିକ୍ରି ' : '비크리 '}ନଗଦ କରାଗଲା।`;
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
        text = `${partyName ? partyName + 'ଙ୍କ ଠାରୁ ' : ''}${amtText ? amtText + 'ର ' : ''}${itemName ? itemName + ' କ୍ରୟ ' : 'କ୍ରୟ '}ବାକିରେ ଲିପିବଦ୍ଧ ହେଲା।`;
      } else {
        text = `${partyName ? partyName + 'ଙ୍କ ଠାରୁ ' : ''}${amtText ? amtText + 'ର ' : ''}${itemName ? itemName + ' କ୍ରୟ ' : 'କ୍ରୟ '}ନଗଦ ସଫଳ ହେଲା।`;
      }
      break;

    case 'CREDIT_GIVEN':
      text = `${partyName ? partyName + 'ଙ୍କୁ ' : ''}${amtText ? amtText + ' ' : ''}ଧାର ବା ବାକି ରେକର୍ଡ କରାଗଲା।`;
      break;

    default:
      // Generic fallback combining recognized details
      if (partyName && amtText) {
        text = `${partyName}ଙ୍କ ସହ ${amtText}ର କାରବାର ରେକର୍ଡ କରାଗଲା।`;
      }
      break;
  }

  return text;
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

    // --- STEP A: Speech-to-Text (Transcribe spoken Odia audio) ---
    let transcribedText;
    try {
      transcribedText = await voiceService.transcribeAudio(req.file.buffer, req.file.originalname);
    } catch (sttError) {
      console.error('[Pipeline] Step A (STT) Failed gracefully caught:', sttError.message);
      return res.status(200).json({
        success: true,
        fallback_to_text: true,
        transcription: 'କଣ୍ଠସ୍ୱର ଚିହ୍ନଟ ହୋଇପାରିଲା ନାହିଁ।',
        transaction: {
          action: 'UNKNOWN',
          party: 'N/A',
          amount: 0,
          item: 'N/A',
          payment_type: 'UNKNOWN'
        },
        confirmationText: 'କ୍ଷମା କରିବେ, ନେଟୱର୍କ ସମସ୍ୟା ହେତୁ କଣ୍ଠସ୍ୱର ଚିହ୍ନଟ ହୋଇପାରିଲା ନାହିଁ । ଦୟାକରି ଟେକ୍ସଟ୍ (Text) ମାଧ୍ୟମରେ ଲେଖନ୍ତୁ ।',
        audioUrl: null,
        notice: 'କ୍ଷମା କରିବେ, ନେଟୱର୍କ ବିଳମ୍ବ ହେତୁ ଆପଣଙ୍କ କଣ୍ଠସ୍ୱର ସଂଯୋଗ ହୋଇପାରିଲା ନାହିଁ । ଦୟାକରି ଟେକ୍ସଟ୍ (Text) ମାଧ୍ୟମରେ ଲେଖନ୍ତୁ ଏବଂ ପୁଣିଥରେ ଚେଷ୍ଟା କରନ୍ତୁ ।'
      });
    }

    // Edge case: Transcription succeeded but returned empty text
    if (!transcribedText || transcribedText.trim() === '') {
      console.warn('[Pipeline] Step A succeeded but transcription text is empty.');
      return res.status(200).json({
        success: true,
        fallback_to_text: true,
        transcription: 'ଖାଲି ସ୍ୱର।',
        transaction: {
          action: 'UNKNOWN',
          party: 'N/A',
          amount: 0,
          item: 'N/A',
          payment_type: 'UNKNOWN'
        },
        confirmationText: 'ଆପଣଙ୍କ ସ୍ୱର ସ୍ପଷ୍ଟ ଶୁଭିଲା ନାହିଁ। ଦୟାକରି ପୁଣିଥରେ ସ୍ପଷ୍ଟ ଭାବରେ କୁହନ୍ତୁ କିମ୍ବା ଟେକ୍ସଟ୍ ମାଧ୍ୟମରେ ଲେଖନ୍ତୁ ।',
        audioUrl: null,
        notice: 'ଆପଣଙ୍କ ସ୍ୱର ସ୍ପଷ୍ଟ ଶୁଭିଲା ନାହିଁ । ଦୟାକରି ଟେକ୍ସଟ୍ (Text) ମାଧ୍ୟମରେ ଲେଖନ୍ତୁ କିମ୍ବା ପୁଣିଥରେ ଚେଷ୍ଟା କରନ୍ତୁ ।'
      });
    }

    // --- STEP B: AI Brain & JSON Extraction (Parse Odia text via Ledger Parser) ---
    let transactionJSON;
    try {
      transactionJSON = await ledgerParserService.analyzeTransaction(transcribedText);
    } catch (geminiError) {
      console.error('[Pipeline] Step B (Ledger Parser) Failed gracefully caught:', geminiError.message);
      return res.status(200).json({
        success: true,
        fallback_to_text: true,
        transcription: transcribedText,
        transaction: {
          action: 'UNKNOWN',
          party: 'N/A',
          amount: 0,
          item: 'N/A',
          payment_type: 'UNKNOWN'
        },
        confirmationText: 'କ୍ଷମା କରିବେ, ନେଟୱର୍କ ସମସ୍ୟା ହେତୁ ଆପଣଙ୍କ ବ୍ୟବସାୟିକ କାରବାର ବିଶ୍ଳେଷଣ ହୋଇପାରିଲା ନାହିଁ । ଦୟାକରି ଟେକ୍ସଟ୍ ମାଧ୍ୟମରେ ଚେଷ୍ଟା କରନ୍ତୁ ।',
        audioUrl: null,
        notice: 'କ୍ଷମା କରିବେ, ନେଟୱର୍କ ସମସ୍ୟା ଯୋଗୁଁ କାରବାର ବିଶ୍ଳେଷଣ ବିଫଳ ହେଲା । ଦୟାକରି ଟେକ୍ସଟ୍ (Text) ମାଧ୍ୟମରେ ଲେଖି ଚେଷ୍ଟା କରନ୍ତୁ ।'
      });
    }

    // --- STEP C: Text-to-Speech Response (Odia audio confirmation) ---
    // Generate natural Odia confirmation statement
    const confirmationText = generateOdiaConfirmationText(transactionJSON);
    console.log(`[Pipeline] Formulated confirmation text: "${confirmationText}"`);

    let audioUrl;
    try {
      audioUrl = await voiceService.generateSpeech(confirmationText);
    } catch (ttsError) {
      console.error('[Pipeline] Step C (TTS) Failed gracefully caught:', ttsError.message);
      // Notice: If TTS fails, we return the parsed transaction successfully, but with fallback_to_text enabled and a friendly voice notice
      return res.status(200).json({
        success: true,
        transcription: transcribedText,
        transaction: transactionJSON,
        confirmationText: confirmationText,
        audioUrl: null,
        fallback_to_text: true,
        notice: 'ବ୍ୟବସାୟିକ କାରବାର ସଫଳତାର ସହ ଲିପିବଦ୍ଧ ହେଲା, କିନ୍ତୁ ନେଟୱର୍କ ସମସ୍ୟା ଯୋଗୁଁ ସ୍ୱର ସଂଯୋଗ ହୋଇପାରିଲା ନାହିଁ । ଦୟାକରି ଟେକ୍ସଟ୍ (Text) ମାଧ୍ୟମରେ ଯାଞ୍ଚ କରନ୍ତୁ ।'
      });
    }

    // Full Pipeline Success
    console.log('[Pipeline] Complete 3-step pipeline executed successfully!');
    console.log('--------------------------------------------------');
    
    return res.status(200).json({
      success: true,
      transcription: transcribedText,
      transaction: transactionJSON,
      confirmationText: confirmationText,
      audioUrl: audioUrl
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
    console.error('[Server TTS] Generation error gracefully caught:', error.message);
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
    return res.status(200).json({
      success: true,
      transcription: transcription
    });
  } catch (error) {
    console.error('[Server STT] Transcription error gracefully caught:', error.message);
    return res.status(200).json({
      success: true,
      transcription: 'କଣ୍ଠସ୍ୱର ଚିହ୍ନଟ ବିଫଳ।',
      fallback_to_text: true,
      notice: 'କ୍ଷମା କରିବେ, ନେଟୱର୍କ ବିଳମ୍ବ ଯୋଗୁଁ କଣ୍ଠସ୍ୱର ଅନୁବାଦ ହୋଇପାରିଲା ନାହିଁ । ଦୟାକରି ଟେକ୍ସଟ୍ (Text) ମାଧ୍ୟମରେ ଚେଷ୍ଟା କରନ୍ତୁ ।'
    });
  }
}

module.exports = {
  processVoice,
  textToSpeech,
  transcribeOnly
};
