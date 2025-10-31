import { useCallback, useEffect, useRef, useState } from 'react';
import createSileroVadEngine from '../vad/SileroVadEngine';

export const ENGINE_STATES = {
  IDLE: 'IDLE',
  LISTENING: 'LISTENING',
  RECORDING: 'RECORDING',
  SILENCE_DETECTED: 'SILENCE_DETECTED',
  PLAYING_BACK: 'PLAYING_BACK',
};

const DEFAULT_SILENCE_SECONDS = 2;
const MIN_SILENCE_SECONDS = 0.5;
const MAX_SILENCE_SECONDS = 5;

export default function useSileroVad() {
  const engineRef = useRef(null);
  const initialSilenceRef = useRef(DEFAULT_SILENCE_SECONDS);
  const [status, setStatus] = useState('Loading model...');
  const [ready, setReady] = useState(false);
  const [engineState, setEngineState] = useState(ENGINE_STATES.IDLE);
  const [silenceDuration, setSilenceDurationState] = useState(DEFAULT_SILENCE_SECONDS);
  const [isActive, setIsActive] = useState(false);
  const [isPlayingBack, setIsPlayingBack] = useState(false);
  const [lastRecording, setLastRecording] = useState(null);
  const [cycleCount, setCycleCount] = useState(0);

  useEffect(() => {
    const engine = createSileroVadEngine({
      silenceDuration: initialSilenceRef.current,
      onStatusChange: setStatus,
      onStateChange: setEngineState,
      onRecordingComplete: (audioData) => {
        setLastRecording({
          id: Date.now(),
          audioData,
        });
      },
      onPlaybackStart: () => setIsPlayingBack(true),
      onPlaybackEnd: () => {
        setIsPlayingBack(false);
        setCycleCount((value) => value + 1);
      },
    });
    engineRef.current = engine;

    let cancelled = false;

    engine
      .init()
      .then(() => {
        if (!cancelled) {
          setReady(true);
          setStatus('Listening...');
        }
      })
      .catch((error) => {
        console.error('Unable to initialize Silero VAD', error);
        if (!cancelled) {
          const reason = error && error.message ? error.message : String(error);
          setStatus(`Initialization failed: ${reason}`);
        }
      });

    return () => {
      cancelled = true;
      setIsActive(false);
      setIsPlayingBack(false);
      if (engineRef.current) {
        engineRef.current.dispose();
        engineRef.current = null;
      }
    };
  }, []);

  const updateSilenceDuration = useCallback((value) => {
    const numericValue = Number(value);
    if (Number.isNaN(numericValue)) {
      return;
    }
    const clamped = Math.min(Math.max(numericValue, MIN_SILENCE_SECONDS), MAX_SILENCE_SECONDS);
    setSilenceDurationState(clamped);
    if (engineRef.current) {
      engineRef.current.setSilenceDuration(clamped);
    }
  }, []);

  const start = useCallback(() => {
    if (engineRef.current && ready) {
      engineRef.current.start();
      setIsActive(true);
    }
  }, [ready]);

  const stop = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.stop();
    }
    setIsActive(false);
    setIsPlayingBack(false);
    setEngineState(ENGINE_STATES.IDLE);
  }, []);

  return {
    status,
    start,
    stop,
    ready,
    engineState,
    silenceDuration,
    setSilenceDuration: updateSilenceDuration,
    isActive,
    isPlayingBack,
    lastRecording,
    cycleCount,
  };
}
