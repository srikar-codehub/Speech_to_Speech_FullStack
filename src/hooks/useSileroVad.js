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
  const [backendUrl, setBackendUrl] = useState('http://localhost:7071');
  const [showFullRequest, setShowFullRequest] = useState(false);

  const shouldContinueRef = useRef(false);
  const playbackRef = useRef({ context: null, source: null, resolve: null });
  const processingRef = useRef(false);

  const addLog = useCallback((message, type = LOG_TYPES.INFO) => {
    setLogs((previous) => {
      const now = new Date();
      return [
        ...previous,
        {
          id: `${now.getTime()}-${Math.random().toString(16).slice(2, 8)}`,
          time: now.toLocaleTimeString([], { hour12: false }),
          message,
          type,
        },
      ];
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
        // ignore
      }
      try {
        playback.source.disconnect();
      } catch (error) {
        // ignore
      }
    }
    if (playback.context) {
      playback.context.close().catch(() => {});
    }
    if (invokeResolve && playback.resolve) {
      try {
        playback.resolve();
      } catch (resolveError) {
        console.warn('Playback resolve failed', resolveError);
      }
    }
    playbackRef.current = { context: null, source: null, resolve: null };
  }, []);

  const playAudioBuffer = useCallback((audioContext, audioBuffer) => {
    return new Promise((resolve, reject) => {
      try {
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);

        playbackRef.current = { context: audioContext, source, resolve };

        source.onended = () => {
          if (playbackRef.current.source === source) {
            playbackRef.current = { context: null, source: null, resolve: null };
          }
          audioContext.close().catch(() => {});
          resolve();
        };

        const startPlayback = () => {
          try {
            source.start();
          } catch (startError) {
            source.disconnect();
            audioContext.close().catch(() => {});
            playbackRef.current = { context: null, source: null, resolve: null };
            reject(startError);
          }
        };

        if (audioContext.state === 'suspended') {
          audioContext
            .resume()
            .then(startPlayback)
            .catch((resumeError) => {
              source.disconnect();
              audioContext.close().catch(() => {});
              playbackRef.current = { context: null, source: null, resolve: null };
              reject(resumeError);
            });
        } else {
          startPlayback();
        }
      } catch (error) {
        if (audioContext) {
          audioContext.close().catch(() => {});
        }
        playbackRef.current = { context: null, source: null, resolve: null };
        reject(error);
      }
    });
  }, []);

  const decodeAudioBuffer = useCallback((audioContext, arrayBuffer) => {
    const copy = arrayBuffer.slice(0);
    const maybePromise = audioContext.decodeAudioData(copy);
    if (maybePromise && typeof maybePromise.then === 'function') {
      return maybePromise;
    }
    return new Promise((resolve, reject) => {
      audioContext.decodeAudioData(copy, resolve, reject);
    });
  }, []);

  const enumerateAudioDevices = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      addLog('\u{1F399}\uFE0F DEVICE WARNING: Media device enumeration is not supported in this browser.', LOG_TYPES.WARNING);
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
        const label =
          device.label && device.label.trim().length > 0 ? device.label : `Microphone ${unnamedIndex++}`;

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
      addLog(`\u{1F399}\uFE0F DEVICE: Found ${audioInputs.length} audio input device(s).`, LOG_TYPES.INFO);

      const stillValid = nextDevices.some((device) => device.deviceId === selectedDeviceId);
      if (!stillValid) {
        if (selectedDeviceId !== DEFAULT_DEVICE_ID) {
          addLog('\u{1F399}\uFE0F DEVICE WARNING: Previous microphone is unavailable. Reverting to default.', LOG_TYPES.WARNING);
        }
        setSelectedDeviceId(DEFAULT_DEVICE_ID);
      }
    } catch (error) {
      addLog(`\u{1F399}\uFE0F DEVICE WARNING: Unable to enumerate microphones (${error.message || error}).`, LOG_TYPES.WARNING);
    }
  }, [addLog, selectedDeviceId]);

  const runPipeline = useCallback(
    async (audioData) => {
      if (processingRef.current) {
        return;
      }

      processingRef.current = true;

      let audioContext = null;
      let requestPayloadSnapshot = null;

      try {
        setPipelineState(PIPELINE_STATES.SILENCE_DETECTED);

        if (!shouldContinueRef.current) {
          setPipelineState(PIPELINE_STATES.IDLE);
          return;
        }

        setPipelineState(PIPELINE_STATES.SENDING_TO_BACKEND);
        setStatus('Preparing payload for backend...');

        const sendResult = await sendAudioToBackend(audioData, {
          sourceLanguage,
          targetLanguage,
          neuralVoice,
          backendUrl,
          showFullRequest,
          onBeforeSend: ({ payload, endpoint, requestBytes }) => {
            requestPayloadSnapshot = payload;
            setLastPayload(payload);

            const audioString = typeof payload.audio_data === 'string' ? payload.audio_data : '';
            const preview = audioString ? audioString.slice(0, 50) : '';
            const ellipsis = audioString && audioString.length > 50 ? '...' : '';
            const payloadPreview = {
              ...payload,
              audio_data: audioString
                ? `${preview}${ellipsis} (${requestBytes} bytes)`
                : '(no audio data)',
            };

            addLog(`\u{1F4E4} HTTP REQUEST: Sending to ${endpoint}`, LOG_TYPES.INFO);
            addLog(`\u{1F4CB} REQUEST PAYLOAD:\n${JSON.stringify(payloadPreview, null, 2)}`, LOG_TYPES.INFO);
            addLog('\u23F3 WAITING: Backend processing (STT \u2192 Translate \u2192 TTS)...', LOG_TYPES.INFO);
            setStatus('Waiting for backend response...');
          },
        });

        if (!shouldContinueRef.current) {
          return;
        }

        const { responseArrayBuffer, responseContentType, responseBytes, payload } = sendResult;
        if (payload) {
          setLastPayload(payload);
        }

        addLog(
          `\u2705 HTTP RESPONSE: Received translated audio (${responseBytes} bytes, content-type: ${responseContentType})`,
          LOG_TYPES.SUCCESS
        );

        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextCtor) {
          const decodeError = new Error('Web Audio API is not supported in this browser.');
          decodeError.code = 'decode_error';
          throw decodeError;
        }

        stopPlayback();

        audioContext = new AudioContextCtor();
        setStatus('Decoding translated audio...');
        const audioBuffer = await decodeAudioBuffer(audioContext, responseArrayBuffer);

        if (!shouldContinueRef.current) {
          await audioContext.close();
          audioContext = null;
          return;
        }

        setPipelineState(PIPELINE_STATES.PLAYING_AUDIO);
        setStatus('Playing translated audio...');
        addLog('\u{1F50A} PLAYBACK: Playing translated audio...', LOG_TYPES.INFO);
        await playAudioBuffer(audioContext, audioBuffer);
        audioContext = null;
        addLog('\u2705 PLAYBACK COMPLETE', LOG_TYPES.SUCCESS);

        if (!shouldContinueRef.current) {
          return;
        }

        addLog('\u{1F504} AUTO-RESTART: Starting listening again...', LOG_TYPES.INFO);
        setPipelineState(PIPELINE_STATES.LISTENING);
        setStatus('Listening...');

        if (engineRef.current && ready && shouldContinueRef.current) {
          engineRef.current.start();
        }
      } catch (error) {
        console.error('[Pipeline] Error during backend integration', error);

        if (audioContext) {
          try {
            audioContext.close();
          } catch (closeError) {
            console.warn('AudioContext close failed', closeError);
          }
          audioContext = null;
        }

        stopPlayback({ invokeResolve: true });

        if (error?.code === 'network_error') {
          addLog('\u274C NETWORK ERROR: Failed to connect to backend', LOG_TYPES.WARNING);
        } else if (error?.code === 'http_error') {
          addLog(
            `\u274C HTTP ERROR: ${error.status} - ${error.statusText || 'Unknown error'}`,
            LOG_TYPES.WARNING
          );
          if (error.body) {
            addLog(`Response body: ${error.body}`, LOG_TYPES.WARNING);
          }
        } else if (error?.code === 'invalid_content_type') {
          addLog(
            `\u274C HTTP ERROR: Unexpected response type ${error.contentType || 'unknown'}`,
            LOG_TYPES.WARNING
          );
        } else if (error?.code === 'decode_error') {
          addLog('\u274C DECODE ERROR: Cannot decode audio response', LOG_TYPES.WARNING);
        } else {
          addLog(`\u274C UNKNOWN ERROR: ${error.message || error}`, LOG_TYPES.WARNING);
        }

        if (requestPayloadSnapshot) {
          setLastPayload(requestPayloadSnapshot);
        }

        if (engineRef.current) {
          try {
            engineRef.current.stop();
          } catch (engineError) {
            console.warn('Engine stop failed', engineError);
          }
        }

        setStatus('Error - Click Start to retry');
        setPipelineState(PIPELINE_STATES.IDLE);
        shouldContinueRef.current = false;
        setIsActive(false);
        return;
      } finally {
        processingRef.current = false;
      }
    },
    [
      addLog,
      backendUrl,
      decodeAudioBuffer,
      neuralVoice,
      playAudioBuffer,
      ready,
      showFullRequest,
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
        addLog('\u{1F3A4} LISTENING: Recording audio...', LOG_TYPES.INFO);
      } else if (nextState === ENGINE_STATES.RECORDING) {
        setPipelineState(PIPELINE_STATES.RECORDING);
        addLog('\u{1F50A} SPEAKING: Voice detected', LOG_TYPES.INFO);
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
      addLog(`\u{1F507} SILENCE DETECTED: After ${duration.toFixed(1)}s of silence`, LOG_TYPES.WARNING);
    },
    [addLog]
  );

  const handleDeviceError = useCallback(
    (info) => {
      const attemptedId = info && info.deviceId ? info.deviceId : 'requested device';
      addLog(
        `\u{1F399}\uFE0F DEVICE ERROR: Microphone "${attemptedId}" unavailable. Falling back to default.`,
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
          addLog('\u2705 Model ready. Awaiting Start command.', LOG_TYPES.SUCCESS);
        }
      })
      .catch((error) => {
        console.error('Unable to initialize Silero VAD', error);
        if (!cancelled) {
          const reason = error && error.message ? error.message : String(error);
          setStatus(`Initialization failed: ${reason}`);
          addLog(`\u274C INIT ERROR: ${reason}`, LOG_TYPES.WARNING);
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
    addLog('\u25B6 START: User clicked Start button', LOG_TYPES.INFO);

    engineRef.current.setDevice(selectedDeviceId === DEFAULT_DEVICE_ID ? null : selectedDeviceId);
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
    addLog('\u23F9 STOP: User clicked Stop button', LOG_TYPES.WARNING);
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

      addLog(`\u{1F399}\uFE0F DEVICE CHANGED: Now using ${deviceLabel}`, LOG_TYPES.INFO);

      if (engineRef.current) {
        engineRef.current.setDevice(normalizedId === DEFAULT_DEVICE_ID ? null : normalizedId);
      }

      if (shouldContinueRef.current) {
        addLog(`\u{1F504} RESTARTING: Switching to new microphone (${deviceLabel})...`, LOG_TYPES.INFO);
        setStatus('Switching to new microphone...');
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
    backendUrl,
    setBackendUrl,
    showFullRequest,
    setShowFullRequest,
  };
}





