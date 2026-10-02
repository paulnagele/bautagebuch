// App settings kept in the database (app_settings), e.g. the Drive folder
// and the calendar ID. Only signed-in members can read them, so they are
// not in the repository or the public site. Each is loaded once.
import { supabase } from './supabase.js'

const requests = new Map()

// `label` names the setting in error messages, e.g. "der Drive-Ordner".
export function getSetting(key, label) {
  if (!requests.has(key)) {
    const request = supabase
      .from('app_settings')
      .select('value')
      .eq('key', key)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) throw new Error(`Die Einstellung für ${label} konnte nicht geladen werden: ${error.message}`)
        if (!data) throw new Error(`${label[0].toUpperCase()}${label.slice(1)} ist noch nicht eingerichtet (siehe README, app_settings).`)
        return data.value
      })
    request.catch(() => requests.delete(key))
    requests.set(key, request)
  }
  return requests.get(key)
}

// Called on sign-out.
export function forgetSettings() {
  requests.clear()
}
