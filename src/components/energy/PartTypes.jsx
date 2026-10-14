import { useState } from 'react'
import { PART_TYPES, typeValues } from '../../energy/hwb.js'
import { fmt } from '../../energy/format.js'

// Common materials for the layer calculator (λ in W/mK, rounded).
const MATERIALS = [
  ['Innenputz', 0.7],
  ['Außenputz', 0.8],
  ['Ziegel (Hochlochziegel)', 0.25],
  ['Ziegel (Vollziegel)', 0.8],
  ['Beton', 2.3],
  ['Holzfaserdämmung', 0.042],
  ['EPS', 0.035],
  ['XPS', 0.035],
  ['Mineralwolle', 0.035],
  ['Zellulose', 0.04],
  ['Holz (Nadelholz)', 0.13],
  ['Estrich', 1.4],
  ['Trittschalldämmung', 0.04],
]

// U-values per kind of building part: entered directly or worked out
// from the layers of the build-up (U = 1 / (Rsi + Σ d/λ + Rse)).
function PartTypes({ types, onChange }) {
  const [openId, setOpenId] = useState(null)

  function set(id, fields) {
    onChange({ ...types, [id]: { ...types[id], ...fields } })
  }

  return (
    <details className="card energy-types">
      <summary>
        <h2>Aufbauten und U-Werte</h2>
      </summary>
      <ul className="energy-type-list">
        {PART_TYPES.map((type) => {
          const own = types[type.id] ?? {}
          const values = typeValues(types, type.id)
          const layers = own.layers ?? []
          const open = openId === type.id
          return (
            <li key={type.id}>
              <div className="energy-type-row">
                <span className="energy-type-name">
                  {type.name}
                  <span className="muted stat-note"> · f = {fmt(type.f, 1)}</span>
                </span>
                <label>
                  U <span className="muted">(W/m²K)</span>
                  {values.fromLayers ? (
                    <strong className="energy-u">{fmt(values.u, 3)}</strong>
                  ) : (
                    <input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min="0"
                      className="energy-num"
                      value={own.u ?? ''}
                      placeholder={fmt(type.u, 2)}
                      onChange={(e) => set(type.id, { u: e.target.value })}
                    />
                  )}
                </label>
                {type.glazed ? (
                  <label>
                    g-Wert
                    <input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min="0"
                      max="1"
                      className="energy-num"
                      value={own.g ?? ''}
                      placeholder={fmt(type.g, 2)}
                      onChange={(e) => set(type.id, { g: e.target.value })}
                    />
                  </label>
                ) : (
                  <button type="button" className="link" onClick={() => setOpenId(open ? null : type.id)}>
                    {open ? 'Schichten schließen' : layers.length ? `${layers.length} Schichten` : 'Aus Schichten berechnen'}
                  </button>
                )}
              </div>
              {open && <Layers layers={layers} onChange={(next) => set(type.id, { layers: next })} />}
            </li>
          )
        })}
      </ul>
    </details>
  )
}

function Layers({ layers, onChange }) {
  function update(i, fields) {
    onChange(layers.map((layer, j) => (j === i ? { ...layer, ...fields } : layer)))
  }

  return (
    <div className="energy-layers">
      <datalist id="energy-materials">
        {MATERIALS.map(([name]) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {layers.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Schicht (innen → außen)</th>
              <th className="num">Dicke cm</th>
              <th className="num">λ W/mK</th>
              <th className="num">R m²K/W</th>
              <th aria-label="Aktionen" />
            </tr>
          </thead>
          <tbody>
            {layers.map((layer, i) => (
              <tr key={i}>
                <td>
                  <input
                    className="energy-name"
                    list="energy-materials"
                    value={layer.name}
                    aria-label="Material"
                    onChange={(e) => {
                      const known = MATERIALS.find(([name]) => name === e.target.value)
                      update(i, known ? { name: known[0], lambda: known[1] } : { name: e.target.value })
                    }}
                  />
                </td>
                <td className="num">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    className="energy-num"
                    value={layer.d ?? ''}
                    aria-label="Dicke in cm"
                    onChange={(e) => update(i, { d: e.target.value })}
                  />
                </td>
                <td className="num">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    className="energy-num"
                    value={layer.lambda ?? ''}
                    aria-label="Wärmeleitfähigkeit λ"
                    onChange={(e) => update(i, { lambda: e.target.value })}
                  />
                </td>
                <td className="num">
                  {Number(layer.d) > 0 && Number(layer.lambda) > 0 ? fmt(Number(layer.d) / 100 / Number(layer.lambda), 2) : '–'}
                </td>
                <td>
                  <button
                    type="button"
                    className="link danger"
                    aria-label="Schicht entfernen"
                    onClick={() => onChange(layers.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button type="button" className="secondary" onClick={() => onChange([...layers, { name: '', d: '', lambda: '' }])}>
        + Schicht
      </button>
    </div>
  )
}

export default PartTypes
