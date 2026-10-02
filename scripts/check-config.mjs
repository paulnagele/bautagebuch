// Prints a GitHub Actions warning for every setting the production build
// is missing. The app itself shows a "Setup not finished" page then.
import { loadEnv } from 'vite'

const REQUIRED = [
  'VITE_GOOGLE_CLIENT_ID',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_DRIVE_FOLDER_ID',
]

const env = loadEnv('production', process.cwd(), 'VITE_')
const missing = REQUIRED.filter((name) => !env[name])

for (const name of missing) {
  console.log(
    `::warning title=Missing setting ${name}::Set it in .env.production or as repository variable ${name.replace(/^VITE_/, '')}.`,
  )
}
if (missing.length === 0) console.log('All settings present.')
