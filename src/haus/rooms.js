// Rooms of the house model (model.rooms: { id, level, name, label: [x, z],
// area }) as plain names, for the Einrichtung tab. Nothing there keeps a
// link to the model: rooms are copied once by name, and a room is found
// in the model again only by its name, at the moment it is needed.

// Living floors first.
const LEVEL_ORDER = ['EG', 'DG', 'OG', 'KG']

function levelRank(level, levels) {
  const known = LEVEL_ORDER.indexOf(level)
  if (known >= 0) return known
  return LEVEL_ORDER.length + Math.max(0, levels.findIndex((l) => l.id === level))
}

const normal = (text) => String(text ?? '').trim().toLowerCase()

// Names as the Einrichtung tab shows them: a name used on several floors
// gets the floor added, e.g. "Bad (EG)" and "Bad (DG)".
export function modelRoomNames(model) {
  const rooms = (model?.rooms ?? []).filter((room) => String(room.name ?? '').trim())
  const levels = model?.levels ?? []
  const count = new Map()
  for (const room of rooms) count.set(normal(room.name), (count.get(normal(room.name)) ?? 0) + 1)
  const seen = new Set()
  const names = []
  const sorted = rooms
    .map((room, index) => ({ room, index }))
    .sort(
      (a, b) =>
        levelRank(a.room.level, levels) - levelRank(b.room.level, levels) || a.index - b.index,
    )
  for (const { room } of sorted) {
    const name = room.name.trim()
    const label = count.get(normal(name)) > 1 && room.level ? `${name} (${room.level})` : name
    if (seen.has(normal(label))) continue
    seen.add(normal(label))
    names.push({ name: label, level: room.level })
  }
  return names
}

// The model room a name stands for: the same name, or "Name (Geschoss)";
// null when the model has no such room (any more).
export function findModelRoom(model, name) {
  const rooms = model?.rooms ?? []
  const wanted = normal(name)
  if (!wanted) return null
  const exact = rooms.filter((room) => normal(room.name) === wanted)
  if (exact.length) return exact[0]
  const withLevel = /^(.*)\s+\(([^()]+)\)$/.exec(String(name).trim())
  if (!withLevel) return null
  const [, base, level] = withLevel
  return (
    rooms.find((room) => normal(room.name) === normal(base) && normal(room.level) === normal(level)) ??
    null
  )
}

// The room someone standing at (x, feet, z) is most likely in: the floor
// they stand on, then the nearest room label there. { name, level } with
// the name as modelRoomNames gives it, or null.
export function roomAt(model, x, feet, z) {
  const levels = model?.levels ?? []
  const below = levels
    .filter((level) => typeof level.floor === 'number' && level.floor <= feet + 0.4)
    .sort((a, b) => b.floor - a.floor)[0]
  if (!below) return null
  let best = null
  let bestDistance = Infinity
  for (const room of model.rooms ?? []) {
    if (room.level !== below.id || !Array.isArray(room.label)) continue
    const distance = Math.hypot(room.label[0] - x, room.label[1] - z)
    if (distance < bestDistance) {
      best = room
      bestDistance = distance
    }
  }
  if (!best || bestDistance > 8) return null
  const named = modelRoomNames(model).find(
    (entry) => entry.level === best.level && findModelRoom(model, entry.name) === best,
  )
  return named ?? { name: best.name.trim(), level: best.level }
}
