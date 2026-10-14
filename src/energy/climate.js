// Climate data for the heating demand (Heizwärme tab): monthly mean
// outdoor temperatures and global radiation on a horizontal surface,
// rounded long-term means for a few Austrian stations plus the OIB
// reference climate. They are guide values for an estimate, not the
// official site climate of an Energieausweis.

export const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
export const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

// temps: °C per month; radiation: kWh/m² per month on a horizontal
// surface; altitude: m above sea level; designTemp: Normaußentemperatur
// for the heating load (°C).
export const CLIMATES = [
  {
    id: 'reference',
    name: 'Referenzklima (OIB)',
    latitude: 47.5,
    altitude: null,
    designTemp: -12,
    temps: [-1.53, 0.73, 4.81, 9.62, 14.2, 17.33, 19.12, 18.56, 15.03, 9.64, 4.17, 0.04],
    radiation: [31, 50, 86, 116, 151, 158, 164, 140, 99, 64, 32, 24],
  },
  {
    id: 'wien',
    name: 'Wien',
    latitude: 48.2,
    altitude: 200,
    designTemp: -12,
    temps: [0.3, 1.9, 6.0, 11.0, 15.5, 19.1, 21.0, 20.6, 15.8, 10.4, 5.3, 1.1],
    radiation: [30, 51, 90, 128, 160, 168, 172, 148, 104, 66, 32, 23],
  },
  {
    id: 'graz',
    name: 'Graz',
    latitude: 47.07,
    altitude: 366,
    designTemp: -12,
    temps: [-0.7, 1.2, 5.5, 10.4, 15.1, 18.7, 20.4, 19.8, 15.1, 9.8, 4.5, 0.2],
    radiation: [38, 58, 96, 127, 157, 164, 172, 148, 104, 70, 38, 29],
  },
  {
    id: 'linz',
    name: 'Linz',
    latitude: 48.3,
    altitude: 262,
    designTemp: -13,
    temps: [-0.3, 1.2, 5.4, 10.3, 14.9, 18.4, 20.2, 19.7, 15.0, 9.9, 4.6, 0.6],
    radiation: [30, 50, 88, 124, 157, 164, 170, 146, 102, 63, 31, 22],
  },
  {
    id: 'salzburg',
    name: 'Salzburg',
    latitude: 47.8,
    altitude: 430,
    designTemp: -13,
    temps: [-0.6, 0.6, 4.9, 9.4, 14.2, 17.5, 19.3, 18.9, 14.6, 10.0, 4.6, 0.6],
    radiation: [34, 53, 89, 121, 150, 154, 160, 138, 100, 66, 34, 26],
  },
  {
    id: 'innsbruck',
    name: 'Innsbruck',
    latitude: 47.27,
    altitude: 578,
    designTemp: -14,
    temps: [-1.6, 0.4, 5.1, 9.6, 14.2, 17.5, 19.1, 18.6, 14.6, 9.6, 3.8, -0.8],
    radiation: [38, 60, 98, 128, 155, 161, 166, 144, 110, 74, 39, 30],
  },
  {
    id: 'klagenfurt',
    name: 'Klagenfurt',
    latitude: 46.65,
    altitude: 447,
    designTemp: -15,
    temps: [-3.4, -1.0, 4.1, 9.4, 14.4, 18.1, 19.9, 19.3, 14.6, 8.9, 3.2, -2.0],
    radiation: [39, 62, 103, 132, 163, 170, 178, 152, 108, 70, 37, 28],
  },
]

// Temperatures drop about 0.5 K per 100 m of altitude.
const LAPSE_PER_M = 0.005

// The climate of a preset at the site's altitude (if given): monthly
// temperatures and the design temperature shifted by the height
// difference. `designTemp` overrides the shifted design temperature.
export function siteClimate({ preset, altitude, designTemp }) {
  const base = CLIMATES.find((climate) => climate.id === preset) ?? CLIMATES[0]
  const shift = base.altitude != null && altitude != null && altitude !== '' ? -LAPSE_PER_M * (altitude - base.altitude) : 0
  return {
    ...base,
    temps: base.temps.map((t) => t + shift),
    designTemp: designTemp != null && designTemp !== '' ? Number(designTemp) : round1(base.designTemp + shift),
    shift,
  }
}

