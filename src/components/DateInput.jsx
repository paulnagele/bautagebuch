import { useEffect, useRef, useState } from 'react'
import { formatDate } from '../storage.js'

// A date field that shows and takes DD.MM.YYYY whatever the browser's
// language, with a calendar button for the device's own date picker.
// The value is an ISO date (YYYY-MM-DD) or ''; like a native input,
// onChange gets { target: { value } }. While a date is half typed the
// value stays as it was.

// Puts dots between day, month and year as they are typed, so the
// number pad is enough ("07102026" → "07.10.2026"). Commas, slashes,
// dashes and spaces count as dots.
function shapeTyping(raw, growing) {
  const parts = ['']
  for (const char of raw) {
    const part = parts.length - 1
    const limit = part === 2 ? 4 : 2
    if (/\d/.test(char)) {
      if (parts[part].length === limit) {
        if (part === 2) continue
        parts.push('')
      }
      parts[parts.length - 1] += char
    } else if (/[.,/\- ]/.test(char) && parts[part] && part < 2) {
      parts.push('')
    }
  }
  let text = parts.join('.')
  const last = parts.length - 1
  if (growing && last < 2 && parts[last].length === 2) text += '.'
  return text
}

// The ISO date for "D.M.YYYY" (or "D.M.YY" once typing is done), or null.
function parseDate(text, finished) {
  const match = text.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})$/)
  if (!match) return null
  const [, d, m, y] = match
  if (y.length === 2 && !finished) return null
  const year = y.length === 2 ? 2000 + Number(y) : Number(y)
  const date = new Date(Date.UTC(year, m - 1, d))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== Number(d)) {
    return null
  }
  return date.toISOString().slice(0, 10)
}

function DateInput({ value, onChange, min, max, ...rest }) {
  const [text, setText] = useState(() => formatDate(value))
  // The value this field last showed or sent, to tell the parent's
  // changes from the ones typed here.
  const shown = useRef(value)

  useEffect(() => {
    if (value !== shown.current) {
      shown.current = value
      setText(formatDate(value))
    }
  }, [value])

  function send(next) {
    shown.current = next
    if (next !== value) onChange({ target: { value: next } })
  }

  function type(e) {
    const raw = e.target.value
    const next = shapeTyping(raw, raw.length > text.length)
    setText(next)
    if (!next) send('')
    else {
      const iso = parseDate(next, false)
      if (iso) send(iso)
    }
  }

  // On leaving the field: tidy a typed date, or put back the last one.
  function finish() {
    const iso = text ? parseDate(text, true) : ''
    if (iso === null) {
      setText(formatDate(value))
      return
    }
    setText(formatDate(iso))
    send(iso)
  }

  function pick(e) {
    setText(formatDate(e.target.value))
    send(e.target.value)
  }

  function openPicker(e) {
    try {
      e.currentTarget.showPicker()
    } catch {
      // Older browsers open it on their own when the field is tapped.
    }
  }

  return (
    <span className="date-input">
      <input
        {...rest}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="TT.MM.JJJJ"
        value={text}
        onChange={type}
        onBlur={finish}
      />
      <span className="date-input-picker" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
        <input type="date" tabIndex={-1} value={value} min={min} max={max} onChange={pick} onClick={openPicker} />
      </span>
    </span>
  )
}

export default DateInput
