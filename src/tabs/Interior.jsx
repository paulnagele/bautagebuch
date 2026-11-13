import { useCallback, useEffect, useRef, useState } from 'react'
import { friendlyError, useCollection } from '../useCollection.js'
import { supabase } from '../supabase.js'
import { formatDate, newId, usePersistentState } from '../storage.js'
import { driveAccess } from '../drive.js'
import { connectTogether } from '../google.js'
import { useDialogs } from '../dialogs.js'
import { listVersions, loadModel } from '../haus/houseStore.js'
import { modelRoomNames } from '../haus/rooms.js'
import {
  folderName,
  itemFromRow,
  itemToRow,
  roomFromRow,
  roomToRow,
  sortItems,
  sortRooms,
  uploadRoomPicture,
} from '../interior.js'
import DrivePhoto from '../components/DrivePhoto.jsx'
import Lightbox from '../components/Lightbox.jsx'
import BusyOverlay from '../components/BusyOverlay.jsx'

// Einrichtung: a mood board per room. Pictures of things the members want
// in a room (photos, screenshots, renders of the house model), each with
// a title, a note and a favourite star.
//   inbox          pictures shared to the app ("Teilen → Bautagebuch"),
//                  waiting for a room; onInboxTaken() once they are placed
//   focusRoomId    opens this room's board (after a render was saved)
//   onOpenHouse    opens the Haus tab walking in a room, to render it
function Interior({ user, inbox, onInboxTaken, focusRoomId, onFocused, onOpenHouse }) {
  const roomStore = useCollection('interior_rooms', { fromRow: roomFromRow, toRow: roomToRow })
  const itemStore = useCollection('interior_items', { fromRow: itemFromRow, toRow: itemToRow })
  const [openRoomId, setOpenRoomId] = usePersistentState('interior.room', null)
  // Pictures picked or shared for a room, not uploaded yet: { roomId, files: [{ key, blob }] }
  const [tray, setTray] = useState(null)

  useEffect(() => {
    if (!focusRoomId) return
    setOpenRoomId(focusRoomId)
    onFocused?.()
  }, [focusRoomId, onFocused, setOpenRoomId])

  const rooms = sortRooms(roomStore.rows)
  const openRoom = rooms.find((room) => room.id === openRoomId) ?? null
  const loadError = [roomStore, itemStore].find((store) => store.status === 'error')?.error

  function placeInbox(roomId) {
    setTray({ roomId, files: inbox.files.map((blob) => ({ key: newId(), blob })) })
    setOpenRoomId(roomId)
    onInboxTaken()
  }

  if (roomStore.status === 'loading') return <p className="empty">Wird geladen…</p>

  return (
    <section className="tab-content interior">
      {loadError && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}
      {inbox && (
        <div className="card interior-inbox">
          <h2>
            {inbox.files.length === 1 ? 'Geteiltes Bild' : `${inbox.files.length} geteilte Bilder`}
          </h2>
          <p className="muted">In welchen Raum?</p>
          {rooms.length === 0 ? (
            <p className="muted">Lege zuerst unten einen Raum an.</p>
          ) : (
            <div className="interior-room-picks">
              {rooms.map((room) => (
                <button key={room.id} type="button" className="secondary" onClick={() => placeInbox(room.id)}>
                  {room.name}
                </button>
              ))}
            </div>
          )}
          <div className="form-actions">
            <button type="button" className="link" onClick={onInboxTaken}>
              Verwerfen
            </button>
          </div>
        </div>
      )}
      {openRoom ? (
        <RoomBoard
          user={user}
          room={openRoom}
          rooms={rooms}
          itemStore={itemStore}
          tray={tray?.roomId === openRoom.id ? tray : null}
          setTray={setTray}
          onBack={() => setOpenRoomId(null)}
          onOpenHouse={onOpenHouse}
        />
      ) : rooms.length === 0 && roomStore.status === 'ready' ? (
        <FirstRooms roomStore={roomStore} />
      ) : (
        <RoomList rooms={rooms} items={itemStore.rows} roomStore={roomStore} onOpen={setOpenRoomId} />
      )}
    </section>
  )
}

// ---- no rooms yet: take the room names from the house model once -----------

