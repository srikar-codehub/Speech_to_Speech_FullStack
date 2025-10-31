import * as ort from 'onnxruntime-web';
import createDownsampler from './Downsampler';
import createRingBuffer from './RingBuffer';

const TARGET_SAMPLE_RATE = 16000;
const CHUNK_SAMPLES = 512; // ~32ms at 16kHz
const CONTEXT_SAMPLES = 64;
const STATE_SIZE = 2 * 1 * 128;
const SPEECH_THRESHOLD = 0.5;
const DEFAULT_SILENCE_SECONDS = 2;
const MIN_SILENCE_SECONDS = 0.5;
const MAX_SILENCE_SECONDS = 5;

export const ENGINE_STATES = {
  IDLE: 'IDLE',
  LISTENING: 'LISTENING',
  RECORDING: 'RECORDING',
  SILENCE_DETECTED: 'SILENCE_DETECTED',
};

function clamp(value, min, max) {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function cloneFloat32(source) {
  const copy = new Float32Array(source.length);
  copy.set(source);
  return copy;
}

function resolveMediaStream(constraints, callback, errorCallback) {
  const legacy =
    navigator.mediaDevices && navigator.mediaDevices.getUserMedia
      ? null
      : navigator.getUserMedia ||
        navigator.webkitGetUserMedia ||
        navigator.mozGetUserMedia ||
        navigator.msGetUserMedia;

  if (legacy) {
    legacy.call(navigator, constraints, callback, errorCallback);
    return;
  }

  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices
      .getUserMedia(constraints)
      .then(callback)
      .catch(errorCallback);
    return;
  }

  errorCallback(new Error('getUserMedia is not supported in this browser.'));
}

