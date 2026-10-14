// An input shared by the Heizwärme tab's parts.

// A number input that keeps what is typed (also "" or "0,") and leaves
// parsing to the calculation.
export function NumberField({ label, value, onChange, unit, step = 'any', placeholder, min, hint }) {
  return (
    <label>
      <span>
        {label}
        {unit && <span className="muted"> ({unit})</span>}
      </span>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <small className="muted">{hint}</small>}
    </label>
  )
}
