import { createContext, useContext } from 'react'

// In-app replacements for window.confirm and window.alert, shown by
// components/DialogProvider.jsx. Both return a promise:
//   const { confirm, alert } = useDialogs()
//   if (!(await confirm('Löschen?', { confirmLabel: 'Löschen', danger: true }))) return
//   await alert('Etwas ist schiefgelaufen.')
export const DialogContext = createContext(null)

// Outside a provider (e.g. in a test), fall back to the browser's dialogs.
const browserDialogs = {
  confirm: (message) => Promise.resolve(window.confirm(message)),
  alert: (message) => Promise.resolve(window.alert(message)),
}

export function useDialogs() {
  return useContext(DialogContext) ?? browserDialogs
}
