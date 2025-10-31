export default function MicrophoneSelector({
  devices,
  value,
  onChange,
  disabled = false,
  id = 'microphone-select',
}) {
  const handleChange = (event) => {
    if (onChange) {
      onChange(event.target.value);
    }
  };

  return (
    <div className="mic-control-card">
      <label className="mic-control-label" htmlFor={id}>
        Microphone:
      </label>
      <select
        id={id}
        className="mic-control-select"
        value={value}
        onChange={handleChange}
        disabled={disabled}
      >
        {devices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label}
          </option>
        ))}
      </select>
    </div>
  );
}
