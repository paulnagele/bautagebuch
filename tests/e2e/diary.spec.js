// The diary: writing entries, ticking them off, searching.
import { expect, test } from '@playwright/test'
import { google, openApp, openTab } from './mock.js'

const panel = (page) => page.getByRole('tabpanel', { name: 'Tagebuch' })

test.beforeEach(async ({ page }) => {
  test.info().data = await openApp(page)
  await openTab(page, 'Tagebuch')
})

test('neuer Mangel wird gespeichert, steht unter Offen und im Kalender', async ({ page }) => {
  const { writes, errors } = test.info().data
  const diary = panel(page)
  await diary.getByRole('button', { name: /Neuer Eintrag/ }).first().click()
  await diary.getByRole('radio', { name: 'Mangel' }).check()
  await diary.getByRole('textbox', { name: 'Beschreibung des Mangels' }).fill('Fliese im Bad hat einen Sprung')
  await diary.getByRole('combobox', { name: /Zuständig/ }).fill('Thomas Probe')
  await diary.getByRole('textbox', { name: 'Zu beheben bis' }).fill('20.11.2026')
  await diary.getByRole('button', { name: 'Eintrag hinzufügen' }).click()

  // Under Offen, after the to-do due a day earlier.
  const open = diary.getByRole('list').first().getByRole('listitem')
  await expect(open.nth(1)).toContainText('Fliese im Bad hat einen Sprung')
  await expect(open.nth(1)).toContainText('bis 20.11.2026')

  const saved = writes.find((w) => w.table === 'diary_entries' && w.method === 'POST')
  expect(saved.body).toMatchObject({
    entry_type: 'defect',
    entry_date: '2026-11-15',
    work: 'Fliese im Bad hat einen Sprung',
    weather: '',
    workers: null,
    details: { state: 'open', responsible: 'Thomas Probe', deadline: '2026-11-20' },
  })
  // All-day event "Mangel: …" in the project calendar.
  await expect.poll(() => writes.some((w) => w.google && w.method === 'POST' && w.url.includes('/calendar/'))).toBe(true)
  expect(errors).toEqual([])
})

test('Ausgabe ohne Betrag wird nicht gespeichert', async ({ page }) => {
  const { writes } = test.info().data
  const diary = panel(page)
  await diary.getByRole('button', { name: /Neuer Eintrag/ }).first().click()
  await diary.getByRole('radio', { name: 'Ausgabe' }).check()
  await diary.getByRole('textbox', { name: 'Wofür?' }).fill('Baustrom')
  await diary.getByRole('button', { name: 'Eintrag hinzufügen' }).click()
  await expect(diary.getByText('Bitte „Betrag (€)“ ausfüllen.')).toBeVisible()
  expect(writes.filter((w) => w.table === 'diary_entries')).toEqual([])
})

test('Aufgabe abhaken', async ({ page }) => {
  const { writes } = test.info().data
  const diary = panel(page)
  const card = diary.getByRole('listitem').filter({ hasText: 'Fliesen fürs Bad aussuchen' })
  await card.getByRole('button', { name: 'Als erledigt markieren' }).click()
  await expect(diary.getByRole('heading', { name: /Offen 2/ })).toBeVisible()
  const change = writes.find((w) => w.table === 'diary_entries' && w.method === 'PATCH')
  expect(change.body.details).toMatchObject({ state: 'done', due: '2026-11-19' })
})

test('Suche und Filter', async ({ page }) => {
  const diary = panel(page)
  await diary.getByRole('searchbox', { name: 'Tagebuch durchsuchen' }).fill('kuche')
  await expect(diary.getByText('Fensteranschluss Küche undicht.')).toBeVisible()
  await expect(diary.getByText('Fliesen fürs Bad aussuchen')).toHaveCount(0)

  await diary.getByRole('searchbox', { name: 'Tagebuch durchsuchen' }).fill('')
  await diary.getByRole('button', { name: /^Ausgaben/ }).click()
  await expect(diary.getByText('Baumeister 1. Teilrechnung')).toBeVisible()
  await expect(diary.getByText('Mauerwerk Erdgeschoss fertig.')).toHaveCount(0)
})

test('Entwurf überlebt Neuladen', async ({ page }) => {
  const diary = panel(page)
  await diary.getByRole('button', { name: /Neuer Eintrag/ }).first().click()
  await diary.getByRole('textbox', { name: 'Ausgeführte Arbeiten' }).fill('Halb geschrieben')
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('bautagebuch.diaryDraft')))
    .toContain('Halb geschrieben')
  await page.reload()
  await openTab(page, 'Tagebuch')
  await expect(panel(page).getByRole('textbox', { name: 'Ausgeführte Arbeiten' })).toHaveValue('Halb geschrieben')
})

test('Fotos werden nach dem Speichern im Hintergrund hochgeladen', async ({ page }) => {
  const { writes, errors } = test.info().data
  const diary = panel(page)
  google.uploadDelay = 1500
  try {
    await diary.getByRole('button', { name: /Neuer Eintrag/ }).first().click()
    await diary.getByRole('textbox', { name: 'Ausgeführte Arbeiten' }).fill('Bodenplatte betoniert')
    const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64')
    await page.locator('input[type=file][multiple][accept="image/*"]').setInputFiles([
      { name: 'a.jpg', mimeType: 'image/jpeg', buffer: jpeg },
      { name: 'b.jpg', mimeType: 'image/jpeg', buffer: jpeg },
    ])
    await diary.getByRole('button', { name: 'Eintrag hinzufügen' }).click()

    // Saved at once, the photos still on their way.
    const card = diary.getByRole('listitem').filter({ hasText: 'Bodenplatte betoniert' }).first()
    await expect(card).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: '2 Fotos werden hochgeladen' })).toBeVisible()
    await expect(card.getByText('wird hochgeladen')).toHaveCount(2)
    const saved = writes.find((w) => w.table === 'diary_entries' && w.method === 'POST')
    expect(saved.body.photo_ids).toEqual([])

    // Then added to the entry.
    await expect(card.getByText('wird hochgeladen')).toHaveCount(0, { timeout: 10_000 })
    await expect(page.getByRole('status').filter({ hasText: 'hochgeladen' })).toHaveCount(0)
    const added = writes.filter((w) => w.table === 'diary_entries' && w.method === 'PATCH').map((w) => w.body.photo_ids)
    expect(added.at(-1)).toHaveLength(2)
    expect(errors).toEqual([])
  } finally {
    google.uploadDelay = 0
  }
})
