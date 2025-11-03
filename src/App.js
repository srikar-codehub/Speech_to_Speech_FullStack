import { useEffect, useMemo } from 'react';
import useSileroVad, { PIPELINE_STATES } from './hooks/useSileroVad';
import VadStatusIndicator from './components/VadStatusIndicator';
import SilenceDurationControl from './components/SilenceDurationControl';
import MicrophoneSelector from './components/MicrophoneSelector';
import SelectControl from './components/SelectControl';
import PipelineLogger from './components/PipelineLogger';
import './App.css';
import azureLanguages from './data/azure_languages.json';
import azureVoices from './data/azure_voices.json';

const LANGUAGE_TO_LOCALE_MAP = {
  af: 'af-ZA',
  am: 'am-ET',
  ar: 'ar-SA',
  as: 'as-IN',
  az: 'az-AZ',
  ba: 'ba-RU',
  bg: 'bg-BG',
  bn: 'bn-IN',
  bs: 'bs-BA',
  ca: 'ca-ES',
  cs: 'cs-CZ',
  cy: 'cy-GB',
  da: 'da-DK',
  de: 'de-DE',
  el: 'el-GR',
  en: 'en-US',
  es: 'es-ES',
  et: 'et-EE',
  eu: 'eu-ES',
  fa: 'fa-IR',
  fi: 'fi-FI',
  fil: 'fil-PH',
  fr: 'fr-FR',
  ga: 'ga-IE',
  gl: 'gl-ES',
  gu: 'gu-IN',
  he: 'he-IL',
  hi: 'hi-IN',
  hr: 'hr-HR',
  hu: 'hu-HU',
  hy: 'hy-AM',
  id: 'id-ID',
  is: 'is-IS',
  it: 'it-IT',
  ja: 'ja-JP',
  jv: 'jv-ID',
  ka: 'ka-GE',
  kk: 'kk-KZ',
  km: 'km-KH',
  kn: 'kn-IN',
  ko: 'ko-KR',
  lo: 'lo-LA',
  lt: 'lt-LT',
  lv: 'lv-LV',
  mk: 'mk-MK',
  ml: 'ml-IN',
  mn: 'mn-MN',
  mr: 'mr-IN',
  ms: 'ms-MY',
  mt: 'mt-MT',
  my: 'my-MM',
  ne: 'ne-NP',
  nl: 'nl-NL',
  no: 'nb-NO',
  pa: 'pa-IN',
  pl: 'pl-PL',
  ps: 'ps-AF',
  pt: 'pt-PT',
  ro: 'ro-RO',
  ru: 'ru-RU',
  si: 'si-LK',
  sk: 'sk-SK',
  sl: 'sl-SI',
  so: 'so-SO',
  sq: 'sq-AL',
  sr: 'sr-RS',
  sv: 'sv-SE',
  sw: 'sw-KE',
  ta: 'ta-IN',
  te: 'te-IN',
  th: 'th-TH',
  tr: 'tr-TR',
  uk: 'uk-UA',
  ur: 'ur-PK',
  uz: 'uz-UZ',
  vi: 'vi-VN',
  zh: 'zh-CN',
  zu: 'zu-ZA',
};

function resolveLocaleForCode(code) {
  if (!code) {
    return '';
  }
  const direct = LANGUAGE_TO_LOCALE_MAP[code];
  if (direct) {
    return direct;
  }
  const fallbackLocale = Object.keys(azureVoices).find((locale) =>
    locale.toLowerCase().startsWith(`${code.toLowerCase()}-`)
  );
  return fallbackLocale || '';
}

