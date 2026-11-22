// Where a diary entry's photos and files go in Google Drive (uploaded by
// uploadQueue.js).
import { entryType } from './diaryTypes.js'

// Drive folder of an entry's photos and files: <kind>/<creation date>,
// e.g. ['Mangel', '2026_10_02'] (created now for a new entry).
export function entryFolderPath(type, createdAt) {
  const created = createdAt ? new Date(createdAt) : new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const day = `${created.getFullYear()}_${pad(created.getMonth() + 1)}_${pad(created.getDate())}`
  return [entryType(type).label, day]
}
