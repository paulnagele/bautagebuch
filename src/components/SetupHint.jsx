import { useEffect, useState } from 'react'
import { onSettingChange, readSetting } from '../settings.js'

const REQUIRED = [
  { key: 'drive_folder_id', label: 'Drive-Ordner' },
  { key: 'calendar_id', label: 'Kalender' },
]

// A banner while the Drive folder or the calendar isn't set up yet, with a
// button to Einstellungen → Projekt.
function SetupHint({ onSetup }) {
  const [missing, setMissing] = useState([])

  useEffect(() => {
    let cancelled = false
    const check = () =>
      Promise.all(
        REQUIRED.map(({ key }) => readSetting(key).catch(() => '')), // load errors: no banner
      ).then((values) => {
        if (!cancelled) setMissing(REQUIRED.filter((_, i) => values[i] === null).map((r) => r.label))
      })
    check()
    const stop = onSettingChange(check)
    return () => {
      cancelled = true
      stop()
    }
  }, [])

  if (missing.length === 0) return null
  return (
    <div className="install-hint setup-hint" role="status">
      <span>Noch nicht eingerichtet: {missing.join(' und ')}.</span>
      <button type="button" onClick={() => onSetup('project')}>
        Jetzt einrichten
      </button>
    </div>
  )
}

export default SetupHint