function round1(value) {
  return Math.round(value * 10) / 10
}

// Average day of each month (Klein), used for the sun's position.
const MEAN_DAY = [17, 47, 75, 105, 135, 162, 198, 228, 258, 288, 318, 344]
const SOLAR_CONSTANT = 1367 // W/m²
const GROUND_REFLECTANCE = 0.2
const rad = (deg) => (deg * Math.PI) / 180

// Monthly solar radiation (kWh/m²) on a surface with the given tilt
// (90 = vertical) and compass azimuth (0 = north, 90 = east, 180 =
// south). Splits the horizontal radiation into direct and diffuse
// (Erbs), spreads it over the average day (Collares-Pereira & Rabl,
// Liu & Jordan) and sums it on the surface (isotropic sky).
export function surfaceRadiation(climate, azimuth, tilt = 90) {
  const phi = rad(climate.latitude)
  const beta = rad(tilt)
  const gamma = rad(azimuth - 180) // 0 = south, west positive
  return MEAN_DAY.map((n, month) => {
    const delta = rad(23.45 * Math.sin(rad((360 * (284 + n)) / 365)))
    const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(delta))))
    const h0 =
      (24 / Math.PI) *
      SOLAR_CONSTANT *
      (1 + 0.033 * Math.cos(rad((360 * n) / 365))) *
      (Math.cos(phi) * Math.cos(delta) * Math.sin(ws) + ws * Math.sin(phi) * Math.sin(delta))
    const h = (climate.radiation[month] * 1000) / MONTH_DAYS[month] // Wh/m² per day
    const kt = Math.min(0.8, h / h0)
    const diffuseShare =
      ws <= rad(81.4)
        ? 1.391 - 3.56 * kt + 4.189 * kt ** 2 - 2.137 * kt ** 3
        : 1.311 - 3.022 * kt + 3.427 * kt ** 2 - 1.821 * kt ** 3
    const hd = h * diffuseShare
    const a = 0.409 + 0.5016 * Math.sin(ws - rad(60))
    const b = 0.6609 - 0.4767 * Math.sin(ws - rad(60))
    const norm = Math.sin(ws) - ws * Math.cos(ws)
    const steps = 96
    const dw = (2 * ws) / steps
    let day = 0 // Wh/m² on the surface
    for (let i = 0; i < steps; i++) {
      const w = -ws + (i + 0.5) * dw
      const hours = (dw * 12) / Math.PI
      const shape = ((Math.PI / 24) * (Math.cos(w) - Math.cos(ws))) / norm
      const total = shape * (a + b * Math.cos(w)) * h
      const diffuse = Math.min(total, shape * hd)
      const beam = total - diffuse
      const cosZenith = Math.cos(phi) * Math.cos(delta) * Math.cos(w) + Math.sin(phi) * Math.sin(delta)
      const cosIncidence =
        Math.sin(delta) * Math.sin(phi) * Math.cos(beta) -
        Math.sin(delta) * Math.cos(phi) * Math.sin(beta) * Math.cos(gamma) +
        Math.cos(delta) * Math.cos(phi) * Math.cos(beta) * Math.cos(w) +
        Math.cos(delta) * Math.sin(phi) * Math.sin(beta) * Math.cos(gamma) * Math.cos(w) +
        Math.cos(delta) * Math.sin(beta) * Math.sin(gamma) * Math.sin(w)
      const direct = cosZenith > 0.02 ? (beam * Math.max(0, cosIncidence)) / cosZenith : 0
      day +=
        (direct +
          (diffuse * (1 + Math.cos(beta))) / 2 +
          (total * GROUND_REFLECTANCE * (1 - Math.cos(beta))) / 2) *
        hours
    }
    return (day * MONTH_DAYS[month]) / 1000
  })
}
