# Silero Voice Activity Detection (Browser)

This React application demonstrates fully in-browser voice activity detection powered by the Silero ONNX model and ONNX Runtime Web. Audio is captured from the user's microphone, downsampled to 16 kHz, and analysed in near-real-time. The UI reports whether the system is currently `Listening...`, has detected active `Speaking...`, or has observed two seconds of continuous silence (`Silence detected.`). After silence the capture stops and restarts automatically.

## Requirements

- Node.js 18+
- Modern Chromium-based browser (required for SharedArrayBuffer-less audio processing and WebAssembly SIMD support)
- Microphone permissions granted in the browser

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the development server:
   ```bash
   npm start
   ```
   Open `http://localhost:3000` and click **Start Listening**. Approve microphone access when prompted.
3. Build for production:
   ```bash
   npm run build
   ```

## Implementation Notes

- The Silero VAD model (`public/silero_vad.onnx`) and the required ONNX Runtime WASM binaries (`public/onnxruntime/*`) are bundled with the app so that inference never leaves the browser.
- Audio capture uses the Web Audio API with a `ScriptProcessorNode`, resampling each chunk to 16 kHz before inference.
- The ONNX Runtime Web session runs on the WASM backend. Each chunk updates an internal state tensor and feeds a ring buffer that tracks 2 seconds of silence before resetting capture.
- UI and engine logic are separated: React components consume the `useSileroVad` hook, while the engine under `src/vad/` manages audio, preprocessing, inference, and silence detection.

## Project Structure

```
src/
├─ App.js                 # UI wiring for status updates and controls
├─ hooks/useSileroVad.js  # Hook exposing engine status, start, and stop
└─ vad/                   # Engine implementation
   ├─ Downsampler.js
   ├─ RingBuffer.js
   └─ SileroVadEngine.js
public/
├─ silero_vad.onnx        # Silero model (copied from silero-realtime-vad package)
└─ onnxruntime/           # WASM binaries required by onnxruntime-web
```

## Limitations

- Browser security requires an explicit user interaction before microphone capture can begin.
- The pipeline avoids async/await in the application code where possible; however, ONNX Runtime Web and getUserMedia rely on underlying asynchronous primitives imposed by browser APIs.
