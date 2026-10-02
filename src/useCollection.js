import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase.js'

// Loads all rows of a Supabase table and offers insert/update/remove.
// `fromRow` / `toRow` translate between database columns and the shape
// the UI works with; pass module-level functions so they stay stable.
// Data is reloaded whenever the window regains focus, so changes made
// by other family members show up without a manual refresh.
export function useCollection(table, { fromRow, toRow }) {
  const [rows, setRows] = useState([])
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from(table)
      .select('*')
      .order('created_at', { ascending: true })
    if (loadError) {
      setError(friendlyError(loadError))
      setStatus('error')
      return
    }
    setRows(data.map(fromRow))
    setError('')
    setStatus('ready')
  }, [table, fromRow])

  useEffect(() => {
    // reload() only sets state after the request finishes, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload()
    window.addEventListener('focus', reload)
    return () => window.removeEventListener('focus', reload)
  }, [reload])

  async function insert(item) {
    const { data, error: insertError } = await supabase
      .from(table)
      .insert(toRow(item))
      .select()
      .single()
    if (insertError) throw new Error(friendlyError(insertError))
    setRows((current) => [...current, fromRow(data)])
  }

  async function update(id, item) {
    const { data, error: updateError } = await supabase
      .from(table)
      .update(toRow(item))
      .eq('id', id)
      .select()
      .single()
    if (updateError) throw new Error(friendlyError(updateError))
    setRows((current) => current.map((row) => (row.id === id ? fromRow(data) : row)))
  }

  async function remove(id) {
    const { error: deleteError } = await supabase.from(table).delete().eq('id', id)
    if (deleteError) throw new Error(friendlyError(deleteError))
    setRows((current) => current.filter((row) => row.id !== id))
  }

  return { rows, status, error, insert, update, remove, reload }
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
    return 'Die Kategorie wurde nicht gefunden.'
  }
  if (/Failed to fetch|NetworkError/i.test(error.message)) {
    return 'Der Server ist nicht erreichbar. Bitte die Internetverbindung prüfen.'
  }
  return error.message
}
