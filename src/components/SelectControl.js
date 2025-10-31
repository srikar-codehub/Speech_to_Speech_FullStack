export default function SelectControl({
  label,
  value,
  options,
  onChange,
  disabled = false,
  id,
}) {
  const resolvedId = id || `select-${label.replace(/\s+/g, '-').toLowerCase()}`;

  const handleChange = (event) => {
    if (onChange) {
      onChange(event.target.value);
    }
  };

  return (
    <div className="select-control-card">
      <label className="select-control-label" htmlFor={resolvedId}>
        {label}
      </label>
      <select
        id={resolvedId}
        className="select-control-select"
        value={value}
        onChange={handleChange}
        disabled={disabled}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}