function App() {
  const logoUrl = `${process.env.PUBLIC_URL || ''}/protiviti-logo.svg`;

  const defaultSourceLanguage = useMemo(() => {
    const code = 'en';
    const language = azureLanguages?.[code] || {};
    const name = language?.name || 'English';
    const nativeName = language?.nativeName || name;
    return {
      code,
      name,
      nativeName,
      locale: resolveLocaleForCode(code),
    };
  }, []);

  const defaultTargetLanguage = useMemo(() => {
    const code = 'es';
    const language = azureLanguages?.[code] || {};
    const name = language?.name || 'Spanish';
    const nativeName = language?.nativeName || name;
    return {
      code,
      name,
      nativeName,
      locale: resolveLocaleForCode(code),
    };
  }, []);

  const defaultNeuralVoice = useMemo(() => {
    const targetLocale = defaultTargetLanguage?.locale;
    if (!targetLocale) {
      return null;
    }
    const voices = azureVoices?.[targetLocale] || [];
    if (!Array.isArray(voices) || voices.length === 0) {
      return null;
    }
    const preferred = voices.find((voice) => voice.gender === 'Female') || voices[0];
    return preferred ? { ...preferred } : null;
  }, [defaultTargetLanguage]);

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
  } = useSileroVad({
    initialSourceLanguage: defaultSourceLanguage,
    initialTargetLanguage: defaultTargetLanguage,
    initialNeuralVoice: defaultNeuralVoice,
  });

  const languageOptions = useMemo(() => {
    return Object.entries(azureLanguages || {})
      .map(([code, language]) => {
        const name = language?.name || code;
        const nativeName = language?.nativeName || name;
        const locale = resolveLocaleForCode(code);
        return {
          value: code,
          label: `${name} (${nativeName}) - ${code}`,
          data: {
            code,
            name,
            nativeName,
            locale,
          },
        };
      })
      .sort((a, b) => a.data.name.localeCompare(b.data.name));
  }, []);

  const targetLocale = targetLanguage?.locale || '';

  const availableVoiceOptions = useMemo(() => {
    if (!targetLocale) {
      return [];
    }
    const voices = azureVoices?.[targetLocale] || [];
    if (!Array.isArray(voices)) {
      return [];
    }
    return voices.map((voice) => ({
      value: voice.short_name,
      label: `${voice.name} - ${voice.gender}`,
      data: { ...voice },
    }));
  }, [targetLocale]);

  const voiceSelectOptions =
    availableVoiceOptions.length > 0
      ? availableVoiceOptions
      : [
          {
            value: '',
            label: 'No voices available',
            data: null,
          },
        ];

  useEffect(() => {
    if (!targetLocale) {
      setNeuralVoice(null);
      return;
    }
    const voices = azureVoices?.[targetLocale] || [];
    if (!Array.isArray(voices) || voices.length === 0) {
      setNeuralVoice(null);
      return;
    }

    setNeuralVoice((currentVoice) => {
      if (
        currentVoice &&
        voices.some((voice) => voice.short_name === currentVoice.short_name)
      ) {
        return currentVoice;
      }
      const preferredVoice = voices.find((voice) => voice.gender === 'Female') || voices[0];
      return preferredVoice ? { ...preferredVoice } : null;
    });
  }, [targetLocale, setNeuralVoice]);

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
      <header className="app-header">
        <h1 className="app-title">Speech to Speech Translator App</h1>
        <a
          className="app-logo-link"
          href="https://www.protiviti.com"
          target="_blank"
          rel="noreferrer"
          aria-label="Protiviti homepage"
        >
          <img className="app-logo" src={logoUrl} alt="Protiviti logo" />
        </a>
      </header>

      <main className="app-main">
        <section className="control-grid">
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
        </section>

        <section className="config-card">
          <h2 className="section-title">Configuration</h2>
          <div className="config-grid">
            <SelectControl
              label="Source Language"
              value={sourceLanguage?.code || ''}
              options={languageOptions}
              onChange={(selection) => {
                if (!selection || !selection.code) {
                  return;
                }
                setSourceLanguage({
                  code: selection.code,
                  name: selection.name,
                  nativeName: selection.nativeName,
                  locale: selection.locale || resolveLocaleForCode(selection.code),
                });
              }}
              disabled={!ready}
              id="source-language-select"
            />
            <SelectControl
              label="Target Language"
              value={targetLanguage?.code || ''}
              options={languageOptions}
              onChange={(selection) => {
                if (!selection || !selection.code) {
                  return;
                }
                setTargetLanguage({
                  code: selection.code,
                  name: selection.name,
                  nativeName: selection.nativeName,
                  locale: selection.locale || resolveLocaleForCode(selection.code),
                });
              }}
              disabled={!ready}
              id="target-language-select"
            />
            <SelectControl
              label="Neural Voice"
              value={neuralVoice?.short_name || ''}
              options={voiceSelectOptions}
              onChange={(voice) => {
                if (voice && voice.short_name) {
                  setNeuralVoice({ ...voice });
                } else {
                  setNeuralVoice(null);
                }
              }}
              disabled={!ready}
              id="neural-voice-select"
            />
            <div className="form-field">
              <label className="form-label" htmlFor="backend-url-input">
                Backend URL
              </label>
              <input
                id="backend-url-input"
                type="text"
                className="text-input"
                value={backendUrl}
                onChange={(event) => setBackendUrl(event.target.value)}
                placeholder="https://your-backend"
              />
            </div>
            <label className="checkbox-field" htmlFor="backend-debug-checkbox">
              <input
                id="backend-debug-checkbox"
                type="checkbox"
                checked={showFullRequest}
                onChange={(event) => setShowFullRequest(event.target.checked)}
              />
              Show Full Request
            </label>
          </div>
        </section>

        <section className="log-section">
          <PipelineLogger logs={logs} onClear={clearLogs} />
        </section>
      </main>
    </div>
  );
}

export default App;
