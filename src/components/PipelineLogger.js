import { useEffect, useRef } from 'react';

const TYPE_CLASS_MAP = {
  info: 'log-entry--info',
  success: 'log-entry--success',
  warning: 'log-entry--warning',
};

export default function PipelineLogger({ logs, onClear }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="log-panel">
      <div className="log-panel__header">
        <h2 className="log-panel__title">Pipeline Logs</h2>
        <button
          type="button"
          className="log-panel__clear"
          onClick={onClear}
          disabled={!logs || logs.length === 0}
        >
          Clear Logs
        </button>
      </div>
      <div className="log-panel__body" ref={containerRef}>
        {logs && logs.length > 0 ? (
          logs.map((entry) => {
            const typeClass = TYPE_CLASS_MAP[entry.type] || TYPE_CLASS_MAP.info;
            return (
              <div key={entry.id} className={`log-entry ${typeClass}`}>
                <span className="log-entry__timestamp">[{entry.time}]</span>
                <pre className="log-entry__message">{entry.message}</pre>
              </div>
            );
          })
        ) : (
          <div className="log-entry log-entry--empty">
            <pre className="log-entry__message">Logs will appear here during processing.</pre>
          </div>
        )}
      </div>
    </div>
  );
}
