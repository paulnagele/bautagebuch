// Guards the deploy pipeline against mixing up the two databases.
//
// Every deployment has its own Supabase project. A deployment other than
// "production" that falls back to the production settings (because its
// GitHub environment is missing a value) must stop here, before it runs
// migrations on, or builds against, the production database.
//
// Env: DEPLOY_TARGET (required), SUPABASE_PROJECT_REF, and in the build
// step CHECK_BUILD=1, VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
import { readFileSync } from 'node:fs'

const target = process.env.DEPLOY_TARGET
const ref = process.env.SUPABASE_PROJECT_REF || ''
const url = process.env.VITE_SUPABASE_URL || ''

// The production project is the one in the committed .env.production.
const prodEnv = readFileSync('.env.production', 'utf8')
const prodValue = (name) => new RegExp(`^${name}=(.*)$`, 'm').exec(prodEnv)?.[1]?.trim() ?? ''
const prodUrl = prodValue('VITE_SUPABASE_URL')
const refOf = (u) => /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(u)?.[1] ?? ''
const prodRef = refOf(prodUrl)

const errors = []
if (!target) errors.push('DEPLOY_TARGET is not set.')
if (target && target !== 'production' && prodRef) {
  if (ref === prodRef) errors.push(`SUPABASE_PROJECT_REF of "${target}" is the production project. Set its own in the "${target}" environment.`)
  if (refOf(url) === prodRef) errors.push(`SUPABASE_URL of "${target}" is the production project. Set its own in the "${target}" environment.`)
  // The build (CHECK_BUILD=1) must not fall back to the production values
  // in .env.production.
  if (process.env.CHECK_BUILD && !url) errors.push(`SUPABASE_URL of "${target}" is not set. Set it in the "${target}" environment.`)
  // The build step passes the URL; the anon key must then belong to the same project.
  const key = process.env.VITE_SUPABASE_ANON_KEY || ''
  if (url && (!key || key === prodValue('VITE_SUPABASE_ANON_KEY'))) errors.push(`SUPABASE_ANON_KEY of "${target}" is missing or the production key. Set its own in the "${target}" environment.`)
}
if (ref && url && refOf(url) && refOf(url) !== ref) {
  errors.push(`SUPABASE_URL (${refOf(url)}) and SUPABASE_PROJECT_REF (${ref}) point to different projects.`)
}

for (const e of errors) console.log(`::error title=Deployment ${target}::${e}`)
if (errors.length) process.exit(1)
console.log(`Settings for "${target}" look consistent.`)
