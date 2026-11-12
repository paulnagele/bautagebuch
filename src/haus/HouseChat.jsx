import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDialogs } from '../dialogs.js'
import { clearChat, listChat, sendChat, undoChange, watchChat } from './houseStore.js'

// The Claude chat of the Haus tab. A request starts a Claude Code session
// on the owner's Claude account (Edge Function haus-chat); it changes the
// open version in place (or saves a new one when asked) and answers here,
// usually after a few minutes. When an answer comes in, the changed
// version is shown right away, also with the chat closed. Opened with the "Claude" button in the viewer's corner; full
// screen on phones, a side panel on wide screens. Lives in document.body
// so it also covers the Vollbild view.
export default function HouseChat({ open, onClose, version, onOpenVersion }) {
  const dialogs = useDialogs()
  const [messages, setMessages] = useState(null)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const listRef = useRef(null)
  const inputRef = useRef(null)
  const waitingRef = useRef(false)
  const seenRef = useRef(null)
  const openVersionRef = useRef(onOpenVersion)
  useEffect(() => {
    openVersionRef.current = onOpenVersion
  }, [onOpenVersion])

  // Loaded with the Haus tab and kept up to date live, so new answers show
  // the changed model even while the chat is closed.
  useEffect(() => {
    let left = false
    const load = () =>
      listChat()
        .then((rows) => {
          if (left) return
          setMessages(rows)
          const answers = rows.filter((m) => m.role === 'claude')
          const fresh = seenRef.current ? answers.filter((m) => !seenRef.current.has(m.id)) : []
          seenRef.current = new Set(answers.map((m) => m.id))
          const last = fresh.filter((m) => m.version_id).at(-1)
          if (last) openVersionRef.current(last.version_id, { reload: true })
        })
        .catch((loadError) => {
          if (!left) setError(loadError.message)
        })
    load()
    const stop = watchChat(load, () => waitingRef.current)
    return () => {
      left = true
      stop()
    }
  }, [])

  const waiting = messages?.some((m) => m.role === 'user' && isOpen(m.status))
  useEffect(() => {
    waitingRef.current = Boolean(waiting)
  }, [waiting])

  // The "seit …" counter of a running request.
  useEffect(() => {
    if (!open || !waiting) return undefined
    const timer = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(timer)
  }, [open, waiting])

  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages, open])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  async function submit(event) {
    event.preventDefault()
    const request = text.trim()
    if (!request || busy) return
    setBusy(true)
    setError('')
    try {
      const row = await sendChat({ text: request, versionId: version?.id })
      setText('')
      setMessages((current) => (current?.some((m) => m.id === row.id) ? current : [...(current ?? []), row]))
    } catch (sendError) {
      setError(sendError.message)
      listChat().then(setMessages, () => {})
    } finally {
      setBusy(false)
    }
  }

  async function clear() {
    const question = 'Den ganzen Chat löschen? Claudes Änderungen am Modell bleiben.'
    if (!(await dialogs.confirm(question, { confirmLabel: 'Löschen', danger: true }))) return
    try {
      await clearChat()
      setMessages([])
    } catch (clearError) {
      setError(clearError.message)
    }
  }

  const answers = new Map((messages ?? []).filter((m) => m.role === 'claude').map((m) => [m.reply_to, m]))
  const requests = (messages ?? []).filter((m) => m.role === 'user')

  return createPortal(
    <div className="haus-chat" role="dialog" aria-label="Claude fragen">
      <header className="haus-chat-head">
        <h2>Claude</h2>
        {requests.length > 0 && (
          <button type="button" className="link-button" onClick={clear}>
            Verlauf löschen
          </button>
        )}
        <button type="button" className="haus-chat-close" onClick={onClose} aria-label="Schließen">
          ×
        </button>
      </header>

      <div className="haus-chat-list" ref={listRef}>
        {messages === null && !error && <p className="empty">Wird geladen…</p>}
        {messages?.length === 0 && (
          <div className="haus-chat-intro">
            <p>
              Sag Claude, was am Modell anders werden soll, zum Beispiel: „Mach das Fenster im Büro DG
              20 cm breiter“ oder „Wie groß ist die Terrasse?“.
            </p>
            <p>
              Claude arbeitet mit deinem Claude-Konto und ändert die offene Version direkt (eine neue
              Version nur, wenn du darum bittest). Jede Änderung lässt sich mit „Rückgängig“ zurücknehmen.
              Eine Antwort dauert meist ein paar Minuten; du kannst den Chat so lange schließen, das
              Modell zeigt die Änderung von selbst.
            </p>
          </div>
        )}
        {requests.map((request) => (
          <Exchange
            key={request.id}
            request={request}
            answer={answers.get(request.id)}
            now={now}
            onOpenVersion={(id) => {
              onOpenVersion(id, { reload: true })
              onClose()
            }}
            onUndo={async (answer) => {
              const question = 'Diese Änderung von Claude rückgängig machen?'
              if (!(await dialogs.confirm(question, { confirmLabel: 'Rückgängig' }))) return
              try {
                await undoChange(answer.backup_id)
                onOpenVersion(answer.version_id, { reload: true })
                setMessages((current) =>
                  current?.map((m) => (m.id === answer.id ? { ...m, backup_id: null, undone: true } : m)),
                )
              } catch (undoError) {
                setError(undoError.message)
              }
            }}
          />
        ))}
      </div>

      {error && (
        <p className="error haus-chat-error" role="alert">
          {error}
        </p>
      )}
      <form className="haus-chat-form" onSubmit={submit}>
        <textarea
          ref={inputRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) submit(event)
          }}
          rows={2}
          placeholder="Was soll Claude ändern?"
          aria-label="Nachricht an Claude"
        />
        <button type="submit" disabled={busy || !text.trim()}>
          {busy ? 'Startet…' : 'Senden'}
        </button>
        {version && <p className="haus-chat-on">Gilt für die offene Version: {version.name}</p>}
      </form>
    </div>,
    document.body,
  )
}

