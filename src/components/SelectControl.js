export default function SelectControl({
  label,
  value,
  options,
  onChange,
  disabled = false,
  id,
}) {
  const resolvedId = id || `select-${label.replace(/\s+/g, '-').toLowerCase()}`;
  const normalizedOptions = Array.isArray(options)
    ? options.map((option) => {
        if (option && typeof option === 'object') {
          const optionValue =
            typeof option.value === 'undefined' ? option.code ?? option.name : option.value;
          return {
            value: `${optionValue ?? ''}`,
            label:
              typeof option.label === 'undefined'
                ? `${option.name ?? optionValue ?? ''}`
                : option.label,
            data: typeof option.data === 'undefined' ? option : option.data,
          };
        }
        return {
          value: `${option ?? ''}`,
          label: `${option ?? ''}`,
          data: option,
        };
      })
    : [];

  const handleChange = (event) => {
    if (onChange) {
      const selectedValue = event.target.value;
      const selectedOption = normalizedOptions.find(
        (option) => option.value === selectedValue
      );
      if (selectedOption) {
        onChange(selectedOption.data);
      } else {
        onChange(selectedValue);
      }
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
        value={value ?? ''}
        onChange={handleChange}
        disabled={disabled}
      >
        {normalizedOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
