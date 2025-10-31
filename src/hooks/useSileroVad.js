import { useCallback, useEffect, useRef, useState } from 'react';
import createSileroVadEngine from '../vad/SileroVadEngine';

export default function useSileroVad() {
  const engineRef = useRef(null);
  const [status, setStatus] = useState('Loading model...');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const engine = createSileroVadEngine({
      onStatusChange: setStatus,
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
      if (engineRef.current) {
        engineRef.current.dispose();
        engineRef.current = null;
      }
    };
  }, []);

  const start = useCallback(() => {
    if (engineRef.current && ready) {
      engineRef.current.start();
    }
  }, [ready]);

  const stop = useCallback(() => {
    if (engineRef.current && ready) {
      engineRef.current.stop();
      setStatus('Listening...');
    }
  }, [ready]);

  return {
    status,
    start,
    stop,
    ready,
  };
}
