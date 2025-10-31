import { useState } from 'react';
import useSileroVad from './hooks/useSileroVad';
import './App.css';

function App() {
  const { status, start, stop, ready } = useSileroVad();
  const [capturing, setCapturing] = useState(false);

  const handleStart = () => {
    if (!ready) {
      return;
    }
    start();
    setCapturing(true);
  };

  const handleStop = () => {
    stop();
    setCapturing(false);
  };

  return (
    <div className="app-shell">
      <h1>Silero VAD (ONNX Runtime Web)</h1>
      <p className="status-label">{status}</p>
      <div className="actions">
        <button
          type="button"
          onClick={handleStart}
          disabled={!ready || capturing}
        >
          {ready ? 'Start Listening' : 'Loading Model...'}
        </button>
        <button
          type="button"
          onClick={handleStop}
          disabled={!capturing}
        >
          Stop
        </button>
      </div>
      <p className="note">
        Allow microphone access when prompted. The detector restarts automatically after silence.
      </p>
    </div>
  );
}

export default App;
