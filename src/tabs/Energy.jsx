import { useEffect, useMemo, useRef, useState } from 'react'
import { loadCalculation, saveCalculation } from '../energy/energyStore.js'
import { calculate, DEFAULT_BUILDING } from '../energy/hwb.js'
import { useDialogs } from '../dialogs.js'
import EnergyResult from '../components/energy/EnergyResult.jsx'
import ModelImport from '../components/energy/ModelImport.jsx'
import BuildingSettings from '../components/energy/BuildingSettings.jsx'
import PartTypes from '../components/energy/PartTypes.jsx'
import PartList from '../components/energy/PartList.jsx'

const SAVE_DELAY_MS = 800

function emptyCalculation() {
  return {
    building: { ...DEFAULT_BUILDING },
    climate: { preset: 'reference', altitude: '', designTemp: '' },
    types: {},
    elements: [],
    source: null,
  }
}

// The Heizwärme tab: heating demand (HWB) and heating load of the house,
// from its building parts, climate and ventilation. Areas can be taken
// from the house model; everything can be changed by hand. Changes are
// saved shortly after typing.
function Energy() {
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [saveState, setSaveState] = useState({ status: 'idle', error: '' })
  const pending = useRef(null)
  const timer = useRef(null)
  const dialogs = useDialogs()

  useEffect(() => {
    let cancelled = false
    loadCalculation()
      .then((saved) => {
        if (cancelled) return
        const base = emptyCalculation()
        setData(
          saved
            ? {
                ...base,
                ...saved,
                building: { ...base.building, ...saved.building },
                climate: { ...base.climate, ...saved.climate },
              }
            : base,
        )
      })
      .catch((error) => !cancelled && setLoadError(error.message))
    return () => {
      cancelled = true
    }
  }, [])

  async function flush() {
    clearTimeout(timer.current)
    const next = pending.current
    if (!next) return
    pending.current = null
    setSaveState({ status: 'saving', error: '' })
    try {
      await saveCalculation(next)
      setSaveState((state) => (pending.current ? state : { status: 'saved', error: '' }))
    } catch (error) {
      setSaveState({ status: 'error', error: error.message })
    }
  }

  // Save what is left when the tab is closed.
  useEffect(() => () => flush(), [])

  function change(update) {
    setData((current) => {
      const next = typeof update === 'function' ? update(current) : update
      pending.current = next
      clearTimeout(timer.current)
      timer.current = setTimeout(flush, SAVE_DELAY_MS)
      return next
    })
    setSaveState({ status: 'pending', error: '' })
  }

  const result = useMemo(() => (data ? calculate(data) : null), [data])

  if (loadError) {
    return (
      <section className="tab-content">
        <p className="error" role="alert">
          {loadError}
        </p>
      </section>
    )
  }
  if (!data) return <p className="empty">Wird geladen…</p>

  async function importParts({ elements, bgf, volume, source }) {
    const hasModelRows = data.elements.some((element) => element.source === 'model')
    if (hasModelRows) {
      const ok = await dialogs.confirm(
        'Die aus dem Modell übernommenen Bauteile werden ersetzt. Selbst angelegte Bauteile und geänderte Werte bei den Aufbauten bleiben.',
        { confirmLabel: 'Übernehmen' },
      )
      if (!ok) return false
    }
    change((current) => ({
      ...current,
      elements: [
        ...elements.map((element, i) => ({ ...element, id: `m${Date.now()}-${i}` })),
        ...current.elements.filter((element) => element.source !== 'model'),
      ],
      building: { ...current.building, bgf, volume },
      source,
    }))
    return true
  }

  return (
    <section className="tab-content energy">
      <EnergyResult result={result} building={data.building} saveState={saveState} onRetrySave={() => change((d) => ({ ...d }))} />
      <ModelImport source={data.source} empty={data.elements.length === 0} onImport={importParts} />
      <PartList data={data} result={result} onChange={change} />
      <PartTypes types={data.types} onChange={(types) => change((current) => ({ ...current, types }))} />
      <BuildingSettings data={data} result={result} onChange={change} />
      <p className="muted energy-note">
        Vereinfachte Monatsbilanz nach dem Vorbild von ÖNORM B 8110-6 und OIB-Richtlinie 6: Verluste über die
        Bauteile (A · U · f) und durch Lüftung, abzüglich der nutzbaren inneren und solaren Gewinne. Eine
        Abschätzung für die Planung, kein Energieausweis. Die Klimadaten sind gerundete Richtwerte.
      </p>
    </section>
  )
}

export default Energy