export default function createSileroVadEngine(options) {
  const config = options || {};
  const modelPath = config.modelPath || `${process.env.PUBLIC_URL || ''}/silero_vad.onnx`;
  const statusListener =
    typeof config.onStatusChange === 'function' ? config.onStatusChange : () => {};
  const stateListener =
    typeof config.onStateChange === 'function' ? config.onStateChange : () => {};
  const recordingCompleteListener =
    typeof config.onRecordingComplete === 'function' ? config.onRecordingComplete : () => {};
  const silenceDetectedListener =
    typeof config.onSilenceDetected === 'function' ? config.onSilenceDetected : () => {};
  const deviceErrorListener =
    typeof config.onDeviceError === 'function' ? config.onDeviceError : () => {};
  const logSilence = config.logSilence !== false;

  let silenceDurationSeconds = clamp(
    typeof config.silenceDuration === 'number' ? config.silenceDuration : DEFAULT_SILENCE_SECONDS,
    MIN_SILENCE_SECONDS,
    MAX_SILENCE_SECONDS
  );

  let selectedDeviceId = typeof config.deviceId === 'string' ? config.deviceId : null;

  let session = null;
  let audioContext = null;
  let processorNode = null;
  let inputSource = null;
  let streamRef = null;
  let downsampler = null;
  let sessionReady = false;
  let disposed = false;
  let runningInference = false;
  let pendingCapture = false;
  let active = false;
  let capturing = false;
  let processingSilence = false;

  let contextBuffer = new Float32Array(CONTEXT_SAMPLES);
  let stateBuffer = new Float32Array(STATE_SIZE);
  let stateTensor = null;
  let sampleRateTensor = null;

  let pendingResidual = new Float32Array(0);
  let chunkQueue = [];
  let speaking = false;
  let currentStatus = 'Loading model...';
  let engineState = ENGINE_STATES.IDLE;

  let recordingBuffers = [];
  let recordingLength = 0;

  const chunkDurationMs = (CHUNK_SAMPLES / TARGET_SAMPLE_RATE) * 1000;
  let silenceFramesRequired = 1;
  let silenceRing = createRingBuffer(1);

  function setStatus(nextStatus) {
    if (currentStatus !== nextStatus) {
      currentStatus = nextStatus;
      statusListener(currentStatus);
    }
  }

  function setEngineState(nextState, statusMessage) {
    if (engineState !== nextState) {
      engineState = nextState;
      stateListener(engineState);
    }
    if (typeof statusMessage === 'string') {
      setStatus(statusMessage);
    }
  }

  function resetRecording() {
    recordingBuffers = [];
    recordingLength = 0;
  }

  function appendToRecording(chunk) {
    if (!capturing || !chunk || chunk.length === 0) {
      return;
    }
    recordingBuffers.push(Float32Array.from(chunk));
    recordingLength += chunk.length;
  }

  function collectRecording() {
    if (recordingLength === 0) {
      return new Float32Array(0);
    }
    const merged = new Float32Array(recordingLength);
    let offset = 0;
    for (let i = 0; i < recordingBuffers.length; i += 1) {
      merged.set(recordingBuffers[i], offset);
      offset += recordingBuffers[i].length;
    }
    return merged;
  }

  function updateSilenceDuration(seconds) {
    silenceDurationSeconds = clamp(seconds, MIN_SILENCE_SECONDS, MAX_SILENCE_SECONDS);
    silenceFramesRequired = Math.max(
      1,
      Math.round((silenceDurationSeconds * 1000) / chunkDurationMs)
    );
    silenceRing = createRingBuffer(Math.max(1, silenceFramesRequired));
  }

  updateSilenceDuration(silenceDurationSeconds);

  function resetInferenceState() {
    contextBuffer.fill(0);
    stateBuffer.fill(0);
    stateTensor = new ort.Tensor('float32', stateBuffer, [2, 1, 128]);
    pendingResidual = new Float32Array(0);
    chunkQueue = [];
    silenceRing.clear();
    speaking = false;
  }

  resetInferenceState();

  function clearProcessingQueues() {
    chunkQueue = [];
    pendingResidual = new Float32Array(0);
    silenceRing.clear();
    speaking = false;
  }

  function finalizeSilenceDetection() {
    if (processingSilence) {
      return;
    }
    processingSilence = true;
    active = false;
    capturing = false;

    setEngineState(ENGINE_STATES.SILENCE_DETECTED, 'Silence detected.');

    try {
      silenceDetectedListener(silenceDurationSeconds);
    } catch (callbackError) {
      console.warn('[SileroVAD] Silence detected listener error', callbackError);
    }

    const recorded = collectRecording();
    releaseAudioResources();
    resetInferenceState();
    clearProcessingQueues();
    recordingCompleteListener(recorded);
    resetRecording();

    processingSilence = false;
  }

  function prepareInput(chunk) {
    const buffer = new Float32Array(CONTEXT_SAMPLES + CHUNK_SAMPLES);
    buffer.set(contextBuffer, 0);
    buffer.set(chunk, CONTEXT_SAMPLES);
    contextBuffer.set(buffer.subarray(buffer.length - CONTEXT_SAMPLES));
    return buffer;
  }

  function enqueueChunk(chunk) {
    const payload = cloneFloat32(chunk);
    chunkQueue.push(payload);
    processQueue();
  }

  function updateStateTensor(nextState) {
    if (!nextState) {
      return;
    }
    if (!stateTensor || !stateTensor.data) {
      stateTensor = new ort.Tensor('float32', stateBuffer, nextState.dims);
    }
    stateBuffer.set(nextState.data);
  }

  function processQueue() {
    if (!sessionReady || runningInference || chunkQueue.length === 0 || !active) {
      return;
    }

    runningInference = true;
    const chunk = chunkQueue.shift();
    const inputBuffer = prepareInput(chunk);

    const feeds = {
      input: new ort.Tensor('float32', inputBuffer, [1, inputBuffer.length]),
      state: stateTensor,
      sr: sampleRateTensor,
    };

    session
      .run(feeds)
      .then((result) => {
        const speechProb = result.output && result.output.data ? Number(result.output.data[0]) : 0;
        updateStateTensor(result.stateN);
        handleDetection(speechProb);
      })
      .catch((error) => {
        console.error('[SileroVAD] Inference failed', error);
        setStatus('Error during inference');
      })
      .finally(() => {
        runningInference = false;
        processQueue();
      });
  }

  function handleDetection(probability) {
    if (!active) {
      return;
    }

    const isSpeech = probability > SPEECH_THRESHOLD;
    silenceRing.push(isSpeech ? 1 : 0);

    if (isSpeech) {
      if (!speaking) {
        setEngineState(ENGINE_STATES.RECORDING, 'Recording...');
      }
      speaking = true;
      return;
    }

    if (speaking) {
      setEngineState(ENGINE_STATES.LISTENING, 'Listening...');
    }
    speaking = false;

    if (silenceRing.size() >= silenceFramesRequired && silenceRing.sum() === 0) {
      if (logSilence) {
        console.log(`[SileroVAD] Silence detected after ${silenceDurationSeconds.toFixed(2)}s`);
      }
      finalizeSilenceDetection();
    }
  }

  function downsampleAndSchedule(inputChunk) {
    if (!downsampler || !active) {
      return;
    }
    const resampled = downsampler.process(inputChunk);
    if (!resampled || resampled.length === 0) {
      return;
    }

    appendToRecording(resampled);

    const merged = new Float32Array(pendingResidual.length + resampled.length);
    merged.set(pendingResidual, 0);
    merged.set(resampled, pendingResidual.length);

    let offset = 0;
    while (offset + CHUNK_SAMPLES <= merged.length) {
      const slice = merged.subarray(offset, offset + CHUNK_SAMPLES);
      enqueueChunk(slice);
      offset += CHUNK_SAMPLES;
    }

    pendingResidual = merged.slice(offset);
  }

  function attachProcessor(stream) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    downsampler = createDownsampler(audioContext.sampleRate, TARGET_SAMPLE_RATE);
    sampleRateTensor = new ort.Tensor('int64', BigInt64Array.from([BigInt(TARGET_SAMPLE_RATE)]));

    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }

    inputSource = audioContext.createMediaStreamSource(stream);
    processorNode = audioContext.createScriptProcessor(2048, 1, 1);
    processorNode.onaudioprocess = (event) => {
      downsampleAndSchedule(event.inputBuffer.getChannelData(0));
    };
    inputSource.connect(processorNode);
    processorNode.connect(audioContext.destination);
    capturing = true;
    resetRecording();
    setEngineState(ENGINE_STATES.LISTENING, 'Listening...');
  }

  function releaseAudioResources() {
    capturing = false;
    pendingCapture = false;
    if (processorNode) {
      processorNode.disconnect();
      processorNode.onaudioprocess = null;
      processorNode = null;
    }
    if (inputSource) {
      inputSource.disconnect();
      inputSource = null;
    }
    if (streamRef) {
      streamRef.getTracks().forEach((track) => track.stop());
      streamRef = null;
    }
    if (audioContext) {
      audioContext.close().catch(() => {});
      audioContext = null;
    }
    downsampler = null;
  }

  function requestCapture() {
    if (!active || disposed || pendingCapture) {
      return;
    }
    pendingCapture = true;
    resetInferenceState();

    const constraints = selectedDeviceId
      ? { audio: { deviceId: { exact: selectedDeviceId } }, video: false }
      : { audio: true, video: false };

    const handleStream = (stream) => {
      pendingCapture = false;
      if (disposed || !active) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      console.info('[SileroVAD] Microphone access granted');
      streamRef = stream;
      attachProcessor(stream);
    };

    const handleError = (error) => {
      pendingCapture = false;
      if (selectedDeviceId) {
        console.warn(
          `[SileroVAD] Requested device ${selectedDeviceId} unavailable. Falling back to default.`,
          error
        );
        try {
          deviceErrorListener({
            type: 'unavailable',
            deviceId: selectedDeviceId,
            error,
          });
        } catch (callbackError) {
          console.warn('[SileroVAD] Device error listener threw', callbackError);
        }
        selectedDeviceId = null;
        requestCapture();
        return;
      }
      console.error('[SileroVAD] Unable to access microphone', error);
      setStatus('Microphone access denied');
    };

    resolveMediaStream(constraints, handleStream, handleError);
  }

  function configureOrt() {
    if (config.wasmPath) {
      ort.env.wasm.wasmPaths = config.wasmPath;
    } else {
      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.0/dist/';
    }
    console.info('[SileroVAD] Using wasm assets from:', ort.env.wasm.wasmPaths);
    ort.env.wasm.proxy = false;
    ort.env.logLevel = 'warning';
  }

  function loadModelBinary() {
    const request = new XMLHttpRequest();
    request.open('GET', modelPath, false);
    console.info('[SileroVAD] Loading model from', modelPath);
    if (request.overrideMimeType) {
      request.overrideMimeType('text/plain; charset=x-user-defined');
    }
    try {
      request.send(null);
    } catch (networkError) {
      console.error('[SileroVAD] Network error during model load', networkError);
      throw networkError;
    }

    if (request.status !== 200) {
      console.error(
        `[SileroVAD] Model load failed. Status: ${request.status} ${request.statusText}`
      );
      throw new Error(`Unable to load model from ${modelPath}`);
    }

    const responseText = request.responseText || '';
    const byteLength = responseText.length;
    const modelBytes = new Uint8Array(byteLength);
    for (let i = 0; i < byteLength; i += 1) {
      modelBytes[i] = responseText.charCodeAt(i) & 0xff;
    }
    console.info('[SileroVAD] Model bytes loaded:', byteLength);
    return modelBytes;
  }

  function initializeSession() {
    configureOrt();
    resetInferenceState();
    try {
      const modelBinary = loadModelBinary();
      console.info('[SileroVAD] Creating ONNX Runtime session');
      return ort.InferenceSession.create(modelBinary, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
        executionMode: 'sequential',
      })
        .then((createdSession) => {
          console.info('[SileroVAD] Session created successfully');
          session = createdSession;
          sessionReady = true;
          return session.getInputMetadata ? session : createdSession;
        })
        .catch((error) => {
          console.error('[SileroVAD] Failed to create ONNX session', error);
          throw error;
        });
    } catch (error) {
      console.error('[SileroVAD] Silero model load/init error', error);
      return Promise.reject(error);
    }
  }

  function disposeSession() {
    if (session && session.release) {
      session.release().catch(() => {});
    }
    session = null;
    sessionReady = false;
  }

  return {
    init() {
      return initializeSession();
    },
    start() {
      if (!sessionReady || disposed) {
        return;
      }
      active = true;
      setEngineState(ENGINE_STATES.LISTENING, 'Preparing microphone...');
      requestCapture();
    },
    stop() {
      active = false;
      processingSilence = false;
      releaseAudioResources();
      clearProcessingQueues();
      resetRecording();
      resetInferenceState();
      setEngineState(ENGINE_STATES.IDLE, 'Idle');
    },
    dispose() {
      disposed = true;
      active = false;
      processingSilence = false;
      releaseAudioResources();
      clearProcessingQueues();
      resetRecording();
      disposeSession();
      setEngineState(ENGINE_STATES.IDLE, 'Disposed');
    },
    status() {
      return currentStatus;
    },
    state() {
      return engineState;
    },
    setSilenceDuration(seconds) {
      updateSilenceDuration(seconds);
      silenceRing.clear();
    },
    setDevice(deviceId) {
      const nextId = typeof deviceId === 'string' && deviceId.length > 0 ? deviceId : null;
      if (selectedDeviceId === nextId) {
        return;
      }
      selectedDeviceId = nextId;
      if (active) {
        setEngineState(ENGINE_STATES.LISTENING, 'Switching microphone...');
        releaseAudioResources();
        clearProcessingQueues();
        resetRecording();
        resetInferenceState();
        requestCapture();
      }
    },
    isActive() {
      return active;
    },
  };
}
