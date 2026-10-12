// The house model in the database (tables house_versions and
// house_context, see supabase/migrations/…_house_model.sql). Loaded only
// by the Haus tab: the list first (names and dates), a version's model
// when it is opened.
import { supabase } from '../supabase.js'
import { friendlyError } from '../useCollection.js'

const LIST_COLUMNS = 'id, name, note, parent_id, is_current, locked, created_at'

function failed(error) {
  return new Error(friendlyError(error))
}

// All versions, newest first, without their models.
export async function listVersions() {
  const { data, error } = await supabase
    .from('house_versions')
    .select(LIST_COLUMNS)
    .order('created_at', { ascending: false })
  if (error) throw failed(error)
  return data
}

export async function loadModel(id) {
  const { data, error } = await supabase.from('house_versions').select('model').eq('id', id).single()
  if (error) throw failed(error)
  return data.model
}

// The site data around the house, or null if there is none.
export async function loadContext() {
  const { data, error } = await supabase
    .from('house_context')
    .select('data')
    .eq('id', 'site')
    .maybeSingle()
  if (error) throw failed(error)
  return data?.data ?? null
}

export async function saveVersion({ name, note, parentId, model }) {
  const { data, error } = await supabase
    .from('house_versions')
    .insert({ name, note, parent_id: parentId ?? null, model })
    .select(LIST_COLUMNS)
    .single()
  if (error) throw failed(error)
  return data
}

export async function deleteVersion(id) {
  const { data, error } = await supabase.from('house_versions').delete().eq('id', id).select('id')
  if (error) throw failed(error)
  if (data.length === 0) throw new Error('Diese Version kann nicht gelöscht werden.')
}

export async function setCurrentVersion(id) {
  const { error } = await supabase.rpc('set_current_house_version', { version_id: id })
  if (error) throw failed(error)
}

// Reads the export file of the Haus3D page and checks its shape. Returns
// { versions, currentId, context }.
export async function readImportFile(file) {
  let data
  try {
    data = JSON.parse(await file.text())
  } catch {
    throw new Error('Die Datei ist keine gültige Haus3D-Exportdatei (kein JSON).')
  }
  const versions = data?.versions
  if (data?.format !== 'haus3d-export' || !Array.isArray(versions) || versions.length === 0) {
    throw new Error('Die Datei ist keine Haus3D-Exportdatei.')
  }
  for (const version of versions) {
    if (!version.id || !version.name || !version.model?.walls) {
      throw new Error(`Die Version „${version.name ?? version.id ?? '?'}“ in der Datei ist unvollständig.`)
    }
  }
  return data
}

// Writes the versions and the site data of an export file. Running it
// again with the same file changes nothing: rows are matched by id.
export async function importHouse({ versions, currentId, context }) {
  const ids = new Set(versions.map((version) => version.id))
  const rows = versions.map((version) => ({
    id: version.id,
    name: version.name,
    note: version.note ?? '',
    parent_id: ids.has(version.parent) ? version.parent : null,
    model: version.model,
    locked: Boolean(version.locked),
    created_at: version.createdAt ?? new Date().toISOString(),
  }))
  const { error } = await supabase.from('house_versions').upsert(rows)
  if (error) throw failed(error)
  if (context) {
    const { error: contextError } = await supabase
      .from('house_context')
      .upsert({ id: 'site', data: context, updated_at: new Date().toISOString() })
    if (contextError) throw failed(contextError)
  }
  await setCurrentVersion(ids.has(currentId) ? currentId : versions[0].id)
}
