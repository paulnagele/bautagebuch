import { PART_TYPES, typeValues } from '../../energy/hwb.js'
import { sideName } from '../../energy/fromModel.js'
import { fmt } from '../../energy/format.js'

// The building parts around the heated rooms: area, kind (which sets
// the U-value and correction factor), orientation of windows (for the
// sun) and an optional U-value of their own.
function PartList({ data, result, onChange }) {
  const elements = data.elements

  function update(id, fields) {
    onChange((current) => ({
      ...current,
      elements: current.elements.map((element) => (element.id === id ? { ...element, ...fields } : element)),
    }))
  }

  function remove(id) {
    onChange((current) => ({ ...current, elements: current.elements.filter((element) => element.id !== id) }))
  }

  function add() {
    onChange((current) => ({
      ...current,
      elements: [...current.elements, { id: `h${Date.now()}`, name: '', type: 'wall', area: '', source: 'manual' }],
    }))
  }

  const totalArea = result.parts.reduce((sum, part) => sum + part.area, 0)

  return (
    <div className="card energy-parts">
      <h2>Bauteile</h2>
      <p className="muted stat-note">
        Fläche in m², bei Fenstern die Ausrichtung in Grad (0 = Nord, 90 = Ost, 180 = Süd, 270 = West). Ein eigener
        U-Wert gilt nur für diese Zeile, sonst der Wert der Bauteilart unten.
      </p>
      {elements.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Bauteil</th>
                <th>Art</th>
                <th className="num">Fläche</th>
                <th className="num">Richtung</th>
                <th className="num">U eigen</th>
                <th className="num">W/K</th>
                <th aria-label="Aktionen" />
              </tr>
            </thead>
            <tbody>
              {elements.map((element, i) => {
                const values = typeValues(data.types, element.type)
                const part = result.parts[i]
                return (
                  <tr key={element.id}>
                    <td>
                      <input
                        className="energy-name"
                        value={element.name}
                        placeholder={values.name}
                        aria-label="Bauteil"
                        onChange={(e) => update(element.id, { name: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        value={element.type}
                        aria-label="Art"
                        onChange={(e) => update(element.id, { type: e.target.value })}
                      >
                        {PART_TYPES.map((type) => (
                          <option key={type.id} value={type.id}>
                            {type.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="num">
                      <input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min="0"
                        className="energy-num"
                        value={element.area ?? ''}
                        aria-label="Fläche in m²"
                        onChange={(e) => update(element.id, { area: e.target.value })}
                      />
                    </td>
                    <td className="num">
                      {values.glazed ? (
                        <span className="energy-azimuth">
                          <input
                            type="number"
                            inputMode="numeric"
                            step="1"
                            className="energy-num"
                            value={element.azimuth ?? ''}
                            aria-label="Ausrichtung in Grad"
                            onChange={(e) => update(element.id, { azimuth: e.target.value })}
                          />
                          <span className="muted">
                            {element.azimuth !== '' && element.azimuth != null ? sideName(Number(element.azimuth)) : ''}
                          </span>
                        </span>
                      ) : (
                        <span className="muted">–</span>
                      )}
                    </td>
                    <td className="num">
                      <input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min="0"
                        className="energy-num"
                        value={element.u ?? ''}
                        placeholder={fmt(values.u, 2)}
                        aria-label="Eigener U-Wert"
                        onChange={(e) => update(element.id, { u: e.target.value })}
                      />
                    </td>
                    <td className="num">{part ? fmt(part.conductance, 1) : ''}</td>
                    <td>
                      <button type="button" className="link danger" onClick={() => remove(element.id)} aria-label="Bauteil entfernen">
                        ✕
                      </button>
                    </td>
                  </tr>
                )
              })}
              <tr className="energy-total">
                <td colSpan={2}>Hüllfläche</td>
                <td className="num">{fmt(totalArea, 1)} m²</td>
                <td colSpan={2} />
                <td className="num">{fmt(result.lParts, 1)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <div className="form-actions">
        <button type="button" className="secondary" onClick={add}>
          + Bauteil
        </button>
      </div>
    </div>
  )
}

export default PartList
