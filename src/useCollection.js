import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase.js'

// Loads all rows of a Supabase table and offers insert/update/remove.
// `fromRow` / `toRow` translate between database columns and the shape
// the UI works with; pass module-level functions so they stay stable.
// Changes made by other family members show up live: the hook listens
// to the table through Supabase Realtime and reloads when a row changes.
// It also reloads when the app comes back to the foreground, which
// catches anything missed while the phone was asleep or offline.
// Each hook instance gets its own channel, even for the same table.
let channelCount = 0

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

    // Several changes often arrive together (e.g. a category rename that
    // touches many transactions), so reload once after they settle.
    let timer
    const scheduleReload = () => {
      clearTimeout(timer)
      timer = setTimeout(reload, 300)
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload()
    }

    let subscribedBefore = false
    const channel = supabase
      .channel(`live:${table}:${++channelCount}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, scheduleReload)
      .subscribe((state) => {
        // After a dropped connection is restored, fetch what was missed.
        if (state === 'SUBSCRIBED') {
          if (subscribedBefore) scheduleReload()
          subscribedBefore = true
        }
      })

    window.addEventListener('focus', reload)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer)
      supabase.removeChannel(channel)
      window.removeEventListener('focus', reload)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [table, reload])

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
    return 'The database is not fully set up: signed-in users have no access to its tables. Apply the database migrations (GitHub → Actions → Apply Supabase migrations).'
  }
  if (error.code === '42501' || /row-level security/i.test(error.message)) {
    return 'You do not have access to this data. Ask the project owner to add your email address as a member.'
  }
  if (error.code === '23505') {
    return 'An entry with this name already exists.'
  }
  if (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    error.code === 'PGRST202' ||
    error.code === 'PGRST204'
  ) {
    return 'The database is missing a newer table or function. Apply the database migrations (GitHub → Actions → Apply Supabase migrations).'
  }
  if (error.code === 'PGRST116') {
    return 'The entry no longer exists or you do not have access to it.'
  }
  if (/Failed to fetch|NetworkError/i.test(error.message)) {
    return 'Could not reach the server. Check your internet connection.'
  }
  return error.message
}
