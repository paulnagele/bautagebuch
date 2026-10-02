import { useEffect, useState } from 'react'
import { usePersistentState } from '../storage.js'
import {
  getInstallPrompt,
  isInstalled,
  isIos,
  onInstallPromptChange,
  promptInstall,
} from '../pwa.js'

// A small banner offering to put the app on the home screen. Shown when
// the browser can install it (Android/Chrome) or on iPhone/iPad, until
// it's installed or dismissed.
function InstallHint() {
  const [dismissed, setDismissed] = usePersistentState(
    'bautagebuch.installHintDismissed',
    false,
  )
  const [canPrompt, setCanPrompt] = useState(() => getInstallPrompt() !== null)

  useEffect(
    () => onInstallPromptChange(() => setCanPrompt(getInstallPrompt() !== null)),
    [],
  )

  if (dismissed || isInstalled()) return null
  if (!canPrompt && !isIos()) return null

  return (
    <div className="install-hint" role="note">
      {canPrompt ? (
        <>
          <span>Installiere das Bautagebuch als App auf deinem Startbildschirm.</span>
          <button type="button" onClick={promptInstall}>
            App installieren
          </button>
        </>
      ) : (
        <span>
          Als App nutzen: Tippe in Safari auf <strong>Teilen</strong> und dann auf{' '}
          <strong>Zum Home-Bildschirm</strong>.
        </span>
      )}
      <button
        type="button"
        className="link"
        onClick={() => setDismissed(true)}
        aria-label="Hinweis schließen"
      >
        ✕
      </button>
    </div>
  )
}

export default InstallHint