function FirstRooms({ roomStore }) {
  const [names, setNames] = useState(null) // [{ name, level, chosen }] or [] without a model
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const versions = await listVersions()
        const current = versions.find((v) => v.is_current) ?? versions[0]
        const model = current ? await loadModel(current.id) : null
        if (!cancelled) setNames(modelRoomNames(model).map((room) => ({ ...room, chosen: true })))
      } catch {
        if (!cancelled) setNames([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function take() {
    setBusy(true)
    setError('')
    try {
      // All in one request, so a failure leaves no half list.
      const rows = names
        .filter((room) => room.chosen)
        .map((room, index) => roomToRow({ name: room.name, folder: folderName(room.name), sortOrder: index }))
      const { error: insertError } = await supabase.from('interior_rooms').insert(rows)
      if (insertError) throw new Error(friendlyError(insertError))
      await roomStore.reload()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  if (names === null) return <p className="empty">Räume aus dem Hausmodell werden gelesen…</p>
  if (names.length === 0) {
    return (
      <>
        <p className="empty">Noch keine Räume. Lege den ersten an.</p>
        <AddRoom roomStore={roomStore} />
      </>
    )
  }
  const count = names.filter((room) => room.chosen).length
  return (
    <div className="card form-grid">
      <h2>Räume aus dem Hausmodell übernehmen</h2>
      <p className="full muted">
        Die Räume werden einmal kopiert. Danach ist die Liste nur hier: Änderungen am Modell
        ändern sie nicht.
      </p>
      <ul className="full interior-seed">
        {names.map((room, index) => (
          <li key={room.name}>
            <label>
              <input
                type="checkbox"
                checked={room.chosen}
                onChange={(e) =>
                  setNames(names.with(index, { ...room, chosen: e.target.checked }))
                }
              />
              {room.name}
              {room.level && <span className="muted"> · {room.level}</span>}
            </label>
          </li>
        ))}
      </ul>
      {error && (
        <p className="error full" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions full">
        <button type="button" onClick={take} disabled={busy || count === 0}>
          {busy ? 'Wird übernommen…' : `${count} Räume übernehmen`}
        </button>
        <button type="button" className="secondary" onClick={() => setNames([])} disabled={busy}>
          Selbst anlegen
        </button>
      </div>
    </div>
  )
}

function AddRoom({ roomStore, nextOrder = 0 }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  async function add(e) {
    e.preventDefault()
    const value = name.trim()
    if (!value) return
    setError('')
    try {
      await roomStore.insert({ name: value, folder: folderName(value), sortOrder: nextOrder })
      setName('')
    } catch (err) {
      setError(err.message)
    }
  }
  return (
    <form className="interior-add-room" onSubmit={add}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Neuer Raum, z. B. Garten"
        aria-label="Name des neuen Raums"
      />
      <button type="submit" disabled={!name.trim()}>
        Hinzufügen
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}

// ---- the list of rooms -------------------------------------------------------

function RoomList({ rooms, items, roomStore, onOpen }) {
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const { confirm } = useDialogs()

  const byRoom = new Map(rooms.map((room) => [room.id, []]))
  for (const item of items) byRoom.get(item.roomId)?.push(item)

  async function run(task) {
    setError('')
    try {
      await task()
    } catch (err) {
      setError(err.message)
    }
  }

  // ↑/↓: numbers the rooms 0, 1, 2, … in the new order and saves the changed ones.
  function move(index, step) {
    const next = [...rooms]
    const [room] = next.splice(index, 1)
    next.splice(index + step, 0, room)
    run(async () => {
      for (const [order, r] of next.entries()) {
        if (r.sortOrder !== order) await roomStore.update(r.id, { sortOrder: order })
      }
    })
  }

  function rename(room, value) {
    const name = value.trim()
    if (!name || name === room.name) return
    run(() => roomStore.update(room.id, { name }))
  }

  async function removeRoom(room) {
    const count = byRoom.get(room.id).length
    const ok = await confirm(
      count
        ? `„${room.name}“ mit ${count === 1 ? 'einem Bild' : `${count} Bildern`} löschen? Die Bilder bleiben in Google Drive.`
        : `„${room.name}“ löschen?`,
      { confirmLabel: 'Löschen', danger: true },
    )
    if (ok) run(() => roomStore.remove(room.id))
  }

  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {editing ? (
        <div className="card interior-edit">
          <ul>
            {rooms.map((room, index) => (
              <li key={room.id}>
                <input
                  defaultValue={room.name}
                  aria-label={`Name von ${room.name}`}
                  onBlur={(e) => rename(room, e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                />
                <button type="button" className="secondary" aria-label="Nach oben" disabled={index === 0} onClick={() => move(index, -1)}>
                  ↑
                </button>
                <button type="button" className="secondary" aria-label="Nach unten" disabled={index === rooms.length - 1} onClick={() => move(index, 1)}>
                  ↓
                </button>
                <button type="button" className="link danger" onClick={() => removeRoom(room)}>
                  Löschen
                </button>
              </li>
            ))}
          </ul>
          <AddRoom roomStore={roomStore} nextOrder={rooms.length} />
          <p className="muted interior-hint">
            Umbenennen ändert nur den Namen hier; die Bilder bleiben in ihrem Drive-Ordner.
          </p>
          <div className="form-actions">
            <button type="button" onClick={() => setEditing(false)}>
              Fertig
            </button>
          </div>
        </div>
      ) : (
        <>
          <ul className="interior-rooms">
            {rooms.map((room) => {
              const roomItems = sortItems(byRoom.get(room.id))
              const cover = roomItems[0]
              return (
                <li key={room.id}>
                  <button type="button" className="interior-room" onClick={() => onOpen(room.id)}>
                    {cover ? (
                      <DrivePhoto fileId={cover.photoId} alt="" className="interior-cover" />
                    ) : (
                      <span className="interior-cover interior-cover-empty" aria-hidden="true">
                        +
                      </span>
                    )}
                    <span className="interior-room-name">{room.name}</span>
                    <span className="interior-room-count muted">
                      {roomItems.length === 0
                        ? 'leer'
                        : roomItems.length === 1
                          ? '1 Bild'
                          : `${roomItems.length} Bilder`}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="form-actions">
            <button type="button" className="secondary" onClick={() => setEditing(true)}>
              Räume bearbeiten
            </button>
          </div>
        </>
      )}
    </>
  )
}

// ---- one room's board -----------------------------------------------------------

function RoomBoard({ user, room, rooms, itemStore, tray, setTray, onBack, onOpenHouse }) {
  const items = sortItems(itemStore.rows.filter((item) => item.roomId === room.id))
  const [openItemId, setOpenItemId] = useState(null)
  const [busy, setBusy] = useState('')
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState('')
  const openItem = items.find((item) => item.id === openItemId) ?? null
  const galleryInput = useRef(null)
  const cameraInput = useRef(null)

  function addFiles(fileList) {
    const files = [...fileList].filter((file) => file.type.startsWith('image/'))
    if (!files.length) return
    setTray((current) => ({
      roomId: room.id,
      files: [
        ...(current?.roomId === room.id ? current.files : []),
        ...files.map((blob) => ({ key: newId(), blob })),
      ],
    }))
  }

  async function upload() {
    const files = tray.files
    setError('')
    const [problem] = await connectTogether([driveAccess], user.email)
    if (problem) {
      setError(problem)
      return
    }
    const total = files.reduce((sum, f) => sum + f.blob.size, 0) || 1
    let done = 0
    try {
      for (const [n, file] of files.entries()) {
        setBusy(files.length === 1 ? 'Wird hochgeladen…' : `Bild ${n + 1} von ${files.length} wird hochgeladen…`)
        setProgress({ fraction: done / total })
        const photoId = await uploadRoomPicture(room, file.blob, (loaded) =>
          setProgress({ fraction: (done + loaded) / total }),
        )
        done += file.blob.size
        await itemStore.insert({ roomId: room.id, photoId, title: '', note: '', favorite: false })
        // Uploaded ones leave the tray, so a retry does not add them twice.
        setTray((current) => (current ? { ...current, files: current.files.filter((f) => f.key !== file.key) } : current))
      }
      setTray(null)
    } catch (err) {
      setError(`Upload fehlgeschlagen: ${err.message}`)
    } finally {
      setBusy('')
      setProgress(null)
    }
  }

  async function toggleFavorite(item) {
    setError('')
    try {
      await itemStore.update(item.id, { favorite: !item.favorite })
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      <div className="interior-board-head">
        <button type="button" className="link" onClick={onBack}>
          ← Räume
        </button>
        <h2>{room.name}</h2>
      </div>
      <div className="interior-actions">
        <button type="button" onClick={() => galleryInput.current.click()}>
          + Bilder
        </button>
        <button type="button" className="secondary" onClick={() => cameraInput.current.click()}>
          Kamera
        </button>
        <input ref={galleryInput} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
        <button type="button" className="secondary" onClick={() => onOpenHouse({ roomId: room.id, room: room.name })}>
          Ansicht aus Modell
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {tray && tray.files.length > 0 && (
        <div className="card interior-tray">
          <ul className="thumb-grid">
            {tray.files.map((file) => (
              <li key={file.key} className="thumb">
                <DrivePhoto blob={file.blob} alt="" className="thumb-img" />
                <button
                  type="button"
                  className="thumb-remove"
                  aria-label="Entfernen"
                  onClick={() => setTray({ ...tray, files: tray.files.filter((f) => f.key !== file.key) })}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div className="form-actions">
            <button type="button" onClick={upload}>
              {tray.files.length === 1 ? 'Bild speichern' : `${tray.files.length} Bilder speichern`}
            </button>
            <button type="button" className="secondary" onClick={() => setTray(null)}>
              Verwerfen
            </button>
          </div>
        </div>
      )}
      {items.length === 0 && !tray?.files.length ? (
        <p className="empty">
          Noch keine Bilder. Füge Fotos oder Screenshots hinzu, teile sie aus einer anderen App
          („Teilen → Bautagebuch“) oder nimm eine Ansicht aus dem Hausmodell auf.
        </p>
      ) : (
        <ul className="interior-grid">
          {items.map((item) => (
            <li key={item.id} className="interior-item">
              <button type="button" className="interior-item-open" onClick={() => setOpenItemId(item.id)}>
                <DrivePhoto fileId={item.photoId} alt={item.title} className="interior-item-img" />
                {(item.title || item.view) && (
                  <span className="interior-item-title">{item.title || 'Ansicht aus Modell'}</span>
                )}
              </button>
              <button
                type="button"
                className={item.favorite ? 'interior-star on' : 'interior-star'}
                aria-pressed={item.favorite}
                aria-label={item.favorite ? 'Kein Favorit mehr' : 'Als Favorit markieren'}
                onClick={() => toggleFavorite(item)}
              >
                {item.favorite ? '★' : '☆'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {openItem && (
        <ItemDialog
          item={openItem}
          rooms={rooms}
          itemStore={itemStore}
          onClose={() => setOpenItemId(null)}
          onRender={() =>
            onOpenHouse({ roomId: room.id, room: room.name, spot: openItem.view, title: openItem.title })
          }
        />
      )}
      {busy && <BusyOverlay message={busy} progress={progress} />}
    </>
  )
}

// ---- one picture, big, with its title, note and star ------------------------

function ItemDialog({ item, rooms, itemStore, onClose, onRender }) {
  const [title, setTitle] = useState(item.title)
  const [note, setNote] = useState(item.note)
  const [favorite, setFavorite] = useState(item.favorite)
  const [roomId, setRoomId] = useState(item.roomId)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const closeLightbox = useCallback(() => setLightbox(null), [])
  const { confirm } = useDialogs()

  useEffect(() => {
    const close = (e) => e.key === 'Escape' && !lightbox && onClose()
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose, lightbox])

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await itemStore.update(item.id, { title, note, favorite, roomId })
      onClose()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  async function remove() {
    if (!(await confirm('Dieses Bild löschen? Die Datei bleibt in Google Drive.', { confirmLabel: 'Löschen', danger: true }))) return
    try {
      await itemStore.remove(item.id)
      onClose()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="interior-sheet" role="dialog" aria-modal="true" aria-label={item.title || 'Bild'}>
      <form className="interior-sheet-box form-grid" onSubmit={save}>
        <DrivePhoto fileId={item.photoId} alt={item.title} className="interior-sheet-img full" onOpen={setLightbox} />
        {item.view && (
          <p className="full muted interior-hint">
            Ansicht aus dem Hausmodell{item.view.version ? ` („${item.view.version}“` : ''}
            {item.view.version && item.view.at ? `, ${formatDate(item.view.at)})` : item.view.version ? ')' : ''}
          </p>
        )}
        <label className="full">
          Titel
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z. B. Hängeleuchte Esstisch" />
        </label>
        <label className="full">
          Notiz
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <label className="interior-fav">
          <input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} />
          ★ Favorit
        </label>
        {rooms.length > 1 && (
          <label>
            Raum
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && (
          <p className="error full" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions full interior-sheet-actions">
          <button type="submit" disabled={saving}>
            Speichern
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            Abbrechen
          </button>
          {item.view && (
            <button type="button" className="secondary" onClick={onRender} title="Dieselbe Ansicht aus der aktuellen Hausversion">
              Neu rendern
            </button>
          )}
          <button type="button" className="link danger" onClick={remove}>
            Löschen
          </button>
        </div>
      </form>
      {lightbox && <Lightbox src={lightbox} alt={item.title} onClose={closeLightbox} />}
    </div>
  )
}

export default Interior
