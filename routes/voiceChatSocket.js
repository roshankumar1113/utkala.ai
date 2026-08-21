const socketIo = require('socket.io');
const voiceChatService = require('../services/voiceChatService');
const chatService = require('../services/chatService');
const sessionMemoryService = require('../services/sessionMemoryService');

module.exports = (server) => {
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5000',
    'http://127.0.0.1:5000',
    'http://127.0.0.1:3000',
    process.env.FRONTEND_URL,
  ].filter(Boolean);

  const io = socketIo(server, {
    cors: {
      origin: allowedOrigins.length > 0 ? allowedOrigins : '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    maxHttpBufferSize: 100 * 1024 * 1024, // 100MB for large audio streams
  });

  // Track active sessions
  const activeSessions = new Map();

  io.on('connection', (socket) => {
    const sessionId = `session-${socket.id}-${Date.now()}`;
    console.log(`✅ [Voice Chat] User connected: ${socket.id}`);

    // Initialize session
    activeSessions.set(socket.id, {
      sessionId,
      userId: null,
      createdAt: new Date(),
      messageCount: 0,
      totalAudioDuration: 0,
    });

    socket.on('join-voice-chat', (data = {}) => {
      const userId = data.userId || `user-${socket.id}`;
      const session = activeSessions.get(socket.id);
      if (session) {
        session.userId = userId;
      }
      console.log(`👤 [Voice Chat] User identified: ${userId} for session: ${sessionId}`);
      socket.emit('voice-chat-ready', { sessionId, status: 'ready' });
    });

    /**
     * MAIN FLOW: User sends audio
     */
    socket.on('send-audio', async (data = {}) => {
      const session = activeSessions.get(socket.id);
      if (!session) {
        socket.emit('error', { message: 'Session not found' });
        return;
      }

      const { audioBlob, userId } = data;
      if (!audioBlob) {
        socket.emit('error', { message: 'No audio data received' });
        return;
      }

      try {
        console.log(`🎤 [STT] Processing audio for socket ${socket.id}...`);

        // Step 1: Convert incoming data to Buffer
        let audioBuffer;
        if (Buffer.isBuffer(audioBlob)) {
          audioBuffer = audioBlob;
        } else if (audioBlob instanceof Uint8Array || audioBlob instanceof ArrayBuffer) {
          audioBuffer = Buffer.from(audioBlob);
        } else {
          audioBuffer = Buffer.from(audioBlob, 'binary');
        }

        // Step 2: Speech-to-Text
        const sttResult = await voiceChatService.transcribeOdiaAudio(audioBuffer);

        if (!sttResult.success) {
          console.error('❌ STT failed:', sttResult.error);
          socket.emit('error', {
            message: 'Could not understand Odia speech',
            error: sttResult.error,
          });
          return;
        }

        const userQuestion = sttResult.transcript;
        console.log(`✅ [STT] Recognized: "${userQuestion}"`);

        // Emit user transcript back to UI
        socket.emit('user-transcript', {
          text: userQuestion,
          confidence: sttResult.confidence,
          timestamp: new Date(),
        });

        // Step 3: Get RAG / Gemini answer
        console.log(`🔍 [RAG] Generating response for: "${userQuestion}"...`);
        let answerText = '';
        let sources = [];

        if (typeof chatService.answerQuestion === 'function') {
          const ragResponse = await chatService.answerQuestion(userQuestion, userId || session.userId || session.sessionId);
          answerText = ragResponse.answer || ragResponse.response || '';
          sources = ragResponse.sources || ragResponse.ragSources || [];
        } else {
          const result = await chatService.generateUniversalResponse(userQuestion, session.sessionId);
          answerText = typeof result === 'string' ? result : (result.response || result.message || '');
          sources = result.ragSources || [];
        }

        if (!answerText) {
          throw new Error('Empty response from AI engine');
        }

        console.log(`✅ [RAG] Response generated: "${answerText.substring(0, 60)}..."`);

        // Emit text response to UI immediately
        socket.emit('assistant-text', {
          text: answerText,
          sources: sources,
          timestamp: new Date(),
        });

        // Step 4: Text-to-Speech
        console.log(`🔊 [TTS] Converting response to Odia speech...`);
        const ttsResult = await voiceChatService.synthesizeOdiaSpeech(answerText, {
          speaker: 'meera',
          pace: 1.0,
          pitch: 1.0,
        });

        if (!ttsResult.success) {
          console.error('❌ TTS failed:', ttsResult.error);
          socket.emit('error', { message: 'Could not generate speech audio' });
          return;
        }

        console.log(`✅ [TTS] Audio synthesized successfully`);

        // Step 5: Send audio to browser for playback
        socket.emit('assistant-audio', {
          audio: ttsResult.audio, // Base64-encoded WAV
          contentType: ttsResult.contentType,
          duration: ttsResult.duration,
          timestamp: new Date(),
        });

        // Update session stats
        session.messageCount += 1;
        session.totalAudioDuration += ttsResult.duration || 0;

        console.log(`✅ [Voice Chat] Cycle complete! (Session: ${session.sessionId})`);
      } catch (error) {
        console.error('❌ [Voice Chat Error]:', error.message);
        socket.emit('error', {
          message: 'Voice chat processing failed',
          error: error.message,
        });
      }
    });

    /**
     * User can interrupt and stop audio
     */
    socket.on('interrupt-audio', () => {
      console.log(`🛑 [Voice Chat] User interrupted audio playback`);
      socket.emit('audio-stopped', { status: 'interrupted' });
    });

    /**
     * End session gracefully
     */
    socket.on('end-voice-session', () => {
      const session = activeSessions.get(socket.id);
      if (session) {
        console.log(`📊 [Voice Chat] Session ended`);
        console.log(`   - Messages: ${session.messageCount}`);
        console.log(`   - Total audio duration: ${session.totalAudioDuration}s`);
        console.log(`   - Duration: ${Math.round((Date.now() - session.createdAt.getTime()) / 1000)}s`);
      }
      socket.emit('session-ended', { status: 'success' });
      activeSessions.delete(socket.id);
    });

    socket.on('disconnect', () => {
      const session = activeSessions.get(socket.id);
      if (session) {
        console.log(`👋 [Voice Chat] User disconnected: ${socket.id}`);
        activeSessions.delete(socket.id);
      }
    });

    socket.on('error', (error) => {
      console.error('🔴 Socket error:', error);
    });
  });

  return io;
};
