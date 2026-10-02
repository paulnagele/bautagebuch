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

function friendlyError(error) {
  if (error.code === '42501' || /row-level security/i.test(error.message)) {
    return 'You do not have access to this data. Ask the project owner to add your email address as a member.'
  }
  if (error.code === 'PGRST116') {
    return 'The entry no longer exists or you do not have access to it.'
  }
  if (/Failed to fetch|NetworkError/i.test(error.message)) {
    return 'Could not reach the server. Check your internet connection.'
  }
  return error.message
}
