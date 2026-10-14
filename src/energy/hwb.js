// Heating demand (Heizwärmebedarf, HWB) of the building: a simplified
// monthly balance in the style of ÖNORM B 8110-6 / OIB-Richtlinie 6.
// Losses through the building parts and by ventilation minus the usable
// internal and solar gains, month by month. Also the heating load
// (Heizlast) at the design temperature. An estimate for planning, not
// an Energieausweis.
import { MONTH_DAYS, siteClimate, surfaceRadiation } from './climate.js'

// Kinds of building parts. `f` is the temperature correction factor
// (1 = against outside air), `rsi`/`rse` the surface resistances used
// when the U-value is worked out from layers.
export const PART_TYPES = [
  { id: 'wall', name: 'Außenwand', u: 0.25, f: 1, rsi: 0.13, rse: 0.04 },
  { id: 'groundWall', name: 'Kellerwand (erdberührt)', u: 0.4, f: 0.7, rsi: 0.13, rse: 0 },
  { id: 'window', name: 'Fenster', u: 0.9, g: 0.5, f: 1, glazed: true },
  { id: 'door', name: 'Außentür', u: 1.2, f: 1 },
  { id: 'roof', name: 'Dachschräge', u: 0.15, f: 1, rsi: 0.1, rse: 0.04 },
  { id: 'topCeiling', name: 'Oberste Geschossdecke', u: 0.15, f: 0.9, rsi: 0.1, rse: 0.1 },
  { id: 'cellarCeiling', name: 'Decke zum unbeheizten Keller', u: 0.35, f: 0.7, rsi: 0.17, rse: 0.17 },
  { id: 'groundFloor', name: 'Boden erdberührt', u: 0.35, f: 0.7, rsi: 0.17, rse: 0 },
]

export const partType = (id) => PART_TYPES.find((type) => type.id === id) ?? PART_TYPES[0]

// Thermal capacity per m³ of heated gross volume (Wh/m³K).
export const MASS = [
  { id: 'light', name: 'leicht (Holzbau)', capacity: 10 },
  { id: 'medium', name: 'mittelschwer', capacity: 20 },
  { id: 'heavy', name: 'schwer (Massivbau)', capacity: 30 },
]

const AIR_HEAT = 0.34 // Wh/m³K
const NET_VOLUME_SHARE = 0.8 // ventilated net volume / gross volume
const INFILTRATION_WITH_SYSTEM = 0.1 // 1/h, leaks while a ventilation system runs
const SOLAR_INCIDENCE = 0.9 // radiation not perpendicular to the glass

// Classes as on the Energieausweis (HWB, kWh/m²a).
const CLASSES = [
  ['A++', 10],
  ['A+', 15],
  ['A', 25],
  ['B', 50],
  ['C', 100],
  ['D', 150],
  ['E', 200],
  ['F', 250],
]

export function energyClass(hwb) {
  return CLASSES.find(([, limit]) => hwb <= limit)?.[0] ?? 'G'
}

export const DEFAULT_BUILDING = {
  bgf: 0,
  volume: 0,
  mass: 'heavy',
  airChange: 0.4,
  ventilationSystem: false,
  heatRecovery: 80,
  innerTemp: 20,
  internalGains: 3.75,
  thermalBridges: 10,
  frameShare: 30,
  shading: 0.75,
}

// Thermal resistance and U-value of a layered build-up (thickness in cm,
// lambda in W/mK). Null when no layer is usable.
export function layersU(type, layers) {
  const usable = (layers ?? []).filter((layer) => Number(layer.d) > 0 && Number(layer.lambda) > 0)
  if (usable.length === 0) return null
  const r = usable.reduce((sum, layer) => sum + Number(layer.d) / 100 / Number(layer.lambda), 0)
  return 1 / ((type.rsi ?? 0.13) + r + (type.rse ?? 0.04))
}

// The U-value (and g-value for glazing) in use for a kind of part:
// from its layers if any, else the entered value, else the default.
export function typeValues(types, id) {
  const type = partType(id)
  const own = types?.[id] ?? {}
  const fromLayers = type.glazed ? null : layersU(type, own.layers)
  return {
    ...type,
    u: fromLayers ?? num(own.u, type.u),
    g: type.glazed ? num(own.g, type.g) : 0,
    fromLayers: fromLayers != null,
  }
}

function num(value, fallback) {
  const n = Number(value)
  return value === '' || value == null || !Number.isFinite(n) ? fallback : n
}

