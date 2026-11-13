import { useCallback, useEffect, useRef, useState } from 'react'
import { config } from '../config.js'
import { supabase } from '../supabase.js'
import { useDialogs } from '../dialogs.js'
import { readSetting, saveSetting } from '../settings.js'
import {
  checkDriveFolder,
  connectDrive,
  driveAccess,
  driveFolderUrl,
  folderIdFromText,
} from '../drive.js'
import { calendarAccess, checkCalendar, connectCalendar } from '../calendar.js'
import { findPlace } from '../weather.js'
import { chatConfigured, saveChatTrigger } from '../haus/houseStore.js'
import CategorySettings from '../components/CategorySettings.jsx'
import DocumentTypeSettings from '../components/DocumentTypeSettings.jsx'

// Einstellungen: what used to need the SQL Editor (Drive folder, calendar,
// site location, members, house logins), the lists (categories, document
// types) and this device's Google connections. All members have the same
// rights. What the app remembers by itself per device (folded sections,
// filters, …) is deliberately not here.

const SECTIONS = [
  { id: 'project', title: 'Projekt' },
  { id: 'members', title: 'Mitglieder' },
  { id: 'lists', title: 'Listen' },
  { id: 'chat', title: 'Haus-Chat' },
  { id: 'device', title: 'Dieses Gerät' },
  { id: 'info', title: 'Info' },
]

function errorText(err) {
  return err?.message ?? String(err)
}

// A small async-action helper: busy flag, error and success messages.
function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const run = useCallback(async (action, success = '') => {
    setBusy(true)
    setError('')
    setDone('')
    try {
      const result = await action()
      if (result !== false && success) setDone(success)
      return result
    } catch (err) {
      setError(errorText(err))
      return false
    } finally {
      setBusy(false)
    }
  }, [])
  return { busy, error, done, run, setError, setDone }
}

function Messages({ error, done }) {
  return (
    <>
      {error && (
        <p className="error settings-message" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="settings-done settings-message" role="status">
          ✓ {done}
        </p>
      )}
    </>
  )
}

// ---- Projekt ------------------------------------------------------------------

function useStoredSetting(key) {
  const [value, setValue] = useState(undefined) // undefined = loading
  const [loadError, setLoadError] = useState('')
  useEffect(() => {
    let cancelled = false
    readSetting(key).then(
      (v) => !cancelled && setValue(v),
      (err) => !cancelled && setLoadError(errorText(err)),
    )
    return () => {
      cancelled = true
    }
  }, [key])
  return [value, setValue, loadError]
}

