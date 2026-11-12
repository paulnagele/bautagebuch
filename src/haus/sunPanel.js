// "Datum & Uhrzeit" in the Haus viewer's upper right corner: a button that
// shows the chosen moment and opens a small card with a date field, a time
// slider and quick picks. The viewer turns the moment into the sun's
// position (sun.js) and switches the lamps on after dark.
//
// mountSunPanel(button, card, { lat, lon, onChange }) -> { get(), set(date) }
import { sunPosition, sunTimes, compassName } from './sun.js'

const SUN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></svg>'
const MOON_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg>'

const pad = (n) => String(n).padStart(2, '0')
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const dayText = (d) => d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })

export const CARD_HTML = `
<header><span class="label">Datum &amp; Uhrzeit</span><button type="button" class="x" data-s="close" aria-label="Schließen">×</button></header>
<div class="srow">
  <input type="date" data-s="date" aria-label="Datum">
  <button type="button" class="chip" data-s="now">Jetzt</button>
</div>
<div class="srow picks" role="group" aria-label="Besondere Tage">
  <button type="button" class="chip" data-s="d-3-20">21. März</button>
  <button type="button" class="chip" data-s="d-6-21">21. Juni</button>
  <button type="button" class="chip" data-s="d-9-23">23. Sep.</button>
  <button type="button" class="chip" data-s="d-12-21">21. Dez.</button>
</div>
<div class="stime">
  <span class="sclock mono" data-s="clock">12:00</span>
  <input type="range" data-s="time" min="0" max="1435" step="5" value="720" aria-label="Uhrzeit">
</div>
<div class="srow picks three">
  <button type="button" class="chip" data-s="rise">Aufgang</button>
  <button type="button" class="chip" data-s="noon">Mittag</button>
  <button type="button" class="chip" data-s="set">Untergang</button>
</div>
<p class="note" data-s="info" role="status"></p>
`

export function mountSunPanel(button, card, { lat, lon, onChange }) {
  card.innerHTML = CARD_HTML
  const $ = (id) => card.querySelector(`[data-s="${id}"]`)
  const dateIn = $('date'), timeIn = $('time')
  let when = new Date(); when.setHours(12, 0, 0, 0)
  let times = null, timesDay = ''

  function open(on) {
    card.hidden = !on
    button.setAttribute('aria-expanded', String(on))
  }
  button.addEventListener('click', () => open(card.hidden))
  $('close').addEventListener('click', () => { open(false); button.focus() })
  card.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); open(false); button.focus() } })

  function render() {
    const key = ymd(when)
    if (key !== timesDay) { times = sunTimes(when, lat, lon); timesDay = key }
    const { altitude, azimuth } = sunPosition(when, lat, lon)
    const up = altitude > -0.833
    button.querySelector('.ico').innerHTML = up ? SUN_ICON : MOON_ICON
    button.querySelector('.txt').textContent = `${dayText(when)} · ${hm(when)}`
    button.querySelector('.short').textContent = hm(when)
    button.title = `Sonnenstand: ${when.toLocaleDateString('de-DE')} ${hm(when)} Uhr`
    dateIn.value = key
    timeIn.value = String(when.getHours() * 60 + when.getMinutes())
    $('clock').textContent = hm(when)
    for (const k of ['rise', 'noon', 'set']) {
      const t = times[k], b = $(k)
      b.disabled = !t
      b.innerHTML = { rise: 'Aufgang', noon: 'Mittag', set: 'Untergang' }[k] + `<b>${t ? hm(t) : '–'}</b>`
    }
    $('info').textContent = up
      ? `Sonne ${Math.round(altitude)}° hoch, aus ${compassName(azimuth)} (${Math.round(azimuth)}°).`
      : altitude > -6
        ? 'Dämmerung, die Leuchten sind an.'
        : 'Nacht, die Leuchten sind an.'
  }
  function set(d, notify = true) {
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return
    when = new Date(d.getTime()); when.setSeconds(0, 0)
    render()
    if (notify) onChange(new Date(when))
  }
  const atMinutes = (min) => { const d = new Date(when); d.setHours(0, min, 0, 0); return d }

  timeIn.addEventListener('input', () => set(atMinutes(+timeIn.value)))
  dateIn.addEventListener('change', () => {
    const [y, m, day] = dateIn.value.split('-').map(Number)
    if (!y) return
    const d = new Date(when); d.setFullYear(y, m - 1, day); set(d)
  })
  $('now').addEventListener('click', () => set(new Date()))
  for (const b of card.querySelectorAll('[data-s^="d-"]')) {
    const [, m, day] = b.dataset.s.split('-').map(Number)
    b.addEventListener('click', () => { const d = new Date(when); d.setMonth(m - 1, day); set(d) })
  }
  for (const k of ['rise', 'noon', 'set']) {
    $(k).addEventListener('click', () => {
      const t = times?.[k]; if (!t) return
      // a few minutes after sunrise / before sunset, so the scene isn't dark
      const d = new Date(t.getTime() + (k === 'rise' ? 5 : k === 'set' ? -5 : 0) * 60000)
      d.setMinutes(Math.round(d.getMinutes() / 5) * 5); set(d)
    })
  }
  set(when, false)
  return { get: () => new Date(when), set }
}
