import { useEffect } from 'react'

// Covers the page while an entry is uploaded and saved. `progress` is
// { fraction } during uploads. Warns before the page is closed or
// reloaded, which would cancel the upload.
function BusyOverlay({ message, progress }) {
  useEffect(() => {
    const warn = (e) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  return (
    <div className="busy-overlay" role="alertdialog" aria-modal="true" aria-live="polite" aria-label={message}>
      <div className="busy-box">
        <span className="spinner busy-spinner" aria-hidden="true" />
        <p>{message}</p>
        {progress && (
          <div className="busy-bar" aria-hidden="true">
            <div style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
          </div>
        )}
        <p className="muted busy-note">Bitte die Seite nicht schließen.</p>
      </div>
    </div>
  )
}

export default BusyOverlay
