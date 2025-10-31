import { ENGINE_STATES } from '../hooks/useSileroVad';

const STATUS_VARIANTS = {
  [ENGINE_STATES.IDLE]: {
    label: 'Idle',
    appearance: 'idle',
  },
  [ENGINE_STATES.LISTENING]: {
    label: 'Listening',
    appearance: 'listening',
  },
  [ENGINE_STATES.RECORDING]: {
    label: 'Recording',
    appearance: 'recording',
  },
  [ENGINE_STATES.SILENCE_DETECTED]: {
    label: 'Silence detected',
    appearance: 'silence',
  },
  [ENGINE_STATES.PLAYING_BACK]: {
    label: 'Playing back',
    appearance: 'playback',
  },
};

function resolveStatusVariant(state, ready, isActive) {
  if (!ready) {
    return STATUS_VARIANTS[ENGINE_STATES.IDLE];
  }

  if (!isActive && state === ENGINE_STATES.IDLE) {
    return STATUS_VARIANTS[ENGINE_STATES.IDLE];
  }

  return STATUS_VARIANTS[state] || STATUS_VARIANTS[ENGINE_STATES.LISTENING];
}

export default function VadStatusIndicator({
  status,
  ready,
  state,
  isActive,
  onStart,
  onStop,
}) {
  const variant = resolveStatusVariant(state, ready, isActive);
  const isRunning = ready && isActive;
  const buttonLabel = isRunning ? 'Stop' : ready ? 'Start' : 'Loading...';
  const buttonDisabled = !ready && !isRunning;
  const indicatorClass = `vad-status-dot vad-status-dot--${variant.appearance}`;
  const buttonClassName = isRunning
    ? 'vad-status-button vad-status-button--stop'
    : 'vad-status-button';

  const handleClick = () => {
    if (isRunning) {
      onStop();
    } else if (ready) {
      onStart();
    }
  };

  return (
    <div className="vad-status-card">
      <div className="vad-status-heading">
        <span className={indicatorClass} />
        <span className="vad-status-label">{variant.label}</span>
      </div>
      <p className="vad-status-detail">{status}</p>
      <button
        type="button"
        className={buttonClassName}
        onClick={handleClick}
        disabled={buttonDisabled}
      >
        {buttonLabel}
      </button>
    </div>
  );
}
