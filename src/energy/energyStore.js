// The saved heating demand calculation (table heat_demand, see
// supabase/migrations/…_heat_demand.sql): one JSON document, row 'main'.
import { supabase } from '../supabase.js'
import { friendlyError } from '../useCollection.js'

const ROW_ID = 'main'

// The saved calculation, or null if there is none yet.
export async function loadCalculation() {
  const { data, error } = await supabase.from('heat_demand').select('data').eq('id', ROW_ID).maybeSingle()
  if (error) throw new Error(friendlyError(error))
  return data?.data ?? null
}

export async function saveCalculation(data) {
  const { error } = await supabase
    .from('heat_demand')
    .upsert({ id: ROW_ID, data, updated_at: new Date().toISOString() })
  if (error) throw new Error(friendlyError(error))
}
