import { describe, expect, it } from 'vitest'
import { checkDetails, compareEntries, emptyForm, fieldOptions, formFromEntry } from '../../src/diaryForm.js'
import { diarySections, shownDate } from '../../src/diarySections.js'
import { inRange, matchesContact, matchesEntry, normalize, queryWords } from '../../src/diarySearch.js'
import { defaultDetails, entryType, isOpen, isOverdue, typeKey } from '../../src/diaryTypes.js'
import { appointment, defect, entry, expense, todo } from './fixtures.js'

const lists = {
  expenseCategories: ['Rohbau', 'Dach'],
  budgetItems: new Map([
    ['Rohbau', [{ id: 'p1', name: 'Baumeister' }]],
    ['Dach', []],
  ]),
}

describe('Eintragsarten', () => {
  it('unbekannte Arten werden als Status gezeigt', () => {
    expect(typeKey('neu-in-spaeterer-version')).toBe('status')
    expect(entryType('neu-in-spaeterer-version').label).toBe('Status')
    expect(typeKey('todo')).toBe('todo')
  })

  it('offen: Aufgaben, Mängel, unbezahlte Rechnungen', () => {
    expect(isOpen(todo('2026-11-20'))).toBe(true)
    expect(isOpen(todo('2026-11-20', 'done'))).toBe(false)
    expect(isOpen(defect('', 'fixed'))).toBe(false)
    expect(isOpen(expense(10, 'open'))).toBe(true)
    expect(isOpen(expense(10, 'paid'))).toBe(false)
    expect(isOpen(entry())).toBe(false)
    expect(isOpen(appointment('2026-11-20'))).toBe(false)
  })

  it('ohne Stand gilt der Standard (Mangel offen, Ausgabe bezahlt)', () => {
    expect(isOpen(entry({ type: 'defect', details: {} }))).toBe(true)
    expect(isOpen(entry({ type: 'expense', details: {} }))).toBe(false)
  })

  it('überfällig erst nach dem Fälligkeitstag', () => {
    expect(isOverdue(todo('2026-11-14'), '2026-11-15')).toBe(true)
    expect(isOverdue(todo('2026-11-15'), '2026-11-15')).toBe(false)
    expect(isOverdue(todo('2026-11-14', 'done'), '2026-11-15')).toBe(false)
    expect(isOverdue(defect(''), '2026-11-15')).toBe(false)
  })

  it('Standardwerte für neue Einträge', () => {
    expect(defaultDetails('defect')).toEqual({ state: 'open', responsible: '', deadline: '', category: '' })
    expect(defaultDetails('expense', { amount: 5 })).toMatchObject({ amount: 5, payment: 'paid' })
  })
})

describe('Formular', () => {
  it('neues Formular und Bearbeiten', () => {
    const form = emptyForm('todo')
    expect(form).toMatchObject({ type: 'todo', work: '', weatherAuto: true, details: { state: 'open' } })
    const edited = formFromEntry({ ...todo('2026-11-20'), workers: 3, photoIds: ['f1'], files: [{ id: 'f2', name: 'a.pdf' }] })
    expect(edited).toMatchObject({ workers: '3', weatherAuto: false, photos: [{ key: 'f1', fileId: 'f1' }] })
    expect(edited.files).toEqual([{ key: 'f2', fileId: 'f2', name: 'a.pdf' }])
  })

  it('Auswahl: Kategorien, ein alter Wert bleibt wählbar', () => {
    const field = entryType('expense').fields.find((f) => f.key === 'category')
    expect(Object.keys(fieldOptions(field, '', lists))).toEqual(['Rohbau', 'Dach'])
    expect(Object.keys(fieldOptions(field, 'Alt', lists))).toEqual(['Rohbau', 'Dach', 'Alt'])
    const optional = entryType('status').fields[0]
    expect(fieldOptions(optional, '', lists)).toHaveProperty('', '– keine –')
  })

  it('Posten hängen an der Kategorie', () => {
    const field = entryType('expense').fields.find((f) => f.key === 'budgetItem')
    expect(fieldOptions(field, '', lists, { category: 'Rohbau' })).toEqual({ '': '– keiner –', p1: 'Baumeister' })
    expect(fieldOptions(field, '', lists, { category: 'Dach' })).toEqual({})
  })

  it('prüft Ausgaben vor dem Speichern', () => {
    expect(checkDetails('expense', { amount: '' }, lists).error).toBe('Bitte „Betrag (€)“ ausfüllen.')
    expect(checkDetails('expense', { amount: '-3' }, lists).error).toMatch(/größer als 0/)
    const ok = checkDetails('expense', { amount: '12.345', budgetItem: 'p1' }, lists)
    // Leere Kategorie heißt: die erste in der Liste.
    expect(ok.details).toMatchObject({ category: 'Rohbau', amount: 12.35, budgetItem: 'p1', payment: 'paid' })
  })

  it('ein Posten aus einer anderen Kategorie fällt weg', () => {
    const { details } = checkDetails('expense', { category: 'Dach', amount: 5, budgetItem: 'p1' }, lists)
    expect(details.budgetItem).toBe('')
  })

  it('ohne Ausgabenkategorien verweist es auf die Finanzen', () => {
    const { error } = checkDetails('expense', { amount: 5 }, { expenseCategories: [] })
    expect(error).toMatch(/Finanzen eine Ausgabenkategorie/)
  })

  it('Aufgaben brauchen ein Datum; das Komma nach der letzten Person fällt weg', () => {
    expect(checkDetails('todo', { due: '' }, lists).error).toBe('Bitte „Erledigen bis“ ausfüllen.')
    const { details } = checkDetails('todo', { due: '2026-11-20', responsible: 'Erika Beispiel, ' }, lists)
    expect(details.responsible).toBe('Erika Beispiel')
  })

  it('sortiert neueste zuerst, am selben Tag nach Uhrzeit', () => {
    const list = [appointment('2026-11-01', '08:00'), appointment('2026-11-02'), appointment('2026-11-01', '14:00')]
    expect(list.sort(compareEntries).map((e) => `${e.date} ${e.details.time}`)).toEqual([
      '2026-11-02 ',
      '2026-11-01 14:00',
      '2026-11-01 08:00',
    ])
  })
})

