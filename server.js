require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const voiceLedgerRoutes = require('./routes/voiceLedgerRoutes');
const voiceChatSocket = require('./routes/voiceChatSocket');
const realtimeVoiceSocket = require('./routes/realtimeVoiceSocket');
const chatService = require('./services/chatService');
const aiController = require('./controllers/aiController');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

// Initialize Socket.io Voice Chat
const io = voiceChatSocket(server);
app.set('io', io);

// Initialize Utkal.ai Voice 2.0 realtime namespace (/rt-voice) alongside legacy handlers
realtimeVoiceSocket(io);


// Ensure public output directory exists for serving generated audio files
const publicOutputsDir = path.join(__dirname, 'public', 'outputs');
if (!fs.existsSync(publicOutputsDir)) {
  fs.mkdirSync(publicOutputsDir, { recursive: true });
  console.log(`[Init] Created static output directory at: ${publicOutputsDir}`);
} else {
  console.log(`[Init] Static output directory verified: ${publicOutputsDir}`);
}

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve Static Frontend Dashboard Files
app.use(express.static(path.join(__dirname, 'public')));

// Root Endpoint Health Check
app.get('/', (req, res) => {
  res.status(200).json({
    name: 'Utkal.ai Modular Chat & Voice Server',
    status: 'Active',
    version: '3.0.0',
    description: 'Empowering local shopkeepers and citizens through AI-powered Odia text & voice conversations.'
  });
});

// Dedicated Health Check Endpoint for Docker & Monitoring
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// ============================================
// GITHUB WEBHOOK ENDPOINT
// ============================================

