import React, { useState, useRef, useEffect } from 'react';
import { io } from 'socket.io-client';

const VoiceChatEnhanced = () => {
  const [socket, setSocket] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState('Connecting...');
  const [userId] = useState(`user-${Date.now()}`);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioElementRef = useRef(new Audio());

  // Connect to Socket.io
  useEffect(() => {
    const serverUrl = process.env.REACT_APP_SERVER_URL || 'http://localhost:5000';
    const newSocket = io(serverUrl, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    });

    newSocket.on('connect', () => {
      console.log('✅ Connected to Odia Voice server');
      setStatus('Ready');
      newSocket.emit('join-voice-chat', { userId });
    });

    newSocket.on('user-transcript', (data) => {
      console.log('📝 User said:', data.text);
      setMessages((prev) => [...prev, { type: 'user', text: data.text }]);
      setStatus('Thinking & Synthesizing...');
    });

    newSocket.on('assistant-text', (data) => {
      console.log('🤖 Response:', data.text);
      setMessages((prev) => [...prev, { type: 'assistant', text: data.text, sources: data.sources }]);
    });

    newSocket.on('assistant-audio', (data) => {
      console.log('🔊 Playing audio response...');
      playAudio(data.audio, data.contentType || 'audio/wav');
    });

    newSocket.on('error', (error) => {
      console.error('❌ Error:', error.message);
      setStatus(`Notice: ${error.message}`);
    });

    setSocket(newSocket);

    return () => newSocket.disconnect();
  }, [userId]);

  // Start recording with optimized 16kHz mono audio constraints
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000, // Exact 16kHz required for Odia STT
          channelCount: 1, // Mono only
          echoCancellation: true, // Echo cancellation
          noiseSuppression: true, // Background noise suppression
          autoGainControl: true, // Hardware auto-gain
          latency: 0.01,
          audioMirroring: false,
        },
      });

      let mimeType = 'audio/webm';
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/wav')) {
        mimeType = 'audio/wav';
      }

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 256000,
      });

      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        console.log(`🎤 Recorded audio size: ${audioBlob.size} bytes`);
        sendAudioToServer(audioBlob);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start(250); // Slice every 250ms
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      setStatus('🎤 Recording... Speak CLEARLY in Odia!');

      // Auto-stop after 30 seconds
      setTimeout(() => {
        if (mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
          setIsRecording(false);
        }
      }, 30000);
    } catch (error) {
      console.error('Microphone error:', error);
      if (error.name === 'NotAllowedError') {
        setStatus('❌ Microphone permission denied');
      } else {
        setStatus(`❌ Microphone error: ${error.message}`);
      }
    }
  };

  // Stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setStatus('Processing speech...');
    }
  };

  // Send audio to server
  const sendAudioToServer = (audioBlob) => {
    if (!socket) return;

    const reader = new FileReader();
    reader.onload = () => {
      const arrayBuffer = reader.result;
      const uint8Array = new Uint8Array(arrayBuffer);
      socket.emit('send-audio', {
        audioBlob: uint8Array,
        userId,
      });
    };
    reader.readAsArrayBuffer(audioBlob);
  };

  // Play audio response
  const playAudio = (audioBase64, contentType) => {
    try {
      const binaryString = atob(audioBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const audioBlob = new Blob([bytes], { type: contentType || 'audio/wav' });
      const audioUrl = URL.createObjectURL(audioBlob);

      audioElementRef.current.src = audioUrl;
      audioElementRef.current.onplay = () => setIsPlaying(true);
      audioElementRef.current.onended = () => {
        setIsPlaying(false);
        setStatus('Ready');
      };
      audioElementRef.current.play();
      
      setStatus('🔊 Playing response...');
    } catch (error) {
      console.error('Audio playback error:', error);
      setStatus('Audio playback ready');
    }
  };

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-white">
      {/* Header */}
      <div className="bg-black/40 backdrop-blur border-b border-slate-800 p-4">
        <h1 className="text-xl font-bold text-amber-400">🎤 Utkal.ai Voice Live (Enhanced STT)</h1>
        <p className="text-xs text-slate-400">16kHz High-Fidelity Audio Preprocessing & Multi-Engine Odia STT</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-4xl mb-3">🎙️</p>
              <p className="text-base text-slate-300 font-medium">ମାଇକ୍ରୋଫୋନ୍ ବଟନ୍ ଦବାଇ ସ୍ପଷ୍ଟ ଭାବରେ କୁହନ୍ତୁ</p>
              <p className="text-xs text-slate-500 mt-1">Press the microphone button below to start</p>
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-md px-4 py-2.5 rounded-2xl ${
                  msg.type === 'user'
                    ? 'bg-amber-600/90 text-white rounded-br-none'
                    : 'bg-slate-800/90 text-slate-100 border border-slate-700/60 rounded-bl-none'
                }`}
              >
                <div className="text-xs text-slate-300 mb-1 font-semibold">
                  {msg.type === 'user' ? '👤 You / ଆପଣ' : '🤖 Utkal AI'}
                </div>
                <div className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</div>
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-2 text-xs text-amber-300/80 border-t border-slate-700 pt-1">
                    📚 Sources: {msg.sources.join(', ')}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Status */}
      <div className="text-center p-2 text-sm text-amber-400/90 font-medium">{status}</div>

      {/* Controls */}
      <div className="bg-black/40 backdrop-blur border-t border-slate-800 p-6 flex justify-center">
        <button
          onClick={isRecording ? stopRecording : startRecording}
          disabled={isPlaying}
          className={`w-20 h-20 rounded-full flex items-center justify-center text-3xl shadow-lg transition-all ${
            isRecording
              ? 'bg-red-600 hover:bg-red-700 scale-110 animate-pulse ring-4 ring-red-400/50'
              : 'bg-amber-500 hover:bg-amber-600 text-slate-950'
          } ${isPlaying ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {isRecording ? '⏹️' : '🎤'}
        </button>
      </div>

      <audio ref={audioElementRef} />
    </div>
  );
};

export default VoiceChatEnhanced;
