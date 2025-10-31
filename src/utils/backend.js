const TARGET_SAMPLE_RATE = 16000;
const TARGET_BIT_DEPTH = 16;
const WAV_HEADER_SIZE = 44;
const FETCH_TIMEOUT_MS = 30000;

function floatTo16BitPCM(view, offset, input) {
  for (let i = 0; i < input.length; i += 1, offset += 2) {
    const sample = Math.max(-1, Math.min(1, input[i] || 0));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i += 1) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function encodeWavToBase64(float32Array) {
  if (!float32Array || float32Array.length === 0) {
    return { base64: '', byteLength: 0 };
  }

  const buffer = new ArrayBuffer(WAV_HEADER_SIZE + float32Array.length * 2);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + float32Array.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_SAMPLE_RATE, true);
  view.setUint32(28, TARGET_SAMPLE_RATE * TARGET_BIT_DEPTH * 1 / 8, true);
  view.setUint16(32, TARGET_BIT_DEPTH / 8, true);
  view.setUint16(34, TARGET_BIT_DEPTH, true);
  writeString(view, 36, 'data');
  view.setUint32(40, float32Array.length * 2, true);

  floatTo16BitPCM(view, WAV_HEADER_SIZE, float32Array);

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }

  let base64 = '';
  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    base64 = window.btoa(binary);
  } else if (typeof Buffer !== 'undefined') {
    base64 = Buffer.from(binary, 'binary').toString('base64');
  } else {
    throw new Error('Base64 encoding is not supported in this environment.');
  }

  return { base64, byteLength: bytes.length };
}

async function fetchWithTimeout(url, options, timeoutMs) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

export default async function sendAudioToBackend(audioData, config) {
  const sourceLanguage = config?.sourceLanguage || 'English';
  const targetLanguage = config?.targetLanguage || 'Spanish';
  const neuralVoice = config?.neuralVoice || 'Female Voice 1';
  const backendUrl = config?.backendUrl || 'http://localhost:7071';
  const showFullRequest = Boolean(config?.showFullRequest);
  const beforeSend =
    typeof config?.onBeforeSend === 'function' ? config.onBeforeSend : null;

  if (!backendUrl || backendUrl.trim().length === 0) {
    throw new Error('Backend URL is not configured.');
  }

  const { base64, byteLength } = encodeWavToBase64(audioData);

  const payload = {
    source_language: sourceLanguage,
    target_language: targetLanguage,
    neural_voice: neuralVoice,
    audio_data: base64,
  };

  if (showFullRequest) {
    console.log('[Backend] Full request payload:', payload);
  }

  const endpoint = `${backendUrl.replace(/\/+$/, '')}/api/translate`;
  const requestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  };

  if (beforeSend) {
    try {
      beforeSend({
        payload,
        endpoint,
        requestBytes: byteLength,
      });
    } catch (callbackError) {
      console.warn('[Backend] onBeforeSend callback threw an error', callbackError);
    }
  }

  let response;
  try {
    response = await fetchWithTimeout(endpoint, requestInit, FETCH_TIMEOUT_MS);
  } catch (networkError) {
    const error = new Error('Network error while contacting backend.');
    error.code = 'network_error';
    error.cause = networkError;
    throw error;
  }

  if (!response.ok) {
    const error = new Error(
      `HTTP ${response.status} - ${response.statusText || 'Unknown error'}`
    );
    error.code = 'http_error';
    error.status = response.status;
    error.statusText = response.statusText;
    try {
      error.body = await response.text();
    } catch (readError) {
      // ignore
    }
    throw error;
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('audio')) {
    const error = new Error(`Unexpected response type: ${contentType}`);
    error.code = 'invalid_content_type';
    error.contentType = contentType;
    throw error;
  }

  const arrayBuffer = await response.arrayBuffer();

  return {
    payload,
    requestBytes: byteLength,
    responseArrayBuffer: arrayBuffer,
    responseContentType: contentType,
    responseBytes: arrayBuffer.byteLength,
    endpoint,
  };
}
