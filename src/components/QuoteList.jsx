import { useState } from 'react'
import { useDialogs } from '../dialogs.js'
import { driveFileUrl } from '../drive.js'

function parseAmount(text) {
  const amount = Math.round(Number(text.trim()) * 100) / 100
  return text.trim() !== '' && amount >= 0 ? amount : null
}

// The quotes (Angebote) for one budget item, to compare and choose one.
// Choosing a quote makes its amount the item's plan (choose_quote in the
// database). `companies` are suggested while typing (contact names).
function QuoteList({ item, quotes, companies, format, readOnly, onAdd, onChoose, onDelete }) {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(null) // { company, amount, file }
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const dialogs = useDialogs()
  const sorted = [...quotes].sort((a, b) => a.amount - b.amount || a.company.localeCompare(b.company, 'de'))
  const cheapest = sorted.length > 1 ? sorted[0].amount : null
  const chosen = quotes.find((q) => q.chosen)
  const listId = `quote-companies-${item.id}`

  async function run(action) {
    setBusy(true)
    setMessage('')
    try {
      await action()
      return true
    } catch (err) {
      setMessage(err.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function handleAdd(e) {
    e.preventDefault()
    const company = adding.company.trim()
    const amount = parseAmount(adding.amount)
    if (!company || amount === null) {
      setMessage('Bitte Firma und Betrag eingeben.')
      return
    }
    if (await run(() => onAdd(item.id, { company, amount, file: adding.file }))) setAdding(null)
  }

  async function handleChoose(quote) {
    const pick = !quote.chosen
    if (pick) {
      const question =
        `Das Angebot von „${quote.company}“ (${format(quote.amount)}) auswählen? ` +
        `Der Plan für „${item.name}“ wird dann ${format(quote.amount)}.`
      if (!(await dialogs.confirm(question, { confirmLabel: 'Auswählen' }))) return
    }
    await run(() => onChoose(quote, pick))
  }

  async function handleDelete(quote) {
    // The item keeps the chosen quote's amount as its plan (and its PDF
    // stays in Google Drive); say so, so the plan is not a surprise later.
    const planNote = quote.chosen
      ? ` Es ist ausgewählt; der Plan für „${item.name}“ bleibt bei ${format(item.plannedAmount)}` +
        ' und lässt sich unter „Bearbeiten“ ändern.'
      : ''
    const question = `Das Angebot von „${quote.company}“ löschen?${planNote}`
    if (!(await dialogs.confirm(question, { confirmLabel: 'Löschen', danger: true }))) return
    await run(() => onDelete(quote))
  }

  function startAdding() {
    setOpen(true)
    setMessage('')
    setAdding({ company: '', amount: '', file: null })
  }

  if (quotes.length === 0 && !adding) {
    return readOnly ? null : (
      <div className="quotes">
        <button type="button" className="link quote-toggle" onClick={startAdding}>
          + Angebot
        </button>
      </div>
    )
  }

  return (
    <div className="quotes">
      <button
        type="button"
        className="link quote-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">{open ? '▾' : '▸'}</span> {quotes.length}{' '}
        {quotes.length === 1 ? 'Angebot' : 'Angebote'}
        {chosen && !open && <span className="muted"> · beauftragt: {chosen.company}</span>}
      </button>
      {open && (
        <ul className="quote-list">
          {sorted.map((quote) => (
            <li key={quote.id} className={quote.chosen ? 'quote chosen' : 'quote'}>
              <span className="quote-company">
                {quote.chosen && <span aria-hidden="true">✓ </span>}
                {quote.company}
                {quote.chosen && <span className="state-pill state-done">Beauftragt</span>}
                {cheapest !== null && quote.amount === cheapest && (
                  <span className="state-pill">Günstigstes</span>
                )}
              </span>
              <span className="quote-amount">
                {format(quote.amount)}
                {cheapest !== null && quote.amount > cheapest && (
                  <span className="muted"> (+{format(quote.amount - cheapest)})</span>
                )}
              </span>
              <span className="quote-actions">
                {quote.files.map((file) => (
                  <a key={file.id} className="link" href={driveFileUrl(file.id)} target="_blank" rel="noreferrer">
                    📄 {file.name}
                  </a>
                ))}
                {!readOnly && (
                  <>
                    <button type="button" className="link" onClick={() => handleChoose(quote)} disabled={busy}>
                      {quote.chosen ? 'Auswahl zurücknehmen' : 'Auswählen'}
                    </button>
                    <button type="button" className="link danger" onClick={() => handleDelete(quote)} disabled={busy}>
                      Löschen
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {open && !readOnly && !adding && (
        <button type="button" className="link quote-toggle" onClick={startAdding}>
          + Angebot
        </button>
      )}
      {adding && (
        <form className="budget-edit quote-form" onSubmit={handleAdd}>
          <input
            placeholder="Firma"
            aria-label={`Firma des Angebots für ${item.name}`}
            list={listId}
            value={adding.company}
            onChange={(e) => setAdding({ ...adding, company: e.target.value })}
            disabled={busy}
            autoFocus
          />
          <datalist id={listId}>
            {companies.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            placeholder="Betrag (€)"
            aria-label="Betrag des Angebots (€)"
            value={adding.amount}
            onChange={(e) => setAdding({ ...adding, amount: e.target.value })}
            disabled={busy}
          />
          <label className="quote-file secondary">
            {adding.file ? `📄 ${adding.file.name}` : 'PDF anhängen'}
            <input
              type="file"
              accept="application/pdf,image/*"
              hidden
              onChange={(e) => setAdding({ ...adding, file: e.target.files[0] ?? null })}
              disabled={busy}
            />
          </label>
          <button type="submit" className="link" disabled={busy}>
            {busy ? 'Wird gespeichert…' : 'Speichern'}
          </button>
          <button type="button" className="link" onClick={() => setAdding(null)} disabled={busy}>
            Abbrechen
          </button>
        </form>
      )}
      {message && (
        <p className="error" role="alert">
          {message}
        </p>
      )}
    </div>
  )
}

export default QuoteList
