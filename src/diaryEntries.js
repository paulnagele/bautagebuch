// How diary entries are stored in the database (`diary_entries`) and the
// shape the diary and the start page work with.
import { entryType } from './diaryTypes.js'

export function fromRow(row) {
  return {
    id: row.id,
    type: row.entry_type ?? 'status',
    date: row.entry_date,
    weather: row.weather,
    workers: row.workers ?? '',
    work: row.work,
    details: row.details ?? {},
    photoIds: row.photo_ids ?? [],
    files: row.files ?? [],
    author: row.author_name,
    createdAt: row.created_at,
  }
}

export function toRow(entry) {
  const siteInfo = entryType(entry.type).siteInfo
  return {
    entry_type: entry.type,
    entry_date: entry.date,
    weather: siteInfo ? entry.weather : '',
    workers: !siteInfo || entry.workers === '' ? null : Number(entry.workers),
    work: entry.work,
    details: entry.details,
    photo_ids: entry.photoIds,
    files: entry.files,
    updated_at: new Date().toISOString(),
  }
}
