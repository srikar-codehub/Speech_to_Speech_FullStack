import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
const DEFAULT_DEVICE_ID = 'default';

export const LOG_TYPES = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
};

export default function useSileroVad() {
  const engineRef = useRef(null);
  const initialSilenceRef = useRef(DEFAULT_SILENCE_SECONDS);
  const handleRecordingRef = useRef(() => {});
  const handleStateChangeRef = useRef(() => {});
  const silenceDurationRef = useRef(DEFAULT_SILENCE_SECONDS);
  const enumeratedAfterPermissionRef = useRef(false);

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
  const [logs, setLogs] = useState([]);
  const [devices, setDevices] = useState([{ deviceId: DEFAULT_DEVICE_ID, label: 'System Default' }]);
  const [selectedDeviceId, setSelectedDeviceId] = useState(DEFAULT_DEVICE_ID);

  const shouldContinueRef = useRef(false);
  const playbackRef = useRef({ context: null, source: null, resolve: null });
  const processingRef = useRef(false);

  const addLog = useCallback((message, type = LOG_TYPES.INFO) => {
    setLogs((prev) => {
      const now = new Date();
      const entry = {
        id: `${now.getTime()}-${Math.random().toString(16).slice(2, 8)}`,
        time: now.toLocaleTimeString([], { hour12: false }),
        message,
        type,
      };
      return [...prev, entry];
    });
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

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
          const targetChannel = buffer.getChannelData(0);
          targetChannel.set(audioData);

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

  const enumerateAudioDevices = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      addLog('[DEVICE] Media device enumeration is not supported in this browser.', LOG_TYPES.WARNING);
      return;
    }
    try {
      const deviceList = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = deviceList.filter((device) => device.kind === 'audioinput');

      let unnamedIndex = 1;
      let defaultLabel = 'System Default';
      const concreteDevices = [];

      audioInputs.forEach((device, index) => {
        const deviceId = device.deviceId || `device-${index}`;
        const label = device.label && device.label.trim().length > 0
          ? device.label
          : `Microphone ${unnamedIndex++}`;

        if (deviceId === 'default') {
          defaultLabel = label;
        } else {
          concreteDevices.push({ deviceId, label });
        }
      });

      concreteDevices.sort((a, b) => a.label.localeCompare(b.label));

      const nextDevices = [
        { deviceId: DEFAULT_DEVICE_ID, label: defaultLabel || 'System Default' },
        ...concreteDevices,
      ];

      setDevices(nextDevices);
      addLog(
        `[DEVICE] Found ${audioInputs.length} audio input device(s).`,
        LOG_TYPES.INFO
      );

      const stillValid = nextDevices.some((device) => device.deviceId === selectedDeviceId);
      if (!stillValid) {
        if (selectedDeviceId !== DEFAULT_DEVICE_ID) {
          addLog(
            '[DEVICE] Previous microphone is no longer available. Reverting to default microphone.',
            LOG_TYPES.WARNING
          );
        }
        setSelectedDeviceId(DEFAULT_DEVICE_ID);
      }
    } catch (error) {
      addLog(
        `[DEVICE] Unable to enumerate audio devices: ${error.message || error}`,
        LOG_TYPES.WARNING
      );
    }
  }, [addLog, selectedDeviceId]);

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
        addLog('[PIPELINE] Preparing backend payload.', LOG_TYPES.INFO);
        const payload = sendAudioToBackend(audioData, {
          sourceLanguage,
          targetLanguage,
          neuralVoice,
        });
        setLastPayload(payload);

        const audioString = payload && typeof payload.audio_data === 'string' ? payload.audio_data : '';
        const maxPreviewLength = 50;
        let truncated = '';
        let byteEstimate = 0;
        if (audioString) {
          truncated =
            audioString.length > maxPreviewLength
              ? `${audioString.slice(0, maxPreviewLength)}...`
              : audioString;
          byteEstimate = Math.round((audioString.length * 3) / 4);
        }

        const payloadForLog = {
          ...payload,
          audio_data: audioString ? `${truncated} (${byteEstimate} bytes)` : '(no audio data)',
        };
        addLog(
          `[PIPELINE] JSON payload generated:\n${JSON.stringify(payloadForLog, null, 2)}`,
          LOG_TYPES.INFO
        );

        if (!shouldContinueRef.current) {
          setPipelineState(PIPELINE_STATES.IDLE);
          return;
        }

        setPipelineState(PIPELINE_STATES.PLAYING_AUDIO);
        setStatus('Playing recorded audio...');
        addLog('[PIPELINE] Playback starting.', LOG_TYPES.INFO);
        await playAudioData(audioData);
        addLog('[PIPELINE] Playback complete.', LOG_TYPES.SUCCESS);

        if (!shouldContinueRef.current) {
          setStatus('Idle.');
          setPipelineState(PIPELINE_STATES.IDLE);
          return;
        }

        addLog('[PIPELINE] Auto-restart: listening again.', LOG_TYPES.INFO);
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
        addLog(`[ERROR] Pipeline error: ${error.message || String(error)}`, LOG_TYPES.WARNING);
      } finally {
        processingRef.current = false;
      }
    },
    [
      addLog,
      neuralVoice,
      playAudioData,
      ready,
      sourceLanguage,
      stopPlayback,
      targetLanguage,
    ]
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

      if (!enumeratedAfterPermissionRef.current) {
        enumerateAudioDevices();
        enumeratedAfterPermissionRef.current = true;
      }

      runPipeline(audioData);
    },
    [enumerateAudioDevices, ready, runPipeline]
  );

  const handleStateChange = useCallback(
    (nextState) => {
      if (nextState === ENGINE_STATES.LISTENING && shouldContinueRef.current) {
        setPipelineState(PIPELINE_STATES.LISTENING);
        addLog('[STATE] Listening for speech.', LOG_TYPES.INFO);
      } else if (nextState === ENGINE_STATES.RECORDING) {
        setPipelineState(PIPELINE_STATES.RECORDING);
        addLog('[STATE] Speech detected.', LOG_TYPES.INFO);
      } else if (nextState === ENGINE_STATES.SILENCE_DETECTED) {
        setPipelineState(PIPELINE_STATES.SILENCE_DETECTED);
      } else if (nextState === ENGINE_STATES.IDLE && !shouldContinueRef.current) {
        setPipelineState(PIPELINE_STATES.IDLE);
      }
    },
    [addLog]
  );

  const handleSilenceDetected = useCallback(
    (detectedDuration) => {
      const duration =
        typeof detectedDuration === 'number' ? detectedDuration : silenceDurationRef.current;
      silenceDurationRef.current = duration;
      addLog(
        `[STATE] Silence detected after ${duration.toFixed(1)} second(s).`,
        LOG_TYPES.WARNING
      );
    },
    [addLog]
  );

  const handleDeviceError = useCallback(
    (info) => {
      const attemptedId = info && info.deviceId ? info.deviceId : 'requested device';
      addLog(
        `[DEVICE] Requested microphone (${attemptedId}) is unavailable. Falling back to default microphone.`,
        LOG_TYPES.WARNING
      );
    },
    [addLog]
  );

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
      onSilenceDetected: handleSilenceDetected,
      onDeviceError: handleDeviceError,
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
          addLog('[INIT] Model ready. Awaiting start.', LOG_TYPES.SUCCESS);
        }
      })
      .catch((error) => {
        console.error('Unable to initialize Silero VAD', error);
        if (!cancelled) {
          const reason = error && error.message ? error.message : String(error);
          setStatus(`Initialization failed: ${reason}`);
          addLog(`[ERROR] Initialization failed: ${reason}`, LOG_TYPES.WARNING);
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
  }, [addLog, handleDeviceError, handleSilenceDetected, stopPlayback]);

  useEffect(() => {
    if (!navigator.mediaDevices) {
      return undefined;
    }

    enumerateAudioDevices();

    if (!navigator.mediaDevices.addEventListener) {
      return undefined;
    }

    const handleChange = () => {
      enumerateAudioDevices();
    };
    navigator.mediaDevices.addEventListener('devicechange', handleChange);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleChange);
    };
  }, [enumerateAudioDevices]);

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
    addLog('[CONTROL] Start button clicked.', LOG_TYPES.INFO);
    engineRef.current.setDevice(
      selectedDeviceId === DEFAULT_DEVICE_ID ? null : selectedDeviceId
    );
    engineRef.current.start();
    setTimeout(() => {
      enumerateAudioDevices();
    }, 500);
  }, [addLog, enumerateAudioDevices, ready, selectedDeviceId]);

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
    addLog('[CONTROL] Stop button clicked.', LOG_TYPES.WARNING);
  }, [addLog, stopPlayback]);

  useEffect(() => {
    silenceDurationRef.current = silenceDuration;
  }, [silenceDuration]);

  const handleDeviceSelection = useCallback(
    (deviceId) => {
      const normalizedId = deviceId || DEFAULT_DEVICE_ID;
      setSelectedDeviceId(normalizedId);

      const deviceLabel =
        devices.find((device) => device.deviceId === normalizedId)?.label || 'System Default';

      addLog(`[DEVICE] Device changed: now using ${deviceLabel}.`, LOG_TYPES.INFO);

      if (engineRef.current) {
        engineRef.current.setDevice(normalizedId === DEFAULT_DEVICE_ID ? null : normalizedId);
        if (shouldContinueRef.current) {
          addLog('[DEVICE] Restarting capture with the selected microphone.', LOG_TYPES.INFO);
        }
      }
    },
    [addLog, devices]
  );

  const selectedDeviceLabel = useMemo(() => {
    return devices.find((device) => device.deviceId === selectedDeviceId)?.label || 'System Default';
  }, [devices, selectedDeviceId]);

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
    logs,
    clearLogs,
    devices,
    selectedDeviceId,
    setSelectedDeviceId: handleDeviceSelection,
    selectedDeviceLabel,
  };
}
