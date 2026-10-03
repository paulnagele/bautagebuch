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

// Uploads the photos and files not yet in Drive, one after another, into
// the folder at folderPath. onProgress(n) runs before the n-th upload,
// onProgress(n, uploaded) after it, with the form's photos and files as
// far as they are uploaded.
export async function uploadPending({ photos, files, date }, folderPath, onProgress) {
  const uploaded = { photos: [...photos], files: [...files] }
  const jobs = [
    ...photos.map((item, index) => ({ item, index, list: 'photos' })),
    ...files.map((item, index) => ({ item, index, list: 'files' })),
  ].filter((job) => job.item.blob)
  // Progress by bytes, so one large photo on a slow connection still moves.
  const totalBytes = jobs.reduce((sum, job) => sum + job.item.blob.size, 0) || 1
  let doneBytes = 0
  for (const [n, { item, index, list }] of jobs.entries()) {
    const report = (loaded) =>
      onProgress({ current: n + 1, total: jobs.length, fraction: (doneBytes + loaded) / totalBytes })
    report(0)
    const folderId = await getEntryFolderId(folderPath)
    const { blob, ...rest } = item
    const fileId =
      list === 'photos'
        ? await uploadPhoto(blob, `${date} Bautagebuch ${newId()}${extension(blob)}`, folderId, report)
        : await uploadFile(blob, `${date} ${blob.name}`, folderId, report)
    doneBytes += blob.size
    uploaded[list] = uploaded[list].with(index, { ...rest, fileId })
    onProgress({ current: n + 1, total: jobs.length, fraction: doneBytes / totalBytes }, { ...uploaded })
  }
  return uploaded
}
