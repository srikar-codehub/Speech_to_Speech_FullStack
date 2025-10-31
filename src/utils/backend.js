const TARGET_AMPLITUDE = 0x7fff;

function float32ToPcm16Base64(float32Array) {
  if (!float32Array || float32Array.length === 0) {
    return '';
  }

  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < float32Array.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, float32Array[i] || 0));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * TARGET_AMPLITUDE, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }

  if (typeof window !== 'undefined' && window.btoa) {
    return window.btoa(binary);
  }

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(binary, 'binary').toString('base64');
  }

  throw new Error('Base64 encoding is not supported in this environment.');
}

export default function sendAudioToBackend(audioData, config) {
  const sourceLanguage = config?.sourceLanguage || 'English';
  const targetLanguage = config?.targetLanguage || 'Spanish';
  const neuralVoice = config?.neuralVoice || 'Female Voice 1';

  const audioBase64 = float32ToPcm16Base64(audioData);

  const payload = {
    source_language: sourceLanguage,
    target_language: targetLanguage,
    neural_voice: neuralVoice,
    audio_data: audioBase64,
  };

  console.log('[Backend] Prepared payload for translation:', payload);
  // TODO: Send POST request to backend endpoint

  return payload;
}
