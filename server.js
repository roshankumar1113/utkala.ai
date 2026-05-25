require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const voiceLedgerRoutes = require('./routes/voiceLedgerRoutes');
const chatService = require('./services/chatService');

const app = express();
const PORT = process.env.PORT || 5000;

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

// API Routes
app.use('/api', voiceLedgerRoutes); // Mount /api/process-voice voice ledger routing endpoint

// Single Unified Text Chat POST Endpoint
async function handleChat(req, res) {
  const userMessage = req.body.message;
  console.log(`[Server] Received message input for /api/chat: "${userMessage}"`);

  if (!userMessage || userMessage.trim() === '') {
    return res.status(400).json({
      success: false,
      message: 'Message cannot be empty.'
    });
  }

  try {
    const aiResponse = await chatService.generateUniversalResponse(userMessage);
    
    return res.status(200).json({
      success: true,
      response: aiResponse
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

// Start Chat Server
app.listen(PORT, () => {
  console.log('==================================================');
  console.log(`🚀 Utkal.ai Chat & Voice Server running on Port ${PORT}`);
  console.log(`👉 Chat Interface: http://localhost:${PORT}`);
  console.log(`👉 Voice API: http://localhost:${PORT}/api/process-voice`);
  console.log('==================================================');
});
