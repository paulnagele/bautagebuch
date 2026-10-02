// Diary photos are kept in IndexedDB: localStorage is limited to a few MB
// and only stores strings, which is not enough for images.

const DB_NAME = 'bautagebuch'
const STORE = 'images'
const MAX_SIZE = 1600 // longest edge in px after resizing
const QUALITY = 0.82

let dbPromise = null

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(STORE)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    dbPromise.catch(() => {
      dbPromise = null
    })
  }
  return dbPromise
}

async function run(mode, action) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const request = action(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(request.result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export function putImage(id, blob) {
  return run('readwrite', (store) => store.put(blob, id))
}

export function getImage(id) {
  return run('readonly', (store) => store.get(id))
}

export function deleteImage(id) {
  return run('readwrite', (store) => store.delete(id))
}

// Downscale large photos (phone cameras produce 5–10 MB files) to a JPEG
// that is big enough to read details on but small enough to store.
export async function compressImage(file) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIZE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff' // transparent PNGs would otherwise turn black
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not process image.'))),
      'image/jpeg',
      QUALITY,
    )
  })
}
