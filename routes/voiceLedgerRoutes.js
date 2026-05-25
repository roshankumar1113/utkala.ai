const express = require('express');
const multer = require('multer');
const voiceLedgerController = require('../controllers/voiceLedgerController');

const router = express.Router();

// Configure Multer to store uploaded audio files in memory as Buffers.
// This prevents disk bloat, speeds up pipeline execution, and is ideal for serverless or container deployment.
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // Limit audio uploads to 10MB maximum
  },
  fileFilter: (req, file, cb) => {
    // Basic validation to check for audio types
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(null, true); // Keep it lenient for varying client encodings, but log a warning in controller
    }
  }
});

/**
 * Route: POST /api/process-voice
 * Middleware: Multer parses multipart/form-data for the 'file' field.
 * Controller: Triggers the 3-step STT -> Gemini -> TTS pipeline.
 */
router.post('/process-voice', upload.single('file'), voiceLedgerController.processVoice);

module.exports = router;
