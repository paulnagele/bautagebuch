import { describe, expect, it } from 'vitest'
import { entryEvent, entryHasEvent, milestoneEvent } from '../../src/calendar.js'
import { appointment, defect, entry, expense, todo } from './fixtures.js'

describe('Google Kalender', () => {
  it('Termin mit Uhrzeit: eine Stunde, in Wiener Zeit', () => {
    const e = appointment('2026-11-17', '08:30', { location: 'Baustelle', participants: 'Erika Beispiel' })
    e.work = 'Baubesprechung\nFenster und Dach'
    const event = entryEvent(e)
    expect(event.summary).toBe('Baubesprechung')
    expect(event.location).toBe('Baustelle')
    expect(event.start).toEqual({ dateTime: '2026-11-17T08:30:00', timeZone: 'Europe/Vienna', date: null })
    expect(event.end.dateTime).toBe('2026-11-17T09:30:00')
    expect(event.description).toBe('Baubesprechung\nFenster und Dach\n\nMit: Erika Beispiel\n\nAus dem Bautagebuch')
  })

  it('Termin um 23:30 endet am nächsten Tag', () => {
    const event = entryEvent(appointment('2026-12-31', '23:30'))
    expect(event.end.dateTime).toBe('2027-01-01T00:30:00')
  })

  it('Termin ohne Uhrzeit ist ganztägig', () => {
    const event = entryEvent(appointment('2026-02-28'))
    expect(event.start).toEqual({ date: '2026-02-28', dateTime: null })
    expect(event.end).toEqual({ date: '2026-03-01', dateTime: null })
  })

  it('Aufgaben und Mängel am Fälligkeitstag, mit ✓ wenn erledigt', () => {
    const t = todo('2026-11-20', 'open', { responsible: 'Erika Beispiel' })
    t.work = 'Fliesen aussuchen'
    expect(entryEvent(t)).toMatchObject({ summary: 'Aufgabe: Fliesen aussuchen', start: { date: '2026-11-20' } })
    expect(entryEvent(t).description).toContain('Zuständig: Erika Beispiel')
    const d = defect('2026-11-22', 'fixed')
    d.work = 'Riss'
    expect(entryEvent(d).summary).toBe('✓ Mangel: Riss')
  })

  it('kein Termin ohne Fälligkeit, für Status und für Rechnungen', () => {
    expect(entryHasEvent(defect(''))).toBe(false)
    expect(entryHasEvent(entry())).toBe(false)
    expect(entryHasEvent(expense(10, 'open', { payBy: '2026-11-30' }))).toBe(false)
    expect(entryHasEvent(todo('2026-11-30'))).toBe(true)
  })

  it('kürzt lange Titel auf 100 Zeichen', () => {
    const e = appointment('2026-11-17')
    e.work = 'x'.repeat(150)
    expect(entryEvent(e).summary).toHaveLength(100)
    expect(entryEvent(e).summary.endsWith('…')).toBe(true)
  })

  it('Meilensteine', () => {
    expect(milestoneEvent({ name: 'Dach dicht', date: '2026-12-05', reached: true })).toMatchObject({
      summary: '✓ Meilenstein: Dach dicht',
      start: { date: '2026-12-05' },
      end: { date: '2026-12-06' },
    })
  })
})
