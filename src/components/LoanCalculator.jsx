import { usePersistentState } from '../storage.js'
import { addMonths, monthlyPayment, monthsToRepay, schedule } from '../loan.js'

// Kreditrechner: an annuity loan for what the plan still needs. The
// amount follows the budget plan minus the secured funding (`suggested`)
// until it is typed in; "Aus Plan übernehmen" goes back to that. Inputs
// are remembered on this device only, nothing is saved in the database.

const DEFAULTS = {
  amount: '',
  rate: '3.5',
  mode: 'years', // 'years': term given, payment computed; 'payment': the other way round
  years: '30',
  payment: '',
  start: '',
  after: '10',
}

function thisMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(yearMonth) {
  const [y, m] = yearMonth.split('-')
  return `${m}/${y}`
}

function duration(months) {
  const years = Math.floor(months / 12)
  const rest = months % 12
  const parts = []
  if (years) parts.push(`${years} ${years === 1 ? 'Jahr' : 'Jahre'}`)
  if (rest) parts.push(`${rest} ${rest === 1 ? 'Monat' : 'Monate'}`)
  return parts.join(' ') || '0 Monate'
}

const num = (text) => (String(text).trim() === '' ? NaN : Number(String(text).replace(',', '.')))

function LoanCalculator({ suggested, planned, funding, format, formatCents }) {
  const [open, setOpen] = usePersistentState('loan.open', false)
  const [saved, setSaved] = usePersistentState('loan.inputs', DEFAULTS)
  const input = { ...DEFAULTS, ...saved }
  const set = (key) => (e) => setSaved({ ...input, [key]: e.target.value })

  const followsPlan = input.amount === ''
  const principal = followsPlan ? Math.max(0, suggested) : num(input.amount)
  const rate = num(input.rate)
  const start = input.start || thisMonth()

  let result = null
  let problem = ''
  if (!(principal > 0)) {
    problem = followsPlan
      ? 'Der Plan ist durch die gesicherte Finanzierung gedeckt. Gib eine Kreditsumme ein, um trotzdem zu rechnen.'
      : 'Bitte eine Kreditsumme über 0 eingeben.'
  } else if (!(rate >= 0) || rate > 30) {
    problem = 'Bitte einen Zinssatz zwischen 0 und 30 % eingeben.'
  } else if (input.mode === 'years') {
    const years = num(input.years)
    if (!(years > 0) || years > 50) problem = 'Bitte eine Laufzeit zwischen 1 und 50 Jahren eingeben.'
    else {
      const months = Math.round(years * 12)
      result = { payment: monthlyPayment(principal, rate, months) }
    }
  } else {
    const payment = num(input.payment)
    const months = monthsToRepay(principal, rate, payment)
    if (!(payment > 0)) problem = 'Bitte eine Monatsrate eingeben.'
    else if (!Number.isFinite(months) || months > 600)
      problem = `Mit ${formatCents(payment)} im Monat wird der Kredit nicht (oder erst nach über 50 Jahren) getilgt. Die Rate muss mehr als ${formatCents((principal * rate) / 1200)} Zinsen im ersten Monat decken.`
    else result = { payment }
  }

  if (result) {
    const plan = schedule(principal, rate, result.payment)
    const after = Math.max(0, Math.round(num(input.after) || 0))
    result = {
      ...result,
      ...plan,
      after,
      remainingAfter: plan.balanceAfter(after * 12),
      end: addMonths(start, plan.months - 1),
    }
  }

  return (
    <div className="card budget-plan loan">
      <div className="budget-head">
        <h2>
          <button type="button" className="budget-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
            <span className="budget-chevron" aria-hidden="true">
              {open ? '▾' : '▸'}
            </span>
            Kreditrechner
          </button>
        </h2>
        {!open && result && (
          <span className="muted budget-total">
            {format(principal)} · {formatCents(result.payment)} im Monat
          </span>
        )}
      </div>

      {open && (
        <>
          <div className="loan-form">
            <label>
              Kreditsumme (€)
              <input
                type="number"
                min="0"
                step="1000"
                inputMode="decimal"
                value={followsPlan ? Math.round(principal) : input.amount}
                onChange={set('amount')}
              />
            </label>
            <label>
              Zinssatz (% p. a.)
              <input type="number" min="0" max="30" step="0.05" inputMode="decimal" value={input.rate} onChange={set('rate')} />
            </label>
            <fieldset className="loan-mode">
              <legend>Ich gebe vor</legend>
              <label>
                <input
                  type="radio"
                  name="loan-mode"
                  checked={input.mode === 'years'}
                  onChange={() => setSaved({ ...input, mode: 'years' })}
                />
                Laufzeit
              </label>
              <label>
                <input
                  type="radio"
                  name="loan-mode"
                  checked={input.mode === 'payment'}
                  onChange={() =>
                    setSaved({
                      ...input,
                      mode: 'payment',
                      payment: input.payment || (result ? String(Math.round(result.payment)) : ''),
                    })
                  }
                />
                Monatsrate
              </label>
            </fieldset>
            {input.mode === 'years' ? (
              <label>
                Laufzeit (Jahre)
                <input type="number" min="1" max="50" step="1" inputMode="numeric" value={input.years} onChange={set('years')} />
              </label>
            ) : (
              <label>
                Monatsrate (€)
                <input type="number" min="0" step="50" inputMode="decimal" value={input.payment} onChange={set('payment')} />
              </label>
            )}
            <label>
              Erste Rate
              <input type="month" value={start} onChange={set('start')} />
            </label>
          </div>

          <p className="muted loan-source">
            {followsPlan ? (
              <>
                Aus dem Plan: {format(planned)} geplant − {format(funding)} gesicherte Finanzierung.
              </>
            ) : (
              <>
                Eigene Summe.{' '}
                <button type="button" className="link" onClick={() => setSaved({ ...input, amount: '' })}>
                  Aus Plan übernehmen ({format(Math.max(0, suggested))})
                </button>
              </>
            )}
          </p>

          {problem && <p className="negative budget-hint">{problem}</p>}

          {result && (
            <div className="stats loan-results">
              <div className="stat">
                <span className="muted">Monatsrate</span>
                <strong>{formatCents(result.payment)}</strong>
              </div>
              <div className="stat">
                <span className="muted">Laufzeit</span>
                <strong>{duration(result.months)}</strong>
                <span className="muted stat-note">letzte Rate {monthLabel(result.end)}</span>
              </div>
              <div className="stat">
                <span className="muted">Zinsen gesamt</span>
                <strong>{format(result.totalInterest)}</strong>
              </div>
              <div className="stat">
                <span className="muted">Rückzahlung gesamt</span>
                <strong>{format(result.totalPaid)}</strong>
              </div>
              <div className="stat">
                <label className="muted loan-after">
                  Restschuld nach
                  <input type="number" min="0" max="50" step="1" inputMode="numeric" value={input.after} onChange={set('after')} />
                  Jahren
                </label>
                <strong>{format(result.remainingAfter)}</strong>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default LoanCalculator
