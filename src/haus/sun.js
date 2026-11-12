// Where the sun stands for a place and a moment, close enough for shadows
// in the house model (about 0.1°; the formulas SunCalc and the NOAA tables
// use).
//
// sunPosition(date, lat, lon) -> { altitude, azimuth } in degrees:
//   altitude above the horizon (negative = below it),
//   azimuth clockwise from north (90 = east, 180 = south, 270 = west).
// sunTimes(day, lat, lon) -> { rise, noon, set } as Dates on that local
//   calendar day (rise/set null when the sun doesn't cross the horizon).

const RAD = Math.PI / 180
const J2000 = 10957.5 // days from 1970-01-01 00:00 UTC to 2000-01-01 12:00 UTC
const OBLIQUITY = 23.4397 * RAD

export function sunPosition(date, lat, lon) {
  const d = date.getTime() / 86400000 - J2000
  const M = (357.5291 + 0.98560028 * d) * RAD // mean anomaly
  const C = (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) * RAD
  const L = M + C + 102.9372 * RAD + Math.PI // ecliptic longitude
  const dec = Math.asin(Math.sin(OBLIQUITY) * Math.sin(L))
  const ra = Math.atan2(Math.sin(L) * Math.cos(OBLIQUITY), Math.cos(L))
  const H = (280.16 + 360.9856235 * d + lon) * RAD - ra // hour angle
  const phi = lat * RAD
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H))
  const azSouth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi))
  return { altitude: alt / RAD, azimuth: ((azSouth / RAD + 180) % 360 + 360) % 360 }
}

// The sun's disc touches the horizon at -0.833° (refraction + radius).
const HORIZON = -0.833

export function sunTimes(day, lat, lon) {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate())
  const at = (min) => new Date(start.getTime() + min * 60000)
  const alt = (min) => sunPosition(at(min), lat, lon).altitude - HORIZON
  // bisect a sign change between two minutes down to a few seconds
  const cross = (a, b) => {
    let fa = alt(a)
    for (let i = 0; i < 12; i++) {
      const m = (a + b) / 2, fm = alt(m)
      if (Math.sign(fm) === Math.sign(fa)) { a = m; fa = fm } else b = m
    }
    return at((a + b) / 2)
  }
  let rise = null, set = null, noon = at(720), best = -Infinity
  const STEP = 10
  let prev = alt(0)
  for (let m = STEP; m <= 1440; m += STEP) {
    const cur = alt(m)
    if (prev < 0 && cur >= 0 && !rise) rise = cross(m - STEP, m)
    if (prev >= 0 && cur < 0) set = cross(m - STEP, m)
    if (cur > best) { best = cur; noon = at(m) }
    prev = cur
  }
  return { rise, noon, set }
}

const DIRS = ['Nord', 'Nordnordost', 'Nordost', 'Ostnordost', 'Ost', 'Ostsüdost', 'Südost', 'Südsüdost',
  'Süd', 'Südsüdwest', 'Südwest', 'Westsüdwest', 'West', 'Westnordwest', 'Nordwest', 'Nordnordwest']

// "Südsüdwest" for an azimuth in degrees
export function compassName(azimuth) {
  return DIRS[Math.round(azimuth / 22.5) % 16]
}