describe('Abschnitte Offen, Demnächst, Verlauf', () => {
  const today = '2026-11-15'

  it('verteilt und sortiert die Einträge', () => {
    const late = todo('2026-11-30')
    const soon = defect('2026-11-16')
    const noDue = todo('')
    const unpaid = expense(10, 'open', { payBy: '2026-11-20' })
    const next = appointment('2026-11-17', '08:00')
    const later = appointment('2026-11-20')
    const todayLate = appointment('2026-11-15', '16:00')
    const past = appointment('2026-11-01')
    const old = entry({ date: '2026-10-01' })
    const recent = entry({ date: '2026-11-10' })
    const done = todo('2026-11-12', 'done')

    const sections = diarySections(
      [late, soon, noDue, unpaid, next, later, todayLate, past, old, recent, done],
      today,
    )
    expect(sections.map((s) => s.title)).toEqual(['Offen', 'Demnächst', 'Verlauf'])
    const [open, upcoming, history] = sections.map((s) => s.entries)
    expect(open).toEqual([soon, unpaid, late, noDue])
    expect(upcoming).toEqual([todayLate, next, later])
    // Erledigte Aufgabe steht unter ihrem Fälligkeitstag.
    expect(history).toEqual([done, recent, past, old])
  })

  it('lässt leere Abschnitte weg', () => {
    expect(diarySections([entry()], today).map((s) => s.key)).toEqual(['history'])
    expect(diarySections([], today)).toEqual([])
  })

  it('zeigt bei Aufgaben das Fälligkeitsdatum', () => {
    expect(shownDate(todo('2026-12-01'))).toBe('2026-12-01')
    expect(shownDate(entry({ date: '2026-11-01' }))).toBe('2026-11-01')
    expect(shownDate(expense(1, 'open', { payBy: '2026-12-01' }))).toBe(entry({ date: '2026-11-01' }).date)
  })
})

describe('Suche', () => {
  it('ignoriert Groß-/Kleinschreibung und Akzente', () => {
    expect(normalize('Mängel ÉTÉ')).toBe('mangel ete')
    expect(queryWords('  Dach   Fenster ')).toEqual(['dach', 'fenster'])
  })

  it('findet über Text, Art, Datum, Personen und Dateinamen', () => {
    const e = defect('2026-11-22', 'open', { responsible: 'Erika Beispiel' })
    e.work = 'Fensteranschluss Küche undicht'
    e.files = [{ id: 'f', name: 'Foto_Laibung.jpg' }]
    const find = (q) => matchesEntry(e, queryWords(q), lists)
    expect(find('kuche undicht')).toBe(true)
    expect(find('mangel')).toBe(true)
    expect(find('22.11.2026')).toBe(true)
    expect(find('beispiel')).toBe(true)
    expect(find('laibung')).toBe(true)
    expect(find('offen')).toBe(true)
    expect(find('dach')).toBe(false)
    expect(find('')).toBe(true)
  })

  it('Zeitraum: beide Enden dürfen fehlen', () => {
    const e = entry({ date: '2026-11-10' })
    expect(inRange(e, '', '')).toBe(true)
    expect(inRange(e, '2026-11-10', '2026-11-10')).toBe(true)
    expect(inRange(e, '2026-11-11', '')).toBe(false)
    expect(inRange(e, '', '2026-11-09')).toBe(false)
  })

  it('Kontakte erst mit Suchwort', () => {
    const c = { name: 'Erika Beispiel', role: 'Architektin', company: 'Atelier Muster' }
    expect(matchesContact(c, [])).toBe(false)
    expect(matchesContact(c, queryWords('atelier erika'))).toBe(true)
  })
})
