export default function SilenceDurationControl({
  value,
  min = 0.5,
  max = 5,
  step = 0.5,
  onChange,
  disabled = false,
  id = 'silence-duration-control',
}) {
  const handleRangeChange = (event) => {
    if (onChange) {
      onChange(Number(event.target.value));
    }
  };

  const handleNumberChange = (event) => {
    if (!onChange) {
      return;
    }
    const next = Number(event.target.value);
    if (Number.isNaN(next)) {
      return;
    }
    onChange(next);
  };

  const formattedValue = Number.isFinite(value) ? value.toFixed(1) : '0.0';

  return (
    <div className="silence-control-card">
      <label className="silence-control-label" htmlFor={id}>
        Silence Duration (s):
      </label>
      <div className="silence-control-inputs">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleRangeChange}
          disabled={disabled}
          className="silence-control-slider"
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={Number(formattedValue)}
          onChange={handleNumberChange}
          disabled={disabled}
          className="silence-control-number"
        />
      </div>
      <span className="silence-control-value">
        {formattedValue}s <span aria-hidden="true">⚙️</span>
      </span>
    </div>
  );
}
