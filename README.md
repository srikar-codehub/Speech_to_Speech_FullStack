# Speech-to-Speech Translator Frontend

A React single-page application that captures microphone audio, detects speech activity with the Silero VAD model, and forwards each spoken segment to a configurable translation backend. When the backend returns translated speech, the UI plays the response and automatically resumes listening for the next utterance. The entire pipeline runs sequentially so every stage completes before the next begins.

## Features
- Browser-based voice activity detection using ONNX Runtime Web and the Silero model.
- Continuous listen → silence → send → playback loop with strict step-by-step execution.
- Configurable silence timeout, microphone selection, language targets, neural voice, backend URL, and request debugging.
- Structured log panel that records every pipeline stage, HTTP calls, errors, and device events.
- Automatic microphone re-enumeration and graceful fallbacks when devices change or disconnect.

## Requirements
- Node.js 18 or newer.
- Modern Chromium, Firefox, or Safari with Web Audio and WebAssembly enabled.
- Access to a translation backend that implements `POST /api/translate` and returns audio/wav data.

## Quick Start
```bash
npm install
npm start
```
Visit `http://localhost:3000`, choose your microphone if needed, verify the backend URL (defaults to `http://localhost:7071`), and click **Start**. A production bundle can be created with `npm run build`.

## Backend Integration
The frontend sends a JSON payload to `{backendUrl}/api/translate` whenever silence is detected:
```json
{
  "source_language": "English",
  "target_language": "Spanish",
  "neural_voice": "Female Voice 1",
  "audio_data": "<base64 encoded WAV>"
}
```
- Audio is captured at 16 kHz, converted to WAV, and base64 encoded before transmission.
- Requests use `Content-Type: application/json` and a 30-second timeout (AbortSignal).
- The backend must return a 200 response with `Content-Type: audio/wav` (or another audio media type). Non-audio responses are treated as errors.

On success the response is decoded into an `AudioBuffer` and played immediately. After playback completes the application restarts the microphone capture automatically.

## UI Controls
- **Status Panel** – Start/Stop button plus real-time pipeline state.
- **Silence Duration** – Adjust silent interval (0.5–5.0 s) before a segment ends.
- **Microphone Selector** – Choose among available `audioinput` devices; changing devices restarts capture.
- **Backend URL** – Endpoint root used for requests (e.g., `https://example.com`).
- **Show Full Request** – When enabled, the full base64 payload is printed to the browser console for debugging.
- **Language & Voice Selectors** – Source and target language pairing plus neural voice preference passed to the backend.

## Logging & Debugging
The lower log panel always shows the latest events in chronological order. Key entries include:
- Device discovery and device-change notifications.
- Pipeline stages (`Listening`, `Speaking`, `Silence detected`, `HTTP request`, `Playback`, etc.).
- Success and error messages for HTTP calls, decode failures, and restart events.
Use **Clear Logs** to reset the history without refreshing the page.

For full payload inspection, enable **Show Full Request** and watch the browser console (`console.log`) for the JSON blob.

## Project Structure
```
├── public/
│   ├── silero_vad.onnx           # Silero ONNX model
│   └── onnxruntime/              # WASM binaries for onnxruntime-web
├── src/
│   ├── App.js                    # Page layout and configuration controls
│   ├── App.css                   # Styling
│   ├── components/               # Presentational components (status, selectors, logger)
│   ├── hooks/useSileroVad.js     # Core hook orchestrating capture, backend calls, and playback
│   └── vad/                      # Silero VAD engine, downsampler, ring buffer utilities
└── README.md
```

## Troubleshooting
- **No microphone in dropdown** – Ensure the browser has microphone permission and refresh. Use the log panel to confirm device enumeration messages.
- **HTTP errors** – Check the log for status codes or “Network error”; verify the backend URL and that the API accepts JSON POST requests with WAV payloads.
- **Decode errors** – Confirm the backend returns `Content-Type: audio/wav` and actual audio bytes.
- **Auto-restart stops after error** – The loop halts on failure by design. Fix the issue and press **Start** again.

## License
This project is provided as-is under the MIT License. See the root repository for full terms.
