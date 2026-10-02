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

// Kept out of the repository on purpose, so it must come from a secret.
const SECRET_ONLY = ['VITE_DRIVE_FOLDER_ID']

for (const name of missing) {
  const repoName = name.replace(/^VITE_/, '')
  if (SECRET_ONLY.includes(name)) {
    console.log(
      `::error title=Missing secret ${repoName}::Add it under Settings → Secrets and variables → Actions → Secrets.`,
    )
  } else {
    console.log(
      `::warning title=Missing setting ${name}::Set it in .env.production or as repository variable ${repoName}.`,
    )
  }
}
if (missing.length === 0) console.log('All settings present.')
// Fail the deploy rather than replace the live site with one without photos.
if (missing.some((name) => SECRET_ONLY.includes(name))) process.exit(1)