function DriveFolderSetting({ user }) {
  const [current, setCurrent, loadError] = useStoredSetting('drive_folder_id')
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const { busy, error, done, run, setError } = useAction()
  const dialogs = useDialogs()

  // The folder's name, when Drive is already connected on this device.
  useEffect(() => {
    if (!current || !driveAccess.connected()) return
    let cancelled = false
    checkDriveFolder(current).then(
      (folder) => !cancelled && setName(folder.name),
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [current])

  async function save(e) {
    e.preventDefault()
    const id = folderIdFromText(text)
    if (!id) {
      setError('Bitte den Link zum Ordner aus Google Drive einfügen (…/drive/folders/…).')
      return
    }
    await run(async () => {
      // First, while the click still counts, or the browser blocks the popup.
      await connectDrive(user.email)
      const folder = await checkDriveFolder(id)
      if (current && current !== id) {
        const ok = await dialogs.confirm(
          `Ab jetzt landen neue Fotos und Dateien im Ordner „${folder.name}“. ` +
            'Die bisherigen bleiben im alten Ordner und werden nicht verschoben. ' +
            'Damit sie in der App sichtbar bleiben, braucht jedes Mitglied weiterhin Zugriff auf den alten Ordner.',
          { confirmLabel: 'Trotzdem umstellen', danger: true },
        )
        if (!ok) return false
      }
      await saveSetting('drive_folder_id', id)
      setCurrent(id)
      setName(folder.name)
      setText('')
    }, 'Drive-Ordner gespeichert.')
  }

  return (
    <div className="settings-item">
      <h3>Google-Drive-Ordner</h3>
      <p className="muted settings-hint">
        Hier landen alle Fotos und Dateien, sortiert nach Art des Eintrags und Datum. Teile den
        Ordner in Google Drive mit allen Mitgliedern als <strong>Bearbeiter</strong>.
      </p>
      {loadError && <p className="error">{loadError}</p>}
      {current === null && <p className="settings-missing">Noch kein Ordner eingestellt.</p>}
      {current && (
        <p className="settings-current">
          {name ? <strong>{name}</strong> : <code>{current}</code>}{' '}
          <a href={driveFolderUrl(current)} target="_blank" rel="noreferrer">
            In Drive öffnen
          </a>
        </p>
      )}
      <form className="settings-form" onSubmit={save}>
        <input
          aria-label="Link zum Drive-Ordner"
          placeholder="Link zum Ordner einfügen"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !text.trim()}>
          {current ? 'Umstellen' : 'Speichern'}
        </button>
      </form>
      <Messages error={error} done={done} />
    </div>
  )
}

function CalendarSetting({ user }) {
  const [current, setCurrent, loadError] = useStoredSetting('calendar_id')
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const { busy, error, done, run } = useAction()

  useEffect(() => {
    if (!current || !calendarAccess.connected()) return
    let cancelled = false
    checkCalendar(current).then(
      (cal) => !cancelled && setName(cal.name),
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [current])

  async function save(e) {
    e.preventDefault()
    const id = text.trim()
    await run(async () => {
      await connectCalendar(user.email)
      const cal = await checkCalendar(id)
      await saveSetting('calendar_id', id)
      setCurrent(id)
      setName(cal.name)
      setText('')
    }, 'Kalender gespeichert.')
  }

  return (
    <div className="settings-item">
      <h3>Google-Kalender</h3>
      <p className="muted settings-hint">
        Termine, fällige Aufgaben und Mängel und die Meilensteine landen in diesem Kalender. Die ID
        steht in Google Kalender unter Einstellungen → Kalender → <em>Kalender integrieren</em>.
        Teile ihn mit allen Mitgliedern mit „Änderungen an Terminen vornehmen“.
      </p>
      {loadError && <p className="error">{loadError}</p>}
      {current === null && <p className="settings-missing">Noch kein Kalender eingestellt.</p>}
      {current && (
        <p className="settings-current">
          {name ? <strong>{name}</strong> : <code>{current}</code>}
        </p>
      )}
      <form className="settings-form" onSubmit={save}>
        <input
          aria-label="Kalender-ID"
          placeholder="…@group.calendar.google.com"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !text.trim()}>
          {current ? 'Umstellen' : 'Speichern'}
        </button>
      </form>
      <Messages error={error} done={done} />
    </div>
  )
}

function LocationSetting() {
  const [current, setCurrent, loadError] = useStoredSetting('site_location')
  const [text, setText] = useState(null) // null = not edited yet
  const { busy, error, done, run, setError } = useAction()
  const value = text ?? current ?? ''

  function takeDeviceLocation() {
    if (!navigator.geolocation) {
      setError('Dieses Gerät kann keinen Standort liefern.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => setText(`${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`),
      () => setError('Der Standort wurde nicht freigegeben.'),
      { timeout: 15000 },
    )
  }

  async function save(e) {
    e.preventDefault()
    const clean = value.trim()
    await run(async () => {
      if (clean) {
        const place = await findPlace(clean)
        if (!place) throw new Error('Bitte einen Ort oder Koordinaten angeben.')
      }
      await saveSetting('site_location', clean)
      setCurrent(clean || null)
      setText(null)
    }, clean ? 'Ort gespeichert.' : 'Ort entfernt, das Wetter kommt wieder vom Handy-Standort.')
  }

  return (
    <div className="settings-item">
      <h3>Ort der Baustelle</h3>
      <p className="muted settings-hint">
        Für das Wetter in Status-Einträgen. Ortsname oder Koordinaten; leer lassen, um den Standort
        des Handys zu verwenden.
      </p>
      {loadError && <p className="error">{loadError}</p>}
      <form className="settings-form" onSubmit={save}>
        <input
          aria-label="Ort der Baustelle"
          placeholder="z. B. 48.27, 14.25"
          value={value}
          onChange={(e) => setText(e.target.value)}
          disabled={busy || current === undefined}
        />
        <button type="submit" disabled={busy || current === undefined || value.trim() === (current ?? '')}>
          Speichern
        </button>
      </form>
      <button type="button" className="link" onClick={takeDeviceLocation} disabled={busy}>
        Aktuellen Standort übernehmen
      </button>
      <Messages error={error} done={done} />
    </div>
  )
}

function ProjectSection({ user }) {
  return (
    <>
      <DriveFolderSetting user={user} />
      <CalendarSetting user={user} />
      <LocationSetting />
    </>
  )
}

// ---- Mitglieder -----------------------------------------------------------------

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' })

function EmailList({ title, hint, rows, self, onAdd, onRemove, loadError, addLabel, after }) {
  const [email, setEmail] = useState('')
  const { busy, error, done, run } = useAction()
  const dialogs = useDialogs()

  async function add(e) {
    e.preventDefault()
    const clean = email.trim().toLowerCase()
    const ok = await run(() => onAdd(clean), `${clean} hinzugefügt.`)
    if (ok !== false) setEmail('')
  }

  async function remove(row) {
    if (!(await dialogs.confirm(`${row.email} entfernen?`, { confirmLabel: 'Entfernen', danger: true }))) return
    await run(() => onRemove(row.email), `${row.email} entfernt.`)
  }

  return (
    <div className="settings-item">
      <h3>{title}</h3>
      {hint && <p className="muted settings-hint">{hint}</p>}
      {loadError && <p className="error">{loadError}</p>}
      <ul className="settings-list">
        {rows.map((row) => (
          <li key={row.email}>
            <span className="settings-list-main">
              {row.email}
              {row.email === self && <span className="muted"> (du)</span>}
            </span>
            <span className="muted settings-list-date">
              seit {dateFormat.format(new Date(row.added_at))}
            </span>
            {row.email !== self && (
              <button
                type="button"
                className="link danger"
                onClick={() => remove(row)}
                disabled={busy}
              >
                Entfernen
              </button>
            )}
          </li>
        ))}
      </ul>
      <form className="settings-form" onSubmit={add}>
        <input
          type="text"
          inputMode="email"
          autoComplete="off"
          aria-label={addLabel}
          placeholder="name@gmail.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !email.trim()}>
          Hinzufügen
        </button>
      </form>
      <Messages error={error} done={done} />
      {done && after}
    </div>
  )
}

function MembersSection({ user }) {
  const [members, setMembers] = useState([])
  const [editors, setEditors] = useState([])
  const [memberError, setMemberError] = useState('')
  const [editorError, setEditorError] = useState('')
  const [folderId, setFolderId] = useState(null)

  const loadMembers = useCallback(async () => {
    const { data, error } = await supabase
      .from('members')
      .select('email, added_at')
      .order('added_at')
    if (error) setMemberError(error.message)
    else setMembers(data)
  }, [])
  const loadEditors = useCallback(async () => {
    const { data, error } = await supabase.rpc('list_house_editors')
    if (error) setEditorError(error.message)
    else setEditors(data)
  }, [])

  useEffect(() => {
    loadMembers()
    loadEditors()
    readSetting('drive_folder_id').then(setFolderId, () => {})
  }, [loadMembers, loadEditors])

  async function call(fn, email) {
    const { error } = await supabase.rpc(fn, fn.includes('house') ? { editor_email: email } : { member_email: email })
    if (error) throw new Error(error.message)
  }

  return (
    <>
      <EmailList
        title="Mitglieder"
        hint="Mitglieder melden sich mit ihrem Google-Konto an und sehen und ändern alles. Alle haben die gleichen Rechte."
        rows={members}
        self={user.email.toLowerCase()}
        loadError={memberError}
        addLabel="E-Mail-Adresse des neuen Mitglieds"
        onAdd={async (email) => {
          await call('add_member', email)
          await loadMembers()
        }}
        onRemove={async (email) => {
          await call('remove_member', email)
          await loadMembers()
        }}
        after={
          <div className="settings-next">
            <p>Damit alles klappt, noch in Google:</p>
            <ol>
              <li>
                In der{' '}
                <a href="https://console.cloud.google.com/auth/audience" target="_blank" rel="noreferrer">
                  Google Cloud Console → Zielgruppe
                </a>{' '}
                als Testnutzer eintragen.
              </li>
              <li>
                Den{' '}
                {folderId ? (
                  <a href={driveFolderUrl(folderId)} target="_blank" rel="noreferrer">
                    Drive-Ordner
                  </a>
                ) : (
                  'Drive-Ordner'
                )}{' '}
                als Bearbeiter teilen.
              </li>
              <li>
                Den{' '}
                <a href="https://calendar.google.com/calendar/r/settings" target="_blank" rel="noreferrer">
                  Kalender
                </a>{' '}
                mit „Änderungen an Terminen vornehmen“ teilen.
              </li>
            </ol>
          </div>
        }
      />
      <EmailList
        title="Haus-Logins"
        hint="Logins, die nur das Haus-Modell sehen und neue Versionen anlegen dürfen, z. B. Claudes Login für den Haus-Chat. Den Login selbst (mit Passwort) legst du in Supabase unter Authentication → Users an."
        rows={editors}
        self={null}
        loadError={editorError}
        addLabel="E-Mail-Adresse des Haus-Logins"
        onAdd={async (email) => {
          await call('add_house_editor', email)
          await loadEditors()
        }}
        onRemove={async (email) => {
          await call('remove_house_editor', email)
          await loadEditors()
        }}
      />
    </>
  )
}

// ---- Listen -------------------------------------------------------------------------

function ListsSection() {
  return (
    <>
      <div className="settings-item">
        <h3>Kategorien</h3>
        <CategorySettings />
      </div>
      <div className="settings-item">
        <h3>Dokumenttypen</h3>
        <DocumentTypeSettings />
      </div>
    </>
  )
}

// ---- Haus-Chat ---------------------------------------------------------------------

function ChatSection() {
  const [configured, setConfigured] = useState(null) // null = checking
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const { busy, error, done, run } = useAction()
  const dialogs = useDialogs()

  useEffect(() => {
    let cancelled = false
    chatConfigured().then((ok) => !cancelled && setConfigured(ok))
    return () => {
      cancelled = true
    }
  }, [])

  async function save(e) {
    e.preventDefault()
    await run(async () => {
      await saveChatTrigger(url, token)
      setUrl('')
      setToken('')
      setConfigured(await chatConfigured())
    }, 'Haus-Chat gespeichert.')
  }

  async function turnOff() {
    const ok = await dialogs.confirm(
      'Den Haus-Chat für diese Seite ausschalten? Der Verlauf bleibt erhalten.',
      { confirmLabel: 'Ausschalten', danger: true },
    )
    if (!ok) return
    await run(async () => {
      await saveChatTrigger('', '')
      const still = await chatConfigured()
      setConfigured(still)
      if (still) {
        throw new Error(
          'Für diese Seite sind URL und Token auch als Secrets in Supabase gesetzt; die gelten weiter. Lösche sie dort (Edge Functions → Secrets), um den Chat auszuschalten.',
        )
      }
    }, 'Haus-Chat ausgeschaltet.')
  }

  return (
    <>
      <div className="settings-item">
        <h3>Status</h3>
        <p className="settings-current">
          {configured === null && <span className="muted">Wird geprüft…</span>}
          {configured === true && <span className="settings-done">Eingerichtet. Der Claude-Knopf erscheint im Haus-Tab.</span>}
          {configured === false && (
            <span className="settings-missing">Nicht eingerichtet. Der Claude-Knopf im Haus-Tab ist ausgeblendet.</span>
          )}
        </p>
        {configured && (
          <button type="button" className="link danger" onClick={turnOff} disabled={busy}>
            Chat ausschalten
          </button>
        )}
      </div>
      <div className="settings-item">
        <h3>{configured ? 'Neue Aufgabe verbinden' : 'Einrichten'}</h3>
        <ol className="settings-steps">
          <li>
            Unter{' '}
            <a href="https://claude.ai/code/routines" target="_blank" rel="noreferrer">
              claude.ai/code/routines
            </a>{' '}
            eine Aufgabe „Haus-Chat“ anlegen (Schritte und Text in <code>docs/haus-chat.md</code>), mit
            einer Umgebung, in der diese Werte gesetzt sind:
            <pre className="settings-code">
              {`SUPABASE_URL=${config.supabaseUrl}\nSUPABASE_ANON_KEY=${config.supabaseAnonKey}\nHAUS_BOT_EMAIL=…\nHAUS_BOT_PASSWORD=…`}
            </pre>
            Der Haus-Login muss in dieser Datenbank existieren und unter Mitglieder → Haus-Logins
            stehen.
          </li>
          <li>Als Auslöser nur „API“ wählen und hier URL und Token eintragen:</li>
        </ol>
        <form className="settings-form settings-form-stack" onSubmit={save}>
          <input
            aria-label="URL des API-Auslösers"
            placeholder="https://api.anthropic.com/v1/claude_code/routines/trig_…/fire"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy}
            autoComplete="off"
          />
          <input
            type="password"
            aria-label="Token des API-Auslösers"
            placeholder="Token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={busy}
            autoComplete="new-password"
          />
          <button type="submit" disabled={busy || !url.trim() || !token.trim()}>
            Speichern
          </button>
        </form>
        <p className="muted settings-hint">
          Der Token wird nur gespeichert, nie wieder angezeigt, und nur der Server liest ihn.
        </p>
        <Messages error={error} done={done} />
      </div>
    </>
  )
}

// ---- Dieses Gerät -----------------------------------------------------------------

function GoogleConnection({ title, access, connect, user, note }) {
  const [connected, setConnected] = useState(access.connected)
  const { busy, error, run } = useAction()

  useEffect(() => access.onConnect(() => setConnected(true)), [access])

  return (
    <li className="settings-connection">
      <span className="settings-list-main">
        <strong>{title}</strong>
        <span className={connected ? 'settings-done settings-status' : 'muted settings-status'}>
          {connected ? 'Verbunden' : 'Nicht verbunden'}
        </span>
        <span className="muted settings-hint">{note}</span>
      </span>
      {connected ? (
        <button
          type="button"
          className="secondary"
          onClick={() => {
            access.disconnect()
            setConnected(false)
          }}
        >
          Trennen
        </button>
      ) : (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => run(() => connect(user.email))}
        >
          Verbinden
        </button>
      )}
      {error && <p className="error settings-message">{error}</p>}
    </li>
  )
}

function DeviceSection({ user, onLogout }) {
  return (
    <>
      <div className="settings-item">
        <h3>Angemeldet als</h3>
        <p className="settings-current">
          {user.name && user.name !== user.email && <strong>{user.name} </strong>}
          <span className="muted">{user.email}</span>
        </p>
        <button type="button" className="secondary" onClick={onLogout}>
          Abmelden
        </button>
      </div>
      <div className="settings-item">
        <h3>Google-Zugriff auf diesem Gerät</h3>
        <ul className="settings-list">
          <GoogleConnection
            title="Google Drive"
            note="Für Fotos und Dateien."
            access={driveAccess}
            connect={connectDrive}
            user={user}
          />
          <GoogleConnection
            title="Google Kalender"
            note="Für Termine im Kalender."
            access={calendarAccess}
            connect={connectCalendar}
            user={user}
          />
        </ul>
      </div>
    </>
  )
}

// ---- Info ------------------------------------------------------------------------------

function InfoSection() {
  const database = (() => {
    try {
      return new URL(config.supabaseUrl).host.split('.')[0]
    } catch {
      return '–'
    }
  })()
  return (
    <div className="settings-item">
      <dl className="settings-info">
        <dt>Seite</dt>
        <dd>{window.location.host}</dd>
        <dt>Datenbank</dt>
        <dd>
          <code>{database}</code>
        </dd>
        <dt>Version</dt>
        <dd>{new Date(__BUILD_TIME__).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}</dd>
      </dl>
    </div>
  )
}

// ---- page --------------------------------------------------------------------------------

function Settings({ user, section, onClose, onLogout }) {
  const refs = useRef({})

  useEffect(() => {
    const target = section && refs.current[section]
    if (target) target.scrollIntoView({ block: 'start' })
    else window.scrollTo({ top: 0 })
  }, [section])

  const body = {
    project: <ProjectSection user={user} />,
    members: <MembersSection user={user} />,
    lists: <ListsSection />,
    chat: <ChatSection />,
    device: <DeviceSection user={user} onLogout={onLogout} />,
    info: <InfoSection />,
  }

  return (
    <div className="settings-page" data-no-swipe>
      <header className="settings-header">
        <button type="button" className="link settings-back" onClick={onClose} aria-label="Zurück">
          ← Zurück
        </button>
        <h2>Einstellungen</h2>
      </header>
      {SECTIONS.map((s) => (
        <details
          key={s.id}
          className="card settings-section"
          open={section ? s.id === section : s.id === 'project'}
          ref={(node) => {
            refs.current[s.id] = node
          }}
        >
          <summary>{s.title}</summary>
          {body[s.id]}
        </details>
      ))}
    </div>
  )
}

export default Settings
