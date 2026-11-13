// App settings kept in the database (app_settings), e.g. the Drive folder
// and the calendar ID. Only signed-in members can read them, so they are
// not in the repository or the public site. Each is loaded once; members
// change them in Einstellungen (pages/Settings.jsx).
import { supabase } from './supabase.js'

const requests = new Map()
const listeners = new Set()

// The value, or null when the setting isn't set up.
export function readSetting(key) {
  if (!requests.has(key)) {
    const request = supabase
      .from('app_settings')
      .select('value')
      .eq('key', key)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) throw new Error(`Die Einstellung konnte nicht geladen werden: ${error.message}`)
        return data?.value ?? null
      })
    request.catch(() => requests.delete(key))
    requests.set(key, request)
  }
  return requests.get(key)
}

// Like readSetting, but a missing setting is an error.
// `label` names the setting in the message, e.g. "der Drive-Ordner".
export async function getSetting(key, label) {
  const value = await readSetting(key)
  if (value === null) {
    const error = new Error(
      `${label[0].toUpperCase()}${label.slice(1)} ist noch nicht eingerichtet (Einstellungen → Projekt).`,
    )
    error.setupKey = key
    throw error
  }
  return value
}

// Saves a setting for everyone; an empty value removes it.
export async function saveSetting(key, value) {
  const clean = (value ?? '').trim()
  const { error } = await supabase.rpc('set_app_setting', {
    setting_key: key,
    setting_value: clean,
  })
  if (error) throw new Error(error.message)
  requests.set(key, Promise.resolve(clean || null))
  listeners.forEach((listener) => listener(key))
}

// Runs listener(key) after a setting was changed here; returns an unsubscribe.
export function onSettingChange(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Called on sign-out.
export function forgetSettings() {
  requests.clear()
}
