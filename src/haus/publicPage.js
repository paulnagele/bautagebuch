// The shared house page (haus.html#k=<token>): one or more versions of
// the house model for people without a login. The token is the secret part of a
// share link made in the Haus tab ("Teilen"); the database function
// get_shared_house returns its versions as they are now (models included),
// with the site data, or nothing when the link was revoked.
import '../index.css'
import { createClient } from '@supabase/supabase-js'
import { config } from '../config.js'
import { mountViewer, showFailure } from './viewer.js'

const host = document.getElementById('host')
const msg = document.getElementById('msg')

function notice(text) {
  host.hidden = true
  msg.hidden = false
  msg.textContent = text
}

function tokenFromUrl() {
  return new URLSearchParams(window.location.hash.slice(1)).get('k') ?? ''
}

async function fetchShared(token) {
  // Its own client without a stored session: the page always asks as a visitor.
  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data, error } = await supabase.rpc('get_shared_house', { token })
  if (error) throw new Error(error.message)
  return data
}

// Remembered on this device once the GPU dropped the full view (same key as the Haus tab).
const LITE_KEY = 'haus3d-lite'

function readLite() {
  try {
    return localStorage.getItem(LITE_KEY) === '1'
  } catch {
    return false
  }
}

let dispose = null

function show(shared, lite) {
  dispose?.()
  dispose = null
  host.replaceChildren()
  const models = new Map(shared.versions.map((v) => [v.id, v.model]))
  const versions = shared.versions.map(({ id, name, note, created_at }) => ({ id, name, note, created_at }))
  host.hidden = false
  msg.hidden = true
  mountViewer(host, {
    model: shared.versions[0].model,
    context: shared.context,
    versions,
    currentId: versions[0].id,
    store: { load: async (id) => models.get(id) },
    readOnly: true,
    lite,
    onLost() {
      try {
        localStorage.setItem(LITE_KEY, '1')
      } catch {
        // Not remembered; light mode still applies until the page is reloaded.
      }
      show(shared, true)
    },
  })
    .then((done) => {
      dispose = done
    })
    .catch((error) => {
      console.error(error)
      showFailure(host, error)
    })
}

async function start() {
  const token = tokenFromUrl()
  if (!token) {
    notice('Dieser Link ist unvollständig. Bitte den ganzen Link öffnen, den du bekommen hast.')
    return
  }
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    notice('Die Seite ist nicht eingerichtet.')
    return
  }
  notice('Das Haus wird geladen…')
  let shared
  try {
    shared = await fetchShared(token)
  } catch (error) {
    console.error(error)
    notice('Das Haus konnte nicht geladen werden. Bitte später noch einmal versuchen.')
    return
  }
  if (!shared?.versions?.length) {
    notice('Dieser Link ist nicht mehr gültig.')
    return
  }
  document.title = shared.versions[0].model?.meta?.name || 'Haus'
  show(shared, readLite())
}

window.addEventListener('hashchange', start)
start()
