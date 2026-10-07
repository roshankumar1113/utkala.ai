# Utkal.ai

Odia assistant for chat, live voice, and a shop khata. People can ask in Odia script, English, or Odia typed in English letters. Replies are in Odia script unless English is selected in the header.

## What it does

- **Chat** — Gemini answers with local knowledge-base context when a match exists. Scheme questions without a source show a note to check the official portal.
- **Voice** — Speak in the Voice tab. Sarvam transcribes, Gemini answers, and speech plays back in short sentences. Shop entries appear as a card and are saved only after you confirm.
- **Khata** — Today’s sales, udhaar, and party balances stay in this browser (`localStorage` key `utkal_khata`).

## Setup

1. Install [Node.js](https://nodejs.org/) 18 or newer.
2. Install dependencies:

```bash
npm install
```

3. Copy `.env.example` to `.env` and fill in your own keys. If a key was ever pasted into chat or a screenshot, rotate it at the provider first. Do not commit `.env`.

```env
PORT=5000
GEMINI_API_KEY=your_gemini_api_key_here
SARVAM_API_KEY=your_sarvam_api_key_here
SARVAM_TTS_API_KEY=your_sarvam_tts_api_key_here
SARVAM_STT_API_KEY=your_sarvam_stt_api_key_here
```

`SARVAM_TTS_API_KEY` is used for speech output and `SARVAM_STT_API_KEY` for speech input. If either dedicated key is empty, that call falls back to `SARVAM_API_KEY`.

4. Start the server:

```bash
npm start
```

5. Open [http://localhost:5000](http://localhost:5000).

On startup the server prints which keys are present. It never prints the key values.

## Useful endpoints

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | Liveness check |
| POST | `/api/chat` | Full text answer |
| POST | `/api/chat/stream` | Server-sent events: `delta`, `done`, `error` |
| POST | `/api/transcribe` | Dictate into the chat box |
| POST | `/api/process-voice` | One-shot voice pipeline; ledger entries still need confirmation |
| POST | `/api/upload-pdf` | Local machine, or `x-admin-token` if `ADMIN_TOKEN` is set |
| POST | `/api/rag/train` | Same restriction as PDF upload |
| GET | `/api/odia-data` | Full dataset dump, same restriction |

Voice realtime uses Socket.IO namespace `/rt-voice`. The old `/voice-realtime.html` page redirects to `/#voice`.

PDF upload, RAG training, and the full dataset dump are refused from other computers unless the request sends header `x-admin-token` matching `ADMIN_TOKEN`.

## Tests

```bash
npm test
```

Those tests cover ledger validation, transcript checks, and provider error labels. They do not call Gemini or Sarvam.
