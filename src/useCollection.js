import { useMemo, useSyncExternalStore } from 'react'
import { supabase } from './supabase.js'

// Loads all rows of a Supabase table and offers insert/update/remove.
// `fromRow` / `toRow` translate between database columns and the shape
// the UI works with; pass module-level functions so they stay stable.
//
// Each table is loaded once and shared by every tab that uses it, so
// switching tabs shows the data right away instead of loading it again.
// Changes made by other family members show up live: each table listens
// through Supabase Realtime and reloads when a row changes. It also
// reloads when the app comes back to the foreground, which catches
// anything missed while the phone was asleep or offline.

// Rows per request; Supabase returns at most 1000.
const PAGE_SIZE = 1000

// The primary key, for a stable order across pages ('id' unless named here).
const KEY_COLUMNS = { document_assignments: 'file_id' }

// Coming back to the app fires both "focus" and "visibilitychange";
// reloads closer together than this are skipped.
const FOREGROUND_GAP_MS = 2000

const stores = new Map()

// One shared store per table: the database rows as loaded, the load
// state, and who is listening. Created on first use, kept until sign-out.
function createStore(table) {
  let snapshot = { rows: [], status: 'loading', error: '' }
  let lastLoad = 0
  let timer
  const listeners = new Set()

  function set(next) {
    snapshot = { ...snapshot, ...next }
    listeners.forEach((listener) => listener())
  }

  async function reload() {
    lastLoad = Date.now()
    // Supabase returns at most 1000 rows per request, so larger tables are
    // loaded page by page; otherwise the newest rows would be missing.
    const data = []
    for (;;) {
      const { data: page, error } = await supabase
        .from(table)
        .select('*')
        .order('created_at', { ascending: true })
        .order(KEY_COLUMNS[table] ?? 'id', { ascending: true })
        .range(data.length, data.length + PAGE_SIZE - 1)
      if (error) {
        // Rows loaded before stay visible; the error says why they may be old.
        set({ error: friendlyError(error), status: 'error' })
        return
      }
      data.push(...page)
      if (page.length < PAGE_SIZE) break
    }
    set({ rows: data, error: '', status: 'ready' })
  }

  // Several changes often arrive together (e.g. a category rename that
  // touches many transactions), so reload once after they settle.
  function scheduleReload() {
    clearTimeout(timer)
    timer = setTimeout(reload, 300)
  }

  function onForeground() {
    if (document.visibilityState !== 'visible') return
    if (Date.now() - lastLoad < FOREGROUND_GAP_MS) return
    reload()
  }

  let subscribedBefore = false
  const channel = supabase
    .channel(`live:${table}`)
    .on('postgres_changes', { event: '*', schema: 'public', table }, scheduleReload)
    .subscribe((state) => {
      // After a dropped connection is restored, fetch what was missed.
      if (state === 'SUBSCRIBED') {
        if (subscribedBefore) scheduleReload()
        subscribedBefore = true
      }
    })
  window.addEventListener('focus', onForeground)
  document.addEventListener('visibilitychange', onForeground)
  reload()

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    reload,
    // Shows a saved change right away, before Realtime reports it.
    change(apply) {
      set({ rows: apply(snapshot.rows) })
    },
    close() {
      clearTimeout(timer)
      supabase.removeChannel(channel)
      window.removeEventListener('focus', onForeground)
      document.removeEventListener('visibilitychange', onForeground)
    },
  }
}

function storeFor(table) {
  if (!stores.has(table)) stores.set(table, createStore(table))
  return stores.get(table)
}

// Called on sign-out, so the next person starts with nothing loaded.
export function forgetCollections() {
  stores.forEach((store) => store.close())
  stores.clear()
}

export function useCollection(table, { fromRow, toRow }) {
  const store = storeFor(table)
  const { rows: raw, status, error } = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const rows = useMemo(() => raw.map(fromRow), [raw, fromRow])
  const key = KEY_COLUMNS[table] ?? 'id'

  async function insert(item) {
    const { data, error: insertError } = await supabase
      .from(table)
      .insert(toRow(item))
      .select()
      .single()
    if (insertError) throw new Error(friendlyError(insertError))
    store.change((current) => [...current.filter((row) => row[key] !== data[key]), data])
    return fromRow(data)
  }

  async function update(id, item) {
    const { data, error: updateError } = await supabase
      .from(table)
      .update(toRow(item))
      .eq('id', id)
      .select()
      .single()
    if (updateError) throw new Error(friendlyError(updateError))
    store.change((current) => current.map((row) => (row[key] === id ? data : row)))
    return fromRow(data)
  }

  async function remove(id) {
    const { error: deleteError } = await supabase.from(table).delete().eq('id', id)
    if (deleteError) throw new Error(friendlyError(deleteError))
    store.change((current) => current.filter((row) => row[key] !== id))
  }

  return { rows, status, error, insert, update, remove, reload: store.reload }
}

export function friendlyError(error) {
  // "permission denied for table …": the table lacks grants for signed-in
  // users, i.e. the database migrations have not all been applied.
  if (/permission denied for (table|function|schema)/i.test(error.message)) {
    return 'Die Datenbank ist nicht vollständig eingerichtet: Angemeldete Benutzer haben keinen Zugriff auf ihre Tabellen. Bitte die Datenbank-Migrationen ausführen (GitHub → Actions → Apply Supabase migrations).'
  }
  if (error.code === '42501' || /row-level security/i.test(error.message)) {
    return 'Du hast keinen Zugriff auf diese Daten. Bitte den Projektinhaber, deine E-Mail-Adresse als Mitglied hinzuzufügen.'
  }
  if (error.code === '23505') {
    return 'Ein Eintrag mit diesem Namen existiert bereits.'
  }
  if (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    error.code === 'PGRST202' ||
    error.code === 'PGRST204'
  ) {
    return 'In der Datenbank fehlt eine neuere Tabelle oder Funktion. Bitte die Datenbank-Migrationen ausführen (GitHub → Actions → Apply Supabase migrations).'
  }
  if (error.code === 'PGRST116') {
    return 'Der Eintrag existiert nicht mehr oder du hast keinen Zugriff darauf.'
  }
  if (error.code === 'P0002') {
    return /category/i.test(error.message)
      ? 'Die Kategorie wurde nicht gefunden.'
      : 'Der Eintrag existiert nicht mehr.'
  }
  if (/Failed to fetch|NetworkError/i.test(error.message)) {
    return 'Der Server ist nicht erreichbar. Bitte die Internetverbindung prüfen.'
  }
  return error.message
}