function isOpen(status) {
  return status === 'queued' || status === 'started' || status === 'working'
}

const STATUS_TEXT = {
  queued: 'Claude wird gestartet…',
  started: 'Claude startet…',
  working: 'Claude arbeitet am Modell…',
}

function Exchange({ request, answer, now, onOpenVersion, onUndo }) {
  const minutes = Math.floor((now - new Date(request.created_at).getTime()) / 60000)
  return (
    <div className="haus-chat-exchange">
      <div className="haus-chat-msg mine">
        <p>{request.text}</p>
        <span className="haus-chat-time">{formatTime(request.created_at)}</span>
      </div>
      {answer ? (
        <div className="haus-chat-msg claude">
          <p>{answer.text}</p>
          <div className="haus-chat-actions">
            {answer.version_id && (
              <button type="button" onClick={() => onOpenVersion(answer.version_id)}>
                Ansehen
              </button>
            )}
            {answer.backup_id && (
              <button type="button" className="secondary" onClick={() => onUndo(answer)}>
                Rückgängig
              </button>
            )}
            {answer.undone && <span className="haus-chat-note">Rückgängig gemacht</span>}
            {request.session_url && (
              <a href={request.session_url} target="_blank" rel="noopener noreferrer">
                In Claude weiterreden
              </a>
            )}
          </div>
        </div>
      ) : isOpen(request.status) ? (
        <div className="haus-chat-msg claude pending" aria-live="polite">
          <p>
            {STATUS_TEXT[request.status]}
            {minutes >= 1 && ` (seit ${minutes} Min.)`}
          </p>
          {request.session_url && (
            <a href={request.session_url} target="_blank" rel="noopener noreferrer">
              Zusehen
            </a>
          )}
        </div>
      ) : request.status === 'failed' ? (
        <div className="haus-chat-msg claude failed">
          <p>{request.error || 'Das hat nicht geklappt.'}</p>
          {request.session_url && (
            <a href={request.session_url} target="_blank" rel="noopener noreferrer">
              Sitzung ansehen
            </a>
          )}
        </div>
      ) : null}
    </div>
  )
}

function formatTime(iso) {
  const date = new Date(iso)
  const today = new Date().toDateString() === date.toDateString()
  return date.toLocaleString('de-AT', {
    ...(today ? {} : { day: '2-digit', month: '2-digit' }),
    hour: '2-digit',
    minute: '2-digit',
  })
}
