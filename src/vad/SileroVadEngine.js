import * as ort from 'onnxruntime-web';
import createDownsampler from './Downsampler';
import createRingBuffer from './RingBuffer';

const TARGET_SAMPLE_RATE = 16000;
const CHUNK_SAMPLES = 512; // ~32ms at 16kHz
const CONTEXT_SAMPLES = 64;
const STATE_SIZE = 2 * 1 * 128;
const SPEECH_THRESHOLD = 0.5;
const SILENCE_TIMEOUT_MS = 2000;
const BUFFER_DURATION_MS = 2000;

function cloneFloat32(source) {
  const copy = new Float32Array(source.length);
  copy.set(source);
  return copy;
}

function resolveMediaStream(callback, errorCallback) {
  const legacy =
    navigator.mediaDevices && navigator.mediaDevices.getUserMedia
      ? null
      : navigator.getUserMedia ||
        navigator.webkitGetUserMedia ||
        navigator.mozGetUserMedia ||
        navigator.msGetUserMedia;

  if (legacy) {
    legacy.call(navigator, { audio: true, video: false }, callback, errorCallback);
    return;
  }

  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices
      .getUserMedia({ audio: true, video: false })
      .then(callback)
      .catch(errorCallback);
    return;
  }

  errorCallback(new Error('getUserMedia is not supported in this browser.'));
}

export default function createSileroVadEngine(options) {
  const config = options || {};
  const modelPath = config.modelPath || `${process.env.PUBLIC_URL || ''}/silero_vad.onnx`;
  const statusListener = typeof config.onStatusChange === 'function' ? config.onStatusChange : () => {};
  const logSilence = config.logSilence !== false;

  let session = null;
  let audioContext = null;
  let processorNode = null;
  let inputSource = null;
  let streamRef = null;
  let downsampler = null;
  let sessionReady = false;
  let disposed = false;
  let runningInference = false;

  let contextBuffer = new Float32Array(CONTEXT_SAMPLES);
  let stateBuffer = new Float32Array(STATE_SIZE);
  let stateTensor = null;
  let sampleRateTensor = null;

  let pendingResidual = new Float32Array(0);
  let chunkQueue = [];
  let speaking = false;
  let currentStatus = 'Listening...';

  const chunkDurationMs = (CHUNK_SAMPLES / TARGET_SAMPLE_RATE) * 1000;
  const ringBufferSize = Math.max(1, Math.round(BUFFER_DURATION_MS / chunkDurationMs));
  const silenceFramesRequired = Math.max(1, Math.round(SILENCE_TIMEOUT_MS / chunkDurationMs));
  const silenceRing = createRingBuffer(ringBufferSize);

  function setStatus(nextStatus) {
    if (currentStatus !== nextStatus) {
      currentStatus = nextStatus;
      statusListener(currentStatus);
    }
  }

  function resetState() {
    contextBuffer.fill(0);
    stateBuffer.fill(0);
    stateTensor = new ort.Tensor('float32', stateBuffer, [2, 1, 128]);
    pendingResidual = new Float32Array(0);
    chunkQueue = [];
    silenceRing.clear();
    speaking = false;
    setStatus('Listening...');
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
    if (!sessionReady || runningInference || chunkQueue.length === 0) {
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
    const isSpeech = probability > SPEECH_THRESHOLD;
    silenceRing.push(isSpeech ? 1 : 0);

    if (isSpeech) {
      if (!speaking) {
        setStatus('Speaking...');
      }
      speaking = true;
      return;
    }

    if (speaking) {
      setStatus('Listening...');
    }
    speaking = false;

    if (silenceRing.size() >= silenceFramesRequired && silenceRing.sum() === 0) {
      if (logSilence) {
        console.log('Silence detected');
      }
      setStatus('Silence detected.');
      restartCapture();
    }
  }

  function downsampleAndSchedule(inputChunk) {
    if (!downsampler) {
      return;
    }
    const resampled = downsampler.process(inputChunk);
    if (!resampled || resampled.length === 0) {
      return;
    }
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
  }

  function releaseAudioResources() {
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
  }

  function restartCapture() {
    releaseAudioResources();
    resetState();
    requestCapture();
  }

  function requestCapture() {
    resolveMediaStream(
      (stream) => {
        if (disposed) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        console.info('[SileroVAD] Microphone access granted');
        streamRef = stream;
        attachProcessor(stream);
        setStatus('Listening...');
      },
      (error) => {
        console.error('[SileroVAD] Unable to access microphone', error);
        setStatus('Microphone access denied');
      }
    );
  }

  function initializeSession() {
    configureOrt();
    resetState();
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
          return session.getInputMetadata
            ? session
            : createdSession;
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
      if (!sessionReady) {
        return;
      }
      requestCapture();
    },
    stop() {
      releaseAudioResources();
      resetState();
    },
    dispose() {
      disposed = true;
      releaseAudioResources();
      disposeSession();
    },
    status() {
      return currentStatus;
    },
  };
}
