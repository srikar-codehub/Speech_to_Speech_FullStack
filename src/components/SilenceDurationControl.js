export default function SilenceDurationControl({
  value,
  min = 0.5,
  max = 5,
  step = 0.5,
  onChange,
  disabled = false,
  id = 'silence-duration-control',
}) {
  const numericValue = Number.isFinite(value) ? value : min;
  const formattedValue = numericValue.toFixed(1);

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
          value={numericValue}
          onChange={handleRangeChange}
          disabled={disabled}
          className="silence-control-slider"
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={numericValue}
          onChange={handleNumberChange}
          disabled={disabled}
          className="silence-control-number"
        />
      </div>
      <span className="silence-control-value">Current: {formattedValue}s</span>
    </div>
  );
}
