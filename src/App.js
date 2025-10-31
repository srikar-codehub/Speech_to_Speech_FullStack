import useSileroVad from './hooks/useSileroVad';
import VadStatusIndicator from './components/VadStatusIndicator';
import SilenceDurationControl from './components/SilenceDurationControl';
import './App.css';

function App() {
  const {
    status,
    start,
    stop,
    ready,
    engineState,
    silenceDuration,
    setSilenceDuration,
    isActive,
  } = useSileroVad();

  const handleStart = () => {
    if (!ready) {
      return;
    }
    start();
  };

  const handleStop = () => {
    stop();
  };

  return (
    <div className="app-shell">
      <h1 className="app-title">Speech to Speech Translator App</h1>
      <div className="vad-toolbar">
        <VadStatusIndicator
          status={status}
          ready={ready}
          state={engineState}
          isActive={isActive}
          onStart={handleStart}
          onStop={handleStop}
        />
        <SilenceDurationControl
          value={silenceDuration}
          min={0.5}
          max={5}
          step={0.5}
          onChange={setSilenceDuration}
          disabled={!ready}
        />
      </div>
    </div>
  );
}

export default App;