// The whole calculation. `data` is the saved calculation (see
// energyStore.js); returns the conductances, the monthly balance, the
// yearly sums, HWB and heating load.
export function calculate(data) {
  const building = { ...DEFAULT_BUILDING, ...data.building }
  const climate = siteClimate(data.climate ?? {})
  const bgf = num(building.bgf, 0)
  const volume = num(building.volume, 0)
  const innerTemp = num(building.innerTemp, 20)

  // Transmission: per part A·U·f, plus a surcharge for thermal bridges.
  const radiationByAzimuth = new Map()
  const parts = (data.elements ?? []).map((element) => {
    const values = typeValues(data.types, element.type)
    const area = Math.max(0, num(element.area, 0))
    const u = element.u != null && element.u !== '' ? num(element.u, values.u) : values.u
    const conductance = area * u * values.f
    let solar = null
    if (values.glazed && element.azimuth != null && element.azimuth !== '') {
      const key = `${Math.round(Number(element.azimuth))}/${num(element.tilt, 90)}`
      if (!radiationByAzimuth.has(key)) {
        radiationByAzimuth.set(key, surfaceRadiation(climate, Number(element.azimuth), num(element.tilt, 90)))
      }
      const aperture =
        area *
        (1 - num(building.frameShare, 30) / 100) *
        values.g *
        SOLAR_INCIDENCE *
        num(building.shading, 0.75)
      solar = radiationByAzimuth.get(key).map((radiation) => aperture * radiation)
    }
    return { ...element, area, u, f: values.f, typeName: values.name, conductance, solar }
  })
  const envelope = parts.reduce((sum, part) => sum + part.area, 0)
  const lParts = parts.reduce((sum, part) => sum + part.conductance, 0)
  const lBridges = (lParts * num(building.thermalBridges, 0)) / 100
  const lT = lParts + lBridges

  // Ventilation: 0.34 · n · net volume; with a heat recovery system only
  // what the exchanger doesn't recover, plus some infiltration.
  const airChange = num(building.airChange, 0.4)
  const effectiveAirChange = building.ventilationSystem
    ? airChange * (1 - num(building.heatRecovery, 0) / 100) + INFILTRATION_WITH_SYSTEM
    : airChange
  const lV = AIR_HEAT * effectiveAirChange * NET_VOLUME_SHARE * volume

  const capacity = (MASS.find((mass) => mass.id === building.mass) ?? MASS[2]).capacity * volume // Wh/K
  const lTotal = lT + lV
  const tau = lTotal > 0 ? capacity / lTotal : 0 // h
  const a = 1 + tau / 16

  const months = climate.temps.map((temp, month) => {
    const hours = MONTH_DAYS[month] * 24
    const delta = Math.max(0, innerTemp - temp)
    const transmission = (lT * delta * hours) / 1000 // kWh
    const ventilation = (lV * delta * hours) / 1000
    const internal = (num(building.internalGains, 3.75) * bgf * hours) / 1000
    const solar = parts.reduce((sum, part) => sum + (part.solar ? part.solar[month] : 0), 0)
    const losses = transmission + ventilation
    const gains = internal + solar
    const ratio = losses > 0 ? gains / losses : Infinity
    const usable = utilisation(ratio, a)
    const heating = Math.max(0, losses - usable * gains)
    return { month, temp, transmission, ventilation, internal, solar, losses, gains, usable, heating }
  })

  const sum = (key) => months.reduce((total, month) => total + month[key], 0)
  const heating = sum('heating')
  const hwb = bgf > 0 ? heating / bgf : 0
  const loadW = lTotal * (innerTemp - climate.designTemp)

  // Yearly losses per kind of part, for the breakdown.
  const degreeHours = months.reduce(
    (total, month) => total + (Math.max(0, innerTemp - month.temp) * MONTH_DAYS[month.month] * 24) / 1000,
    0,
  )
  const byType = new Map()
  for (const part of parts) {
    byType.set(part.typeName, (byType.get(part.typeName) ?? 0) + part.conductance * degreeHours)
  }
  const breakdown = [...byType]
    .map(([name, kwh]) => ({ name, kwh }))
    .concat(lBridges > 0 ? [{ name: 'Wärmebrücken', kwh: lBridges * degreeHours }] : [])
    .concat(lV > 0 ? [{ name: 'Lüftung', kwh: lV * degreeHours }] : [])
    .sort((x, y) => y.kwh - x.kwh)

  return {
    climate,
    parts,
    envelope,
    lParts,
    lBridges,
    lT,
    lV,
    effectiveAirChange,
    meanU: envelope > 0 ? lParts / envelope : 0,
    compactness: volume > 0 ? envelope / volume : 0,
    months,
    totals: {
      transmission: sum('transmission'),
      ventilation: sum('ventilation'),
      internal: sum('internal'),
      solar: sum('solar'),
      heating,
    },
    breakdown,
    hwb,
    energyClass: energyClass(hwb),
    loadKw: loadW / 1000,
    loadPerM2: bgf > 0 ? loadW / bgf : 0,
  }
}

// Share of the gains that lowers the heating demand (EN ISO 13790).
function utilisation(ratio, a) {
  if (!Number.isFinite(ratio)) return 0
  if (Math.abs(ratio - 1) < 1e-6) return a / (a + 1)
  return (1 - ratio ** a) / (1 - ratio ** (a + 1))
}
