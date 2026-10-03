import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DialogContext } from '../dialogs.js'

// Shows one question or message at a time as a modal <dialog> (focus stays
// inside it, Escape cancels). Further requests wait their turn.
function DialogProvider({ children }) {
  const [queue, setQueue] = useState([])
  const current = queue[0] ?? null
  const dialogRef = useRef(null)

  const open = useCallback(
    (kind, message, options = {}) =>
      new Promise((resolve) => setQueue((q) => [...q, { kind, message, options, resolve }])),
    [],
  )
  const value = useMemo(
    () => ({
      confirm: (message, options) => open('confirm', message, options),
      alert: (message, options) => open('alert', message, options),
    }),
    [open],
  )

  useEffect(() => {
    const dialog = dialogRef.current
    if (current && dialog && !dialog.open) dialog.showModal()
  }, [current])

  function answer(result) {
    dialogRef.current?.close()
    current.resolve(current.kind === 'confirm' ? result : undefined)
    setQueue((q) => q.slice(1))
  }

  return (
    <DialogContext.Provider value={value}>
      {children}
      {current && (
        <dialog
          ref={dialogRef}
          className="app-dialog"
          role={current.kind === 'confirm' ? 'alertdialog' : 'dialog'}
          aria-labelledby="app-dialog-message"
          onCancel={(e) => {
            e.preventDefault()
            answer(false)
          }}
        >
          <p id="app-dialog-message">{current.message}</p>
          <div className="form-actions">
            {current.kind === 'confirm' ? (
              <>
                <button
                  type="button"
                  className={current.options.danger ? 'danger-button' : undefined}
                  onClick={() => answer(true)}
                  autoFocus
                >
                  {current.options.confirmLabel ?? 'OK'}
                </button>
                <button type="button" className="secondary" onClick={() => answer(false)}>
                  {current.options.cancelLabel ?? 'Abbrechen'}
                </button>
              </>
            ) : (
              <button type="button" onClick={() => answer(true)} autoFocus>
                OK
              </button>
            )}
          </div>
        </dialog>
      )}
    </DialogContext.Provider>
  )
}

export default DialogProvider
