// Every tab opens with data and without errors in the page.
import { expect, test } from '@playwright/test'
import { openApp, openTab } from './mock.js'

const TABS = ['Home', 'Tagebuch', 'Finanzen', 'Zeitplan', 'Haus', 'Einrichtung', 'Kontakte', 'Dokumente', 'Heizwärme']

test('alle Bereiche öffnen ohne Fehler', async ({ page }) => {
  const consoleErrors = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
  const { errors } = await openApp(page)
  await expect(page.getByText('Fensteranschluss Küche undicht.').first()).toBeVisible()
  for (const label of TABS) {
    await openTab(page, label)
    const panel = page.getByRole('tabpanel', { name: label })
    await expect(panel).toBeVisible()
    await expect(panel).not.toContainText('konnte nicht geladen werden')
    await expect(panel.getByText('Wird geladen…')).toHaveCount(0)
  }
  expect(errors).toEqual([])
  expect(consoleErrors).toEqual([])
})
