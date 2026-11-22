// Uploading a diary entry's new photos and files to Google Drive.
import { entryType } from './diaryTypes.js'
import { getEntryFolderId, uploadFile, uploadPhoto } from './drive.js'
import { newId } from './storage.js'

// Keeps the original file type in the Drive file name (".jpg", ".heic", …).
function extension(file) {
  const match = /\.[a-z0-9]+$/i.exec(file.name ?? '')
  return match ? match[0].toLowerCase() : '.jpg'
}

// Drive folder of an entry's photos and files: <kind>/<creation date>,
// e.g. ['Mangel', '2026_10_02'] (created now for a new entry).
export function entryFolderPath(type, createdAt) {
  const created = createdAt ? new Date(createdAt) : new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const day = `${created.getFullYear()}_${pad(created.getMonth() + 1)}_${pad(created.getDate())}`
  return [entryType(type).label, day]
}

// How many uploads run at the same time. A few in parallel use the
// connection much better than one after another (each upload also has a
// round trip to open its Drive session), without starving each other.
export const PARALLEL_UPLOADS = 3

// Uploads the photos and files not yet in Drive into the folder at
// folderPath, a few at a time, in full size (the originals are kept in
// Drive, on purpose). onProgress(progress) reports how far it is;
// onProgress(progress, uploaded) runs after each finished upload, with the
// form's photos and files as far as they are uploaded, so a retry does not
// upload them twice.
export async function uploadPending({ photos, files, date }, folderPath, onProgress) {
  const uploaded = { photos: [...photos], files: [...files] }
  const jobs = [
    ...photos.map((item, index) => ({ item, index, list: 'photos' })),
    ...files.map((item, index) => ({ item, index, list: 'files' })),
  ].filter((job) => job.item.blob)
  if (jobs.length === 0) return uploaded
  // Progress by bytes, so one large photo on a slow connection still moves.
  const totalBytes = jobs.reduce((sum, job) => sum + job.item.blob.size, 0) || 1
  const share = jobs.map(() => 0)
  let finished = 0
  const report = (sofar) =>
    onProgress(
      {
        current: Math.min(finished + 1, jobs.length),
        total: jobs.length,
        fraction: share.reduce((a, b) => a + b, 0) / totalBytes,
      },
      sofar,
    )
  report()
  // The folder is looked up (or created) once for all uploads.
  const folderId = getEntryFolderId(folderPath)
  folderId.catch(() => {})
  let next = 0
  async function worker() {
    while (next < jobs.length) {
      const n = next++
      const { item, index, list } = jobs[n]
      const { blob, ...rest } = item
      const onBytes = (loaded) => {
        share[n] = Math.min(blob.size, loaded)
        report()
      }
      const fileId =
        list === 'photos'
          ? await uploadPhoto(blob, `${date} Bautagebuch ${newId()}${extension(blob)}`, await folderId, onBytes)
          : await uploadFile(blob, `${date} ${blob.name}`, await folderId, onBytes)
      share[n] = blob.size
      finished++
      uploaded[list] = uploaded[list].with(index, { ...rest, fileId })
      report({ ...uploaded })
    }
  }
  const workers = Array.from({ length: Math.min(PARALLEL_UPLOADS, jobs.length) }, worker)
  // If one upload fails, the others still finish (and are remembered)
  // before the error is shown.
  const results = await Promise.allSettled(workers)
  const failed = results.find((r) => r.status === 'rejected')
  if (failed) throw failed.reason
  return uploaded
}
