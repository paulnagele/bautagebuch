import { CLIMATES } from '../../energy/climate.js'
import { MASS } from '../../energy/hwb.js'
import { fmt } from '../../energy/format.js'
import { NumberField } from './fields.jsx'

// Floor area and volume, climate, ventilation and the other inputs of
// the balance.
function BuildingSettings({ data, result, onChange }) {
  const { building, climate } = data

  function setBuilding(field) {
    return (value) => onChange((current) => ({ ...current, building: { ...current.building, [field]: value } }))
  }
  function setClimate(field) {
    return (value) => onChange((current) => ({ ...current, climate: { ...current.climate, [field]: value } }))
  }

  const preset = CLIMATES.find((item) => item.id === climate.preset) ?? CLIMATES[0]

  return (
    <details className="card energy-settings">
      <summary>
        <h2>Gebäude, Klima und Lüftung</h2>
      </summary>
      <div className="form-grid">
        <NumberField label="Bruttogrundfläche" unit="m²" value={building.bgf} onChange={setBuilding('bgf')} />
        <NumberField label="Beheiztes Volumen (brutto)" unit="m³" value={building.volume} onChange={setBuilding('volume')} />
        <label>
          Bauweise
          <select value={building.mass} onChange={(e) => setBuilding('mass')(e.target.value)}>
            {MASS.map((mass) => (
              <option key={mass.id} value={mass.id}>
                {mass.name}
              </option>
            ))}
          </select>
        </label>
        <NumberField label="Innentemperatur" unit="°C" value={building.innerTemp} onChange={setBuilding('innerTemp')} />

        <h2 className="energy-sub">Klima</h2>
        <label>
          Klimastation
          <select value={climate.preset} onChange={(e) => setClimate('preset')(e.target.value)}>
            {CLIMATES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {preset.altitude != null && (
          <NumberField
            label="Seehöhe des Hauses"
            unit="m"
            value={climate.altitude}
            placeholder={String(preset.altitude)}
            onChange={setClimate('altitude')}
            hint={
              result.climate.shift
                ? `Station ${preset.altitude} m: Temperaturen ${fmt(result.climate.shift, 1)} K`
                : `Station ${preset.altitude} m`
            }
          />
        )}
        <NumberField
          label="Normaußentemperatur"
          unit="°C"
          value={climate.designTemp}
          placeholder={fmt(result.climate.designTemp, 1)}
          onChange={setClimate('designTemp')}
          hint="Für die Heizlast"
        />

        <h2 className="energy-sub">Lüftung</h2>
        <NumberField
          label="Luftwechsel"
          unit="1/h"
          value={building.airChange}
          onChange={setBuilding('airChange')}
          hint="Fensterlüftung 0,4"
        />
        <label className="energy-check">
          <input
            type="checkbox"
            checked={Boolean(building.ventilationSystem)}
            onChange={(e) => setBuilding('ventilationSystem')(e.target.checked)}
          />
          Lüftungsanlage mit Wärmerückgewinnung
        </label>
        {building.ventilationSystem && (
          <NumberField
            label="Wärmerückgewinnung"
            unit="%"
            value={building.heatRecovery}
            onChange={setBuilding('heatRecovery')}
            hint={`Wirksamer Luftwechsel ${fmt(result.effectiveAirChange, 2)} 1/h (mit Undichtheiten 0,1)`}
          />
        )}

        <h2 className="energy-sub">Gewinne und Zuschläge</h2>
        <NumberField
          label="Innere Gewinne"
          unit="W/m²"
          value={building.internalGains}
          onChange={setBuilding('internalGains')}
          hint="Wohngebäude 3,75"
        />
        <NumberField label="Rahmenanteil Fenster" unit="%" value={building.frameShare} onChange={setBuilding('frameShare')} />
        <NumberField
          label="Verschattung"
          unit="Faktor"
          value={building.shading}
          onChange={setBuilding('shading')}
          hint="1 = keine, 0,75 = üblich"
        />
        <NumberField
          label="Wärmebrücken-Zuschlag"
          unit="%"
          value={building.thermalBridges}
          onChange={setBuilding('thermalBridges')}
          hint={`${fmt(result.lBridges, 1)} W/K`}
        />
      </div>
    </details>
  )
}

export default BuildingSettings
