// Finanzen: totals from the bookings, the budget per category and the
// Kreditrechner.
import { expect, test } from '@playwright/test'
import { openApp, openTab } from './mock.js'

test('Summen, Budget und Kreditrechner', async ({ page }) => {
  const { errors } = await openApp(page)
  await openTab(page, 'Finanzen')
  const finances = page.getByRole('tabpanel', { name: 'Finanzen' })
  // 160.000 € Eigenmittel; 14.800 + 48.000 + 36.000 € ausgegeben, 36.000 € davon offen.
  await expect(finances.locator('.stat').filter({ hasText: 'Gesicherte Finanzierung' })).toContainText('160.000 €')
  await expect(finances.locator('.stat').filter({ hasText: 'Bisher ausgegeben' })).toContainText('98.800 €')
  await expect(finances).toContainText('davon 36.000 € noch nicht bezahlt')
  await expect(finances).toContainText('Der Plan braucht 46.000 € mehr als die gesicherte Finanzierung.')

  const rohbau = finances.getByRole('listitem').filter({ hasText: 'Rohbau' }).first()
  await expect(rohbau).toContainText('84.000 € von 108.000 €')
  await rohbau.getByRole('button', { name: '2 Ausgaben anzeigen' }).click()
  await expect(rohbau).toContainText('Baumeister 2. Teilrechnung')

  // The plan still needs 46.000 € more than secured: that is the loan.
  await finances.getByRole('button', { name: 'Kreditrechner' }).click()
  await expect(finances.getByRole('spinbutton', { name: 'Kreditsumme (€)' })).toHaveValue('46000')
  expect(errors).toEqual([])
})

test('Deep Link öffnet Finanzen direkt', async ({ page }) => {
  await openApp(page, { path: '/?tab=finanzen' })
  await expect(page.getByRole('tab', { name: 'Finanzen' })).toHaveAttribute('aria-selected', 'true')
  await expect(page).toHaveURL(/\/$/)
})
