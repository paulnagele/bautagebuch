import { useState } from 'react'
import { MONTHS } from '../../energy/climate.js'
import { fmt } from '../../energy/format.js'

// The results: HWB and class, yearly demand, heating load, the monthly
// balance as a chart (or table) and where the heat goes.
function EnergyResult({ result, building, saveState, onRetrySave }) {
  const [showTable, setShowTable] = useState(false)
  const bgf = Number(building.bgf) || 0
  const ready = bgf > 0 && result.parts.length > 0

  return (
    <div className="card energy-result">
      <div className="energy-head">
        <h2>Heizwärmebedarf</h2>
        <SaveState state={saveState} onRetry={onRetrySave} />
      </div>
      {!ready ? (
        <p className="muted">
          Noch keine Bauteile oder keine Bruttogrundfläche. Übernimm die Flächen aus dem Hausmodell oder lege die
          Bauteile selbst an.
        </p>
      ) : (
        <>
          <div className="stats energy-stats">
            <div className="stat">
              <span className="muted">HWB</span>
              <strong>
                {fmt(result.hwb, 1)} <small>kWh/m²a</small>{' '}
                <span className={`energy-class class-${result.energyClass.replace(/\+/g, 'p')}`}>{result.energyClass}</span>
              </strong>
            </div>
            <div className="stat">
              <span className="muted">Heizwärme pro Jahr</span>
              <strong>
                {fmt(result.totals.heating)} <small>kWh</small>
              </strong>
            </div>
            <div className="stat">
              <span className="muted">Heizlast bei {fmt(result.climate.designTemp, 1)} °C</span>
              <strong>
                {fmt(result.loadKw, 1)} <small>kW</small>
              </strong>
              <span className="muted stat-note">{fmt(result.loadPerM2, 0)} W/m²</span>
            </div>
            <div className="stat">
              <span className="muted">Mittlerer U-Wert</span>
              <strong>
                {fmt(result.meanU, 2)} <small>W/m²K</small>
              </strong>
              <span className="muted stat-note">
                {fmt(bgf, 0)} m² BGF · A/V {fmt(result.compactness, 2)}
              </span>
            </div>
          </div>

          <MonthChart months={result.months} />
          <button type="button" className="link" onClick={() => setShowTable(!showTable)}>
            {showTable ? 'Monatstabelle ausblenden' : 'Monatstabelle anzeigen'}
          </button>
          {showTable && <MonthTable result={result} />}

          <h3 className="energy-sub">Wohin die Wärme geht</h3>
          <Breakdown result={result} />
        </>
      )}
    </div>
  )
}

function SaveState({ state, onRetry }) {
  if (state.status === 'error') {
    return (
      <span className="error energy-save" role="alert">
        Nicht gespeichert: {state.error}{' '}
        <button type="button" className="link" onClick={onRetry}>
          Erneut
        </button>
      </span>
    )
  }
  const text = { pending: 'Änderungen…', saving: 'Wird gespeichert…', saved: 'Gespeichert' }[state.status]
  return text ? <span className="muted energy-save">{text}</span> : null
}

