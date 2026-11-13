// Einrichtung tab: rooms (interior_rooms) and their pictures
// (interior_items). Pictures are stored in Google Drive under
// Haus/Einrichtung/<room folder>/, privately like the diary photos.
import { getEntryFolderId, uploadPhoto } from './drive.js'
import { newId, today } from './storage.js'

export function roomFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    folder: row.folder,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
  }
}

export function roomToRow(room) {
  const row = {}
  if (room.name !== undefined) row.name = room.name.trim()
  if (room.folder !== undefined) row.folder = room.folder
  if (room.sortOrder !== undefined) row.sort_order = room.sortOrder
  return row
}

export function itemFromRow(row) {
  return {
    id: row.id,
    roomId: row.room_id,
    photoId: row.photo_id,
    title: row.title ?? '',
    note: row.note ?? '',
    favorite: Boolean(row.favorite),
    view: row.view ?? null,
    createdAt: row.created_at,
  }
}

export function itemToRow(item) {
  const row = {}
  if (item.roomId !== undefined) row.room_id = item.roomId
  if (item.photoId !== undefined) row.photo_id = item.photoId
  if (item.title !== undefined) row.title = item.title.trim()
  if (item.note !== undefined) row.note = item.note.trim()
  if (item.favorite !== undefined) row.favorite = item.favorite
  if (item.view !== undefined) row.view = item.view
  return row
}

// Rooms in the order the members set (↑/↓), then by name.
export function sortRooms(rooms) {
  return [...rooms].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'de'),
  )
}

// A room's pictures: favourites first, then the newest first.
export function sortItems(items) {
  return [...items].sort(
    (a, b) =>
      Number(b.favorite) - Number(a.favorite) || String(b.createdAt).localeCompare(String(a.createdAt)),
  )
}

// The Drive folder name for a new room; "/" would read as a path.
export function folderName(name) {
  return name.trim().replace(/[\\/]+/g, '-')
}

export function findRoomByName(rooms, name) {
  const wanted = String(name ?? '').trim().toLowerCase()
  return wanted ? rooms.find((room) => room.name.trim().toLowerCase() === wanted) ?? null : null
}

function extension(blob) {
  const match = /\.[a-z0-9]+$/i.exec(blob.name ?? '')
  if (match) return match[0].toLowerCase()
  if (blob.type === 'image/png') return '.png'
  if (blob.type === 'image/webp') return '.webp'
  return '.jpg'
}

// Uploads one picture into the room's folder; resolves to the Drive file ID.
export async function uploadRoomPicture(room, blob, onBytes) {
  const folderId = await getEntryFolderId(['Einrichtung', room.folder])
  return uploadPhoto(blob, `${today()} Einrichtung ${newId()}${extension(blob)}`, folderId, onBytes)
}
