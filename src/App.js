import useSileroVad, {
  PIPELINE_STATES,
  LANGUAGE_OPTIONS,
  VOICE_OPTIONS,
} from './hooks/useSileroVad';
import VadStatusIndicator from './components/VadStatusIndicator';
import SilenceDurationControl from './components/SilenceDurationControl';
import MicrophoneSelector from './components/MicrophoneSelector';
import SelectControl from './components/SelectControl';
import PipelineLogger from './components/PipelineLogger';
import './App.css';

function App() {
  const {
    status,
    start,
    stop,
    ready,
    pipelineState,
    silenceDuration,
    setSilenceDuration,
    isActive,
    sourceLanguage,
    targetLanguage,
    neuralVoice,
    setSourceLanguage,
    setTargetLanguage,
    setNeuralVoice,
    logs,
    clearLogs,
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    backendUrl,
    setBackendUrl,
    showFullRequest,
    setShowFullRequest,
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
      <div className="app-content">
        <h1 className="app-title">Speech to Speech Translator App</h1>
        <div className="vad-toolbar">
          <VadStatusIndicator
            status={status}
            ready={ready}
            state={pipelineState || PIPELINE_STATES.IDLE}
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
        <MicrophoneSelector
          devices={devices}
          value={selectedDeviceId}
          onChange={setSelectedDeviceId}
          disabled={!ready}
          id="microphone-select"
        />
        <div className="backend-control-card">
          <label className="backend-control-label" htmlFor="backend-url-input">
            Backend URL:
          </label>
          <input
            id="backend-url-input"
            type="text"
            className="backend-control-input"
            value={backendUrl}
            onChange={(event) => setBackendUrl(event.target.value)}
            placeholder="https://your-backend"
          />
        </div>
        <div className="backend-debug-card">
          <label className="backend-debug-toggle" htmlFor="backend-debug-checkbox">
            <input
              id="backend-debug-checkbox"
              type="checkbox"
              checked={showFullRequest}
              onChange={(event) => setShowFullRequest(event.target.checked)}
            />
            Show Full Request
          </label>
        </div>
        </div>
        <div className="select-grid">
          <SelectControl
            label="Source Language"
            value={sourceLanguage}
            options={LANGUAGE_OPTIONS}
            onChange={setSourceLanguage}
            disabled={!ready}
            id="source-language-select"
          />
          <SelectControl
            label="Target Language"
            value={targetLanguage}
            options={LANGUAGE_OPTIONS}
            onChange={setTargetLanguage}
            disabled={!ready}
            id="target-language-select"
          />
          <SelectControl
            label="Neural Voice"
            value={neuralVoice}
            options={VOICE_OPTIONS}
            onChange={setNeuralVoice}
            disabled={!ready}
            id="neural-voice-select"
          />
        </div>
      </div>
      <PipelineLogger logs={logs} onClear={clearLogs} />
    </div>
  );
}

export default App;