// Heating demand per month (kWh), one bar each.
function MonthChart({ months }) {
  const [hover, setHover] = useState(null)
  const width = 600
  const height = 180
  const top = 16
  const bottom = 22
  const left = 4
  const max = Math.max(1, ...months.map((month) => month.heating))
  const slot = (width - left) / months.length
  const barWidth = Math.min(28, slot * 0.6)
  const scale = (height - top - bottom) / max
  const base = height - bottom
  const active = hover != null ? months[hover] : null

  return (
    <figure className="energy-chart">
      <figcaption className="muted">Heizwärmebedarf je Monat (kWh)</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Heizwärmebedarf je Monat">
        <line x1={left} x2={width} y1={base} y2={base} className="energy-axis" />
        {months.map((month, i) => {
          const h = month.heating * scale
          const x = left + i * slot + (slot - barWidth) / 2
          const r = Math.min(4, h)
          return (
            <g
              key={month.month}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => setHover(hover === i ? null : i)}
            >
              <rect x={left + i * slot} y={top} width={slot} height={base - top} fill="transparent" />
              {h > 0.5 && (
                <path
                  className="energy-bar"
                  d={`M${x},${base} V${base - h + r} Q${x},${base - h} ${x + r},${base - h} H${x + barWidth - r} Q${x + barWidth},${base - h} ${x + barWidth},${base - h + r} V${base} Z`}
                />
              )}
              {month.heating >= max * 0.999 && (
                <text x={x + barWidth / 2} y={base - h - 4} textAnchor="middle" className="energy-label">
                  {fmt(month.heating)}
                </text>
              )}
              <text x={left + i * slot + slot / 2} y={height - 6} textAnchor="middle" className="energy-tick">
                {MONTHS[month.month]}
              </text>
            </g>
          )
        })}
      </svg>
      {active && (
        <p className="energy-tooltip">
          <strong>{MONTHS[active.month]}</strong>: {fmt(active.heating)} kWh Heizwärme · Verluste {fmt(active.losses)} kWh ·
          Gewinne {fmt(active.gains)} kWh (davon genutzt {fmt(active.usable * 100)} %) · außen {fmt(active.temp, 1)} °C
        </p>
      )}
    </figure>
  )
}

function MonthTable({ result }) {
  const { months, totals } = result
  return (
    <div className="table-wrap energy-table">
      <table>
        <thead>
          <tr>
            <th>Monat</th>
            <th className="num">außen °C</th>
            <th className="num">Transmission</th>
            <th className="num">Lüftung</th>
            <th className="num">innere Gew.</th>
            <th className="num">solare Gew.</th>
            <th className="num">Nutzung</th>
            <th className="num">Heizwärme</th>
          </tr>
        </thead>
        <tbody>
          {months.map((month) => (
            <tr key={month.month}>
              <td>{MONTHS[month.month]}</td>
              <td className="num">{fmt(month.temp, 1)}</td>
              <td className="num">{fmt(month.transmission)}</td>
              <td className="num">{fmt(month.ventilation)}</td>
              <td className="num">{fmt(month.internal)}</td>
              <td className="num">{fmt(month.solar)}</td>
              <td className="num">{fmt(month.usable * 100)} %</td>
              <td className="num">{fmt(month.heating)}</td>
            </tr>
          ))}
          <tr className="energy-total">
            <td>Jahr (kWh)</td>
            <td />
            <td className="num">{fmt(totals.transmission)}</td>
            <td className="num">{fmt(totals.ventilation)}</td>
            <td className="num">{fmt(totals.internal)}</td>
            <td className="num">{fmt(totals.solar)}</td>
            <td />
            <td className="num">{fmt(totals.heating)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// Yearly losses per kind of building part, ventilation and thermal
// bridges, as bars of their share.
function Breakdown({ result }) {
  const total = result.breakdown.reduce((sum, item) => sum + item.kwh, 0)
  const max = Math.max(1, ...result.breakdown.map((item) => item.kwh))
  return (
    <>
      <ul className="energy-breakdown">
        {result.breakdown.map((item) => (
          <li key={item.name}>
            <span className="energy-breakdown-name">{item.name}</span>
            <span className="energy-breakdown-track">
              <span className="energy-breakdown-bar" style={{ width: `${(item.kwh / max) * 100}%` }} />
            </span>
            <span className="energy-breakdown-value">
              {fmt(item.kwh)} kWh <span className="muted">· {fmt((item.kwh / total) * 100)} %</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="muted stat-note">
        Verluste übers Jahr, vor Abzug der Gewinne. Gewinne im Jahr: innere {fmt(result.totals.internal)} kWh,
        solare {fmt(result.totals.solar)} kWh; genutzt wird davon nur, was die Verluste im jeweiligen Monat deckt.
      </p>
    </>
  )
}

export default EnergyResult
