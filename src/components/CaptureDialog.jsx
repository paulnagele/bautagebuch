import { useEffect, useState } from 'react'
import { useCollection } from '../useCollection.js'
import { today } from '../storage.js'
import { driveAccess } from '../drive.js'
import { connectTogether } from '../google.js'
import {
  findRoomByName,
  itemFromRow,
  itemToRow,
  roomFromRow,
  roomToRow,
  sortRooms,
  uploadRoomPicture,
} from '../interior.js'
import DrivePhoto from './DrivePhoto.jsx'

// After "Aufnehmen" in Begehen (Haus tab): saves the picture as a card in
// an Einrichtung room. `shot` is what the viewer's onCapture gave
// ({ blob, spot, room, version }); `request` is set when the Einrichtung
// tab asked for the view ({ roomId, title }). The card keeps only plain
// numbers for the camera and the version's name as text, no link to the
// model.
function CaptureDialog({ user, shot, request, onSaved, onClose }) {
  const roomStore = useCollection('interior_rooms', { fromRow: roomFromRow, toRow: roomToRow })
  const itemStore = useCollection('interior_items', { fromRow: itemFromRow, toRow: itemToRow })
  const rooms = sortRooms(roomStore.rows)
  const [roomId, setRoomId] = useState('')
  const [title, setTitle] = useState(request?.title ?? '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // The room asked for, else the one the camera stands in, else the first.
  const suggested =
    rooms.find((room) => room.id === request?.roomId) ?? findRoomByName(rooms, shot.room) ?? rooms[0]
  const chosen = rooms.find((room) => room.id === roomId) ?? suggested

  useEffect(() => {
    const close = (e) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [busy, onClose])

  async function save(e) {
    e.preventDefault()
    if (!chosen) return
    setBusy(true)
    setError('')
    try {
      const [problem] = await connectTogether([driveAccess], user.email)
      if (problem) throw new Error(problem)
      const photoId = await uploadRoomPicture(chosen, shot.blob)
      await itemStore.insert({
        roomId: chosen.id,
        photoId,
        title,
        note,
        favorite: false,
        view: { ...shot.spot, version: shot.version, at: today() },
      })
      onSaved(chosen)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="interior-sheet capture-sheet" role="dialog" aria-modal="true" aria-label="Ansicht speichern">
      <form className="interior-sheet-box form-grid" onSubmit={save}>
        <h2>Ansicht für die Einrichtung</h2>
        <DrivePhoto blob={shot.blob} alt="Aufgenommene Ansicht" className="interior-sheet-img full" />
        {roomStore.status === 'loading' ? (
          <p className="full muted">Räume werden geladen…</p>
        ) : rooms.length === 0 ? (
          <p className="full muted">
            In der Einrichtung gibt es noch keine Räume. Lege sie dort zuerst an.
          </p>
        ) : (
          <>
            <label className="full">
              Raum
              <select value={chosen?.id ?? ''} onChange={(e) => setRoomId(e.target.value)}>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="full">
              Titel
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z. B. Blick zum Fenster" />
            </label>
            <label className="full">
              Notiz
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </>
        )}
        {error && (
          <p className="error full" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions full">
          <button type="submit" disabled={busy || !chosen}>
            {busy ? 'Wird gespeichert…' : 'Speichern'}
          </button>
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            Verwerfen
          </button>
        </div>
      </form>
    </div>
  )
}

export default CaptureDialog
