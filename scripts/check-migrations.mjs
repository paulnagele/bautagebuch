// Checks the database migrations before they reach main:
// - every file starts with its own timestamp (two threads once picked the
//   same one, and only one of them would ever run);
// - with a base branch given (BASE_REF, e.g. origin/main), every migration
//   new in this branch is newer than all of main's. `supabase db push`
//   refuses a migration older than the last one the database has seen.
//
//   node scripts/check-migrations.mjs
//   BASE_REF=origin/main node scripts/check-migrations.mjs
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'

const DIR = 'supabase/migrations'
const version = (name) => /^(\d{14})_.+\.sql$/.exec(name)?.[1] ?? null

const files = readdirSync(DIR).filter((name) => name.endsWith('.sql')).sort()
const problems = []

const seen = new Map()
for (const name of files) {
  const v = version(name)
  if (!v) {
    problems.push(`${name}: name must be <14-digit timestamp>_<name>.sql`)
    continue
  }
  if (seen.has(v)) problems.push(`${name} and ${seen.get(v)} have the same timestamp ${v}`)
  seen.set(v, name)
}

const base = process.env.BASE_REF
if (base) {
  const listed = execFileSync('git', ['ls-tree', '--name-only', `${base}:${DIR}`], { encoding: 'utf8' })
  const onBase = listed.split('\n').filter((name) => name.endsWith('.sql'))
  const newest = onBase.map(version).filter(Boolean).sort().at(-1) ?? ''
  for (const name of files.filter((n) => !onBase.includes(n))) {
    const v = version(name)
    if (v && v <= newest) {
      problems.push(`${name} is new but older than ${newest} on ${base}: give it a newer timestamp`)
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`::error title=Migration::${problem}`)
  process.exit(1)
}
console.log(`${files.length} migrations ok${base ? ` (compared with ${base})` : ''}.`)
