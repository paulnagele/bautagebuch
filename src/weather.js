// The weather on the building site on a given day, for Status entries.
// Data from Open-Meteo (free, no key): https://open-meteo.com
//
// Where the site is: app_settings key `site_location`, either a place name
// ("Leonding") or coordinates ("48.27, 14.25"). Without it, the device's
// own location is used (the browser asks once).
import { getSetting } from './settings.js'
import { today } from './storage.js'

const FORECAST_API = 'https://api.open-meteo.com/v1/forecast'
const ARCHIVE_API = 'https://archive-api.open-meteo.com/v1/archive'
const GEOCODING_API = 'https://geocoding-api.open-meteo.com/v1/search'
// The forecast API also has the last three months; older days come from
// the archive.
const FORECAST_PAST_DAYS = 90
const FORECAST_DAYS = 15

let coordsRequest = null
const dayRequests = new Map()

function parseCoords(text) {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text)
  return match ? { latitude: Number(match[1]), longitude: Number(match[2]) } : null
}

async function geocode(name) {
  const url = `${GEOCODING_API}?count=1&language=de&name=${encodeURIComponent(name)}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Ortssuche fehlgeschlagen (${response.status}).`)
  const place = (await response.json()).results?.[0]
  if (!place) throw new Error(`Der Ort „${name}“ wurde nicht gefunden.`)
  return { latitude: place.latitude, longitude: place.longitude }
}

function deviceCoords() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Kein Standort verfügbar.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
      () => reject(new Error('Der Standort wurde nicht freigegeben.')),
      { maximumAge: 24 * 60 * 60 * 1000, timeout: 15000 },
    )
  })
}

async function siteCoords() {
  let setting = null
  try {
    setting = await getSetting('site_location', 'der Ort der Baustelle')
  } catch {
    // Not set up (or not loadable): use where the device is.
  }
  if (!setting) return deviceCoords()
  return parseCoords(setting) ?? geocode(setting)
}

function getCoords() {
  if (!coordsRequest) {
    coordsRequest = siteCoords()
    coordsRequest.catch(() => {
      coordsRequest = null
    })
  }
  return coordsRequest
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// One of the diary's weather choices (see diaryForm.js WEATHER_LABELS)
// from the day's WMO weather code, wind and temperatures. Snow and rain
// matter most on a building site, then wind and frost.
// https://open-meteo.com/en/docs#weather_variable_documentation
export function weatherChoice({ code, windMax, tempMin, tempMax }) {
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'Snow'
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return 'Rain'
  if (windMax >= 40) return 'Wind'
  if (tempMin < 0 || tempMax <= 0) return 'Frost'
  if (code >= 2) return 'Cloudy'
  return 'Sunny'
}

async function loadDay(date) {
  const { latitude, longitude } = await getCoords()
  const now = today()
  if (date > addDays(now, FORECAST_DAYS)) return null
  const api = date >= addDays(now, -FORECAST_PAST_DAYS) ? FORECAST_API : ARCHIVE_API
  const params = new URLSearchParams({
    latitude: latitude.toFixed(3),
    longitude: longitude.toFixed(3),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,wind_speed_10m_max',
    timezone: 'auto',
    start_date: date,
    end_date: date,
  })
  const response = await fetch(`${api}?${params}`)
  if (!response.ok) throw new Error(`Wetterdaten nicht verfügbar (${response.status}).`)
  const { daily } = await response.json()
  const code = daily?.weather_code?.[0]
  const tempMax = daily?.temperature_2m_max?.[0]
  const tempMin = daily?.temperature_2m_min?.[0]
  if (code == null || tempMax == null || tempMin == null) return null
  const windMax = daily.wind_speed_10m_max?.[0] ?? 0
  return { weather: weatherChoice({ code, windMax, tempMin, tempMax }) }
}

// { weather } for the site on that day, or null when there is
// no data for it (e.g. too far ahead). Rejects when the site's location or
// the weather can't be loaded.
export function siteWeather(date) {
  if (!dayRequests.has(date)) {
    const request = loadDay(date)
    request.catch(() => dayRequests.delete(date))
    dayRequests.set(date, request)
  }
  return dayRequests.get(date)
}
