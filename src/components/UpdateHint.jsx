import { useEffect, useState } from 'react'
import { watchForUpdates } from '../pwa.js'

// A banner when a newer version of the app was published while it was
// open, so it does not keep running old code against a newer database.
function UpdateHint() {
  const [available, setAvailable] = useState(false)

  useEffect(() => watchForUpdates(() => setAvailable(true)), [])

  if (!available) return null
  return (
    <div className="install-hint update-hint" role="status">
      <span>Eine neue Version des Bautagebuchs ist da.</span>
      <button type="button" onClick={() => window.location.reload()}>
        Neu laden
      </button>
    </div>
  )
}

export default UpdateHint