// Handle GitHub webhook
app.post('/github', async (req, res) => {
  try {
    console.log('🪝 GitHub webhook received!');
    console.log('Event type:', req.headers['x-github-event']);
    console.log('Action:', req.body.action || 'N/A');
    
    res.status(200).json({ 
      status: 'ok',
      message: 'Webhook received and processed',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).json({ 
      status: 'error',
      message: error.message 
    });
  }
});

// Health check for webhook endpoint
app.get('/github', (req, res) => {
  res.status(200).json({ 
    status: 'ok',
    message: 'Webhook endpoint ready',
    endpoint: '/github'
  });
});



// API Routes
app.use('/api', voiceLedgerRoutes); // Mount /api/process-voice voice ledger routing endpoint
app.post('/api/query-rag', aiController.handleUtkalQuery); // Mount local RAG query semantic endpoint

// Scraped Odia Dataset Stats Endpoint
app.get('/api/odia-data/stats', async (req, res) => {
  try {
    const dataFilePath = path.join(__dirname, 'data', 'scraped_odia_data.json');
    if (fs.existsSync(dataFilePath)) {
      const dataset = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));
      const categories = [...new Set(dataset.map(item => item.category))];
      return res.status(200).json({
        status: 'ok',
        totalRecords: dataset.length,
        categories: categories,
        datasetPath: 'data/scraped_odia_data.json',
        timestamp: new Date().toISOString()
      });
    }
    return res.status(200).json({
      status: 'ok',
      totalRecords: 0,
      categories: [],
      message: 'No scraped dataset found yet.'
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// GET Scraped Odia Data
app.get('/api/odia-data', (req, res) => {
  try {
    const dataFilePath = path.join(__dirname, 'data', 'scraped_odia_data.json');
    if (fs.existsSync(dataFilePath)) {
      const dataset = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));
      return res.status(200).json({ status: 'ok', count: dataset.length, data: dataset });
    }
    return res.status(404).json({ status: 'error', message: 'Dataset not found' });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// Configure Multer for PDF uploads to ./pdfs
const multer = require('multer');
const PDFExtractor = require('./services/pdfExtractorService');
const pdfsUploadDir = path.join(__dirname, 'pdfs');
if (!fs.existsSync(pdfsUploadDir)) {
  fs.mkdirSync(pdfsUploadDir, { recursive: true });
}
const pdfStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, pdfsUploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const uploadPdf = multer({
  storage: pdfStorage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are supported!'), false);
    }
  }
});

// PDF Upload & Automatic RAG Knowledge Ingestion Endpoint
app.post('/api/upload-pdf', uploadPdf.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No PDF file uploaded.' });
    }

    const extractor = new PDFExtractor();
    const result = await extractor.extractFromPDF(req.file.path);

    if (!result.success) {
      return res.status(500).json({ success: false, message: result.error });
    }

    // Append extracted PDF text to local dataset (scraped_odia_data.json)
    const dataFilePath = path.join(__dirname, 'data', 'scraped_odia_data.json');
    let dataset = [];
    if (fs.existsSync(dataFilePath)) {
      dataset = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));
    }

    const newRecord = {
      title: result.metadata.title || result.filename,
      category: 'Uploaded PDF Document',
      content: result.text,
      source_url: `file://pdfs/${result.filename}`,
      language: result.metadata.language || 'odia',
      pages: result.pages
    };

    dataset.push(newRecord);
    fs.mkdirSync(path.dirname(dataFilePath), { recursive: true });
    fs.writeFileSync(dataFilePath, JSON.stringify(dataset, null, 2), 'utf8');

    return res.status(200).json({
      success: true,
      message: `PDF "${result.filename}" uploaded and processed into RAG Knowledge Base!`,
      data: {
        filename: result.filename,
        pages: result.pages,
        characterCount: result.text.length,
        metadata: result.metadata,
        totalDatasetRecords: dataset.length
      }
    });

  } catch (error) {
    console.error('[PDF Upload Error]:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// ENDPOINTS: STEP 7 RAG PIPELINE INTEGRATION
// ============================================

const RAGPipeline = require('./services/ragPipelineService');
const VectorStore = require('./services/vectorStoreService');

// 1. POST /api/rag/train - Run full RAG pipeline training
app.post('/api/rag/train', async (req, res) => {
  try {
    const pipeline = new RAGPipeline();
    const config = req.body || {};
    const result = await pipeline.run(config);

    return res.status(200).json({
      status: 'success',
      message: 'RAG Pipeline training and vector store indexing completed successfully.',
      statistics: result.stats,
      chunksProcessed: result.chunksProcessed
    });
  } catch (error) {
    console.error('[RAG Train Error]:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// 2. POST /api/rag/search - Perform Cosine Vector Similarity Search
app.post('/api/rag/search', async (req, res) => {
  try {
    const { query, topK } = req.body;
    if (!query || query.trim() === '') {
      return res.status(400).json({ status: 'error', message: 'Query string is required.' });
    }

    const pipeline = new RAGPipeline();
    const result = await pipeline.query(query, topK || 5);

    return res.status(200).json({
      status: 'success',
      query: result.query,
      resultsCount: result.resultsCount,
      results: result.results
    });
  } catch (error) {
    console.error('[RAG Search Error]:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// 3. GET /api/rag/stats - Retrieve Vector DB Statistics
app.get('/api/rag/stats', async (req, res) => {
  try {
    const vectorStore = new VectorStore();
    await vectorStore.connect();
    const stats = await vectorStore.getStats();

    return res.status(200).json({
      status: 'success',
      statistics: stats
    });
  } catch (error) {
    console.error('[RAG Stats Error]:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

// Single Unified Text & Multimodal Chat POST Endpoint
async function handleChat(req, res) {
  const userMessage = req.body.message || req.body.query || '';
  const history = req.body.history || req.body.conversation_history || req.body.messages || [];
  const sessionId = req.body.sessionId || req.body.session_id;
  const sessionData = req.body.session || req.body.userContext || {};
  const image = req.body.image || null; // { mimeType, base64 }
  const useRag = req.body.useRag !== false;

  if (sessionId) sessionData.sessionId = sessionId;

  console.log(`[Server] Received message input for /api/chat: "${userMessage?.substring(0, 60)}" (Session: ${sessionId || 'new'}, Image: ${Boolean(image)})`);

  if ((!userMessage || userMessage.trim() === '') && !image) {
    return res.status(400).json({
      success: false,
      message: 'Message or image attachment cannot be empty.'
    });
  }

  try {
    const result = await chatService.generateUniversalResponse(
      userMessage || 'Analyze this image and explain in Odia.',
      history.length > 0 ? history : sessionId,
      sessionData,
      { image, useRag }
    );
    
    // Support both string and object responses
    const responseText = typeof result === 'string' ? result : result.response;
    const resultSessionId = result.sessionId || sessionId;

    return res.status(200).json({
      success: true,
      response: responseText,
      message: responseText,
      sessionId: resultSessionId,
      transliteration: result.transliteration || null,
      ragSources: result.ragSources || [],
      ragContextUsed: result.ragContextUsed || false,
      session: result.session || null
    });
  } catch (error) {
    console.error('[Server] Chat generation error:', error.message);
    
    return res.status(502).json({
      success: false,
      message: 'Failed to generate AI response. Please try again.',
      details: error.message
    });
  }
}

// Bind both endpoints to handleChat to maintain compatibility with client variations
app.post('/api/chat', handleChat);
app.post('/api/chat-multimodal', handleChat);

// Transliteration Check Endpoint
app.post('/api/chat/check-transliteration', async (req, res) => {
  try {
    const message = req.body.message || '';
    const result = await chatService.transliterationService.detectAndClarifyTransliteration(message);
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Session Info Endpoint
app.get('/api/chat/session/:sessionId', (req, res) => {
  try {
    const session = chatService.sessionMemoryService.getOrCreateSession(req.params.sessionId);
    return res.status(200).json({ success: true, session });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// 404 Route Fallback
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: 'Route not found. Supported endpoints include POST /api/chat and POST /api/process-voice'
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Server Error Middleware] Unhandled Error:', err);
  res.status(500).json({
    success: false,
    message: 'An unexpected server error occurred.',
    details: err.message
  });
});

// Start Chat & Voice Server
server.listen(PORT, '0.0.0.0', () => {
  console.log('==================================================');
  console.log(`🚀 Utkal.ai Chat & Voice Server running on Port ${PORT}`);
  console.log(`👉 Chat Interface: http://localhost:${PORT}`);
  console.log(`👉 Voice API: http://localhost:${PORT}/api/process-voice`);
  console.log(`👉 Voice Socket.io: Active on ws://localhost:${PORT}`);
  console.log('==================================================');
});


// Resilient error handling for server port binding
server.on('error', (error) => {
  if (error.syscall !== 'listen') {
    throw error;
  }
  switch (error.code) {
    case 'EADDRINUSE':
      console.error(`[Server Launch Error] Port ${PORT} is already in use by another local process.`);
      process.exit(1);
      break;
    default:
      console.error(`[Server Launch Error] System error during initialization:`, error);
      throw error;
  }
});
