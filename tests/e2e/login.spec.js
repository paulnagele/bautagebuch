// Signing in with Google, and who is let in.
import { expect, test } from '@playwright/test'
import { openApp } from './mock.js'

test('Anmelden mit Google öffnet das Bautagebuch', async ({ page }) => {
  const { writes, errors } = await openApp(page, { signedIn: false })
  await expect(page.getByRole('heading', { name: 'Bautagebuch' })).toBeVisible()
  await page.getByRole('button', { name: /Mit Google anmelden/ }).click()
  await expect(page.getByRole('tab', { name: 'Home' })).toBeVisible()
  // The Google ID token is exchanged for a Supabase session.
  expect(writes).toContainEqual(
    expect.objectContaining({ auth: 'id_token', body: expect.objectContaining({ provider: 'google', id_token: 'test-google-id-token' }) }),
  )
  expect(errors).toEqual([])
})

test('wer kein Mitglied ist, wird abgemeldet und bekommt einen Hinweis', async ({ page }) => {
  await openApp(page, { member: false })
  await expect(page.getByRole('alert')).toContainText('ist noch kein Mitglied dieses Bautagebuchs')
  await expect(page.getByRole('tab', { name: 'Home' })).toHaveCount(0)
})
