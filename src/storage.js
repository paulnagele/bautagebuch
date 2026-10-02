import { useEffect, useState } from 'react'

// Data is kept in the browser's localStorage until a backend exists.
// Storage can be unavailable (private mode, blocked site data), so every
// access is guarded and the app keeps working in memory.

export function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function saveJSON(key, value) {
  try {
    if (value === null || value === undefined) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, JSON.stringify(value))
    }
  } catch {
    // Ignore: data stays in memory for this session.
  }
}

export function usePersistentState(key, initialValue) {
  const [value, setValue] = useState(() => loadJSON(key, initialValue))

  useEffect(() => {
    saveJSON(key, value)
  }, [key, value])

  return [value, setValue]
}

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export function today() {
  const d = new Date()
  const offset = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - offset).toISOString().slice(0, 10)
}

export function formatDate(isoDate) {
  if (!isoDate) return ''
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
