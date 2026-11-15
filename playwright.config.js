// Browser tests (npm run test:e2e): the app in a phone-sized Chromium,
// against a made-up project. Supabase and Google are answered inside the
// test (tests/e2e/mock.js), so no account or network is needed.
import { defineConfig, devices } from '@playwright/test'

const PORT = 5179

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    locale: 'de-DE',
    timezoneId: 'Europe/Vienna',
    trace: 'retain-on-failure',
    // Service workers would answer some requests themselves.
    serviceWorkers: 'block',
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [
    { name: 'handy', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 } }, testMatch: /smoke/ },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_SUPABASE_URL: 'https://mock.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'test',
      VITE_GOOGLE_CLIENT_ID: 'test',
    },
  },
})
