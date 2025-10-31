import { useCallback, useEffect, useRef, useState } from 'react';
import createSileroVadEngine, { ENGINE_STATES } from '../vad/SileroVadEngine';
import sendAudioToBackend from '../utils/backend';

export const PIPELINE_STATES = {
  IDLE: 'IDLE',
  LISTENING: 'LISTENING',
  RECORDING: 'RECORDING',
  SILENCE_DETECTED: 'SILENCE_DETECTED',
  SENDING_TO_BACKEND: 'SENDING_TO_BACKEND',
  PLAYING_AUDIO: 'PLAYING_AUDIO',
};

export const LANGUAGE_OPTIONS = [
  'English',
  'Spanish',
  'French',
  'German',
  'Hindi',
  'Chinese',
  'Japanese',
  'Korean',
  'Italian',
  'Portuguese',
];

export const VOICE_OPTIONS = ['Female Voice 1', 'Male Voice 1', 'Female Voice 2', 'Male Voice 2'];

const DEFAULT_SILENCE_SECONDS = 2;
const MIN_SILENCE_SECONDS = 0.5;
const MAX_SILENCE_SECONDS = 5;
const TARGET_SAMPLE_RATE = 16000;

export default function useSileroVad() {
  const engineRef = useRef(null);
  const initialSilenceRef = useRef(DEFAULT_SILENCE_SECONDS);
  const handleRecordingRef = useRef(() => {});
  const handleStateChangeRef = useRef(() => {});

  const [status, setStatus] = useState('Loading model...');
  const [ready, setReady] = useState(false);
  const [pipelineState, setPipelineState] = useState(PIPELINE_STATES.IDLE);
  const [silenceDuration, setSilenceDurationState] = useState(DEFAULT_SILENCE_SECONDS);
  const [isActive, setIsActive] = useState(false);
  const [lastRecording, setLastRecording] = useState(null);
  const [lastPayload, setLastPayload] = useState(null);
  const [sourceLanguage, setSourceLanguage] = useState(LANGUAGE_OPTIONS[0]);
  const [targetLanguage, setTargetLanguage] = useState(LANGUAGE_OPTIONS[1]);
  const [neuralVoice, setNeuralVoice] = useState(VOICE_OPTIONS[0]);

  const shouldContinueRef = useRef(false);
  const playbackRef = useRef({ context: null, source: null, resolve: null });
  const processingRef = useRef(false);

  const stopPlayback = useCallback((options = {}) => {
    const { invokeResolve = false } = options;
    const playback = playbackRef.current;
    if (!playback) {
      return;
    }
    if (playback.source) {
      playback.source.onended = null;
      try {
        playback.source.stop();
      } catch (error) {
        // Ignore stop errors
      }
      try {
        playback.source.disconnect();
      } catch (error) {
        // Ignore disconnect errors
      }
    }
    if (playback.context) {
      playback.context.close().catch(() => {});
    }
    if (invokeResolve && playback.resolve) {
      playback.resolve();
    }
    playbackRef.current = { context: null, source: null, resolve: null };
  }, []);

  const playAudioData = useCallback(
    (audioData) =>
      new Promise((resolve, reject) => {
        if (!audioData || audioData.length === 0) {
          resolve();
          return;
        }

        stopPlayback();

        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextCtor) {
          reject(new Error('Web Audio API not supported'));
          return;
        }

        try {
          const context = new AudioContextCtor();
          const buffer = context.createBuffer(1, audioData.length, TARGET_SAMPLE_RATE);
          buffer.copyToChannel
            ? buffer.copyToChannel(audioData, 0)
            : buffer.getChannelData(0).set(audioData);

          const source = context.createBufferSource();
          source.buffer = buffer;
          source.connect(context.destination);

          playbackRef.current = { context, source, resolve };

          source.onended = () => {
            stopPlayback();
            resolve();
          };

          if (context.state === 'suspended') {
            context
              .resume()
              .then(() => {
                source.start();
              })
              .catch(reject);
          } else {
            source.start();
          }
        } catch (error) {
          reject(error);
        }
      }),
    [stopPlayback]
  );

  const runPipeline = useCallback(
    async (audioData) => {
      if (processingRef.current) {
        return;
      }

      processingRef.current = true;

      try {
        setPipelineState(PIPELINE_STATES.SILENCE_DETECTED);

        if (!shouldContinueRef.current) {
          setPipelineState(PIPELINE_STATES.IDLE);
          return;
        }

        setPipelineState(PIPELINE_STATES.SENDING_TO_BACKEND);
        setStatus('Preparing payload for backend...');
        const payload = sendAudioToBackend(audioData, {
          sourceLanguage,
          targetLanguage,
          neuralVoice,
        });
        console.log('[Pipeline] Current configuration:', {
          sourceLanguage,
          targetLanguage,
          neuralVoice,
        });
        setLastPayload(payload);

        if (!shouldContinueRef.current) {
          setPipelineState(PIPELINE_STATES.IDLE);
          return;
        }

        setPipelineState(PIPELINE_STATES.PLAYING_AUDIO);
        setStatus('Playing recorded audio...');
        await playAudioData(audioData);

        if (!shouldContinueRef.current) {
          setStatus('Idle.');
          setPipelineState(PIPELINE_STATES.IDLE);
          return;
        }

        setPipelineState(PIPELINE_STATES.LISTENING);
        setStatus('Listening...');

        if (engineRef.current && ready && shouldContinueRef.current) {
          engineRef.current.start();
        }
      } catch (error) {
        console.error('[Pipeline] Error during processing', error);
        setStatus(`Pipeline error: ${error.message || String(error)}`);
        setPipelineState(PIPELINE_STATES.IDLE);
        stopPlayback({ invokeResolve: true });
        shouldContinueRef.current = false;
        setIsActive(false);
      } finally {
        processingRef.current = false;
      }
    },
    [neuralVoice, playAudioData, ready, sourceLanguage, stopPlayback, targetLanguage]
  );

  const handleRecording = useCallback(
    (audioData) => {
      setLastRecording({
        id: Date.now(),
        audioData,
      });

      if (!shouldContinueRef.current) {
        return;
      }

      if (!audioData || audioData.length === 0) {
        if (shouldContinueRef.current) {
          setPipelineState(PIPELINE_STATES.LISTENING);
          setStatus('Listening...');
        }
        if (engineRef.current && ready) {
          engineRef.current.start();
        }
        return;
      }

      runPipeline(audioData);
    },
    [ready, runPipeline]
  );

  const handleStateChange = useCallback((nextState) => {
    if (nextState === ENGINE_STATES.LISTENING && shouldContinueRef.current) {
      setPipelineState(PIPELINE_STATES.LISTENING);
    } else if (nextState === ENGINE_STATES.RECORDING) {
      setPipelineState(PIPELINE_STATES.RECORDING);
    } else if (nextState === ENGINE_STATES.SILENCE_DETECTED) {
      setPipelineState(PIPELINE_STATES.SILENCE_DETECTED);
    } else if (nextState === ENGINE_STATES.IDLE && !shouldContinueRef.current) {
      setPipelineState(PIPELINE_STATES.IDLE);
    }
  }, []);

  useEffect(() => {
    handleRecordingRef.current = handleRecording;
  }, [handleRecording]);

  useEffect(() => {
    handleStateChangeRef.current = handleStateChange;
  }, [handleStateChange]);

  useEffect(() => {
    const engine = createSileroVadEngine({
      silenceDuration: initialSilenceRef.current,
      onStatusChange: setStatus,
      onStateChange: (state) => handleStateChangeRef.current(state),
      onRecordingComplete: (audioData) => handleRecordingRef.current(audioData),
    });
    engineRef.current = engine;

    let cancelled = false;

    engine
      .init()
      .then(() => {
        if (!cancelled) {
          setReady(true);
          setStatus('Ready. Press Start to begin.');
          setPipelineState(PIPELINE_STATES.IDLE);
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
      stopPlayback({ invokeResolve: true });
      shouldContinueRef.current = false;
      processingRef.current = false;
      if (engineRef.current) {
        engineRef.current.dispose();
        engineRef.current = null;
      }
    };
  }, [stopPlayback]);

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
    if (!engineRef.current || !ready) {
      return;
    }
    shouldContinueRef.current = true;
    setIsActive(true);
    setPipelineState(PIPELINE_STATES.LISTENING);
    setStatus('Preparing microphone...');
    engineRef.current.start();
  }, [ready]);

  const stop = useCallback(() => {
    shouldContinueRef.current = false;
    stopPlayback({ invokeResolve: true });
    if (engineRef.current) {
      engineRef.current.stop();
    }
    processingRef.current = false;
    setIsActive(false);
    setPipelineState(PIPELINE_STATES.IDLE);
    setStatus('Idle.');
  }, [stopPlayback]);

  return {
    status,
    start,
    stop,
    ready,
    pipelineState,
    silenceDuration,
    setSilenceDuration: updateSilenceDuration,
    isActive,
    lastRecording,
    lastPayload,
    sourceLanguage,
    targetLanguage,
    neuralVoice,
    setSourceLanguage,
    setTargetLanguage,
    setNeuralVoice,
  };
}
