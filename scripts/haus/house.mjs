#!/usr/bin/env node
// Reads, saves and renders the house model (Haus tab) from the command
// line, for Claude sessions working on the model. The model stays out of
// the repository: `pull` writes it to a folder outside git (default
// .haus/, ignored), and `save` only adds new versions.
//
// Signs in with HAUS_BOT_EMAIL / HAUS_BOT_PASSWORD, a login listed in
// public.house_editors (see supabase/migrations/…_house_editors.sql).
//
//   node scripts/haus/house.mjs pull [--out .haus]
//       index.json (all versions, newest first), versions/<id>.json,
//       context.json (site data)
//   node scripts/haus/house.mjs save <model.json> --name "…" [--note "…"] [--parent <id>]
//       adds a version named "Claude: …"; members pick it in the Haus tab
//   node scripts/haus/house.mjs render <model.json> --out shot.png
//       [--context .haus/context.json] [--view persp|NW|NO|SO|SW|top|site]
//       [--level all|DG|EG|KG] [--off roof,terrain,labels,furn,neighbors,…]
//       [--on edges,contours,grid,…] [--cut x|z:<metres>] [--panel] [--size 1400x900]
import { createClient } from '@supabase/supabase-js'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

async function readEnvFile() {
  const text = await readFile(path.join(root, '.env.production'), 'utf8')
  return Object.fromEntries(
    text
      .split('\n')
      .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2]]),
  )
}

async function signIn() {
  const email = process.env.HAUS_BOT_EMAIL
  const password = process.env.HAUS_BOT_PASSWORD
  if (!email || !password) throw new Error('HAUS_BOT_EMAIL and HAUS_BOT_PASSWORD must be set.')
  const env = await readEnvFile()
  const url = process.env.SUPABASE_URL ?? env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY
  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`Sign-in failed: ${error.message}`)
  return supabase
}

function check({ data, error }) {
  if (error) throw new Error(error.message)
  return data
}

async function pull({ out }) {
  const supabase = await signIn()
  const versions = check(
    await supabase
      .from('house_versions')
      .select('id, name, note, parent_id, is_current, locked, created_at, model')
      .order('created_at', { ascending: false }),
  )
  if (versions.length === 0) throw new Error('No versions visible. Is the login in house_editors?')
  const context = check(await supabase.from('house_context').select('data').eq('id', 'site').maybeSingle())
  await mkdir(path.join(out, 'versions'), { recursive: true })
  for (const { model, ...version } of versions) {
    await writeFile(path.join(out, 'versions', `${version.id}.json`), JSON.stringify(model, null, 1))
  }
  const index = versions.map(({ model: _model, ...version }) => version)
  await writeFile(path.join(out, 'index.json'), JSON.stringify(index, null, 2))
  if (context) await writeFile(path.join(out, 'context.json'), JSON.stringify(context.data))
  for (const version of index) {
    console.log(`${version.is_current ? '*' : ' '} ${version.id}  ${version.name}`)
  }
  console.log(`Wrote ${index.length} versions${context ? ' and the site data' : ''} to ${out}`)
}

async function save(file, { name, note, parent }) {
  if (!name) throw new Error('--name is required.')
  const model = JSON.parse(await readFile(file, 'utf8'))
  if (!Array.isArray(model.walls)) throw new Error(`${file} is not a house model (no walls).`)
  const supabase = await signIn()
  const row = check(
    await supabase
      .from('house_versions')
      .insert({
        name: name.startsWith('Claude: ') ? name : `Claude: ${name}`,
        note: note ?? '',
        parent_id: parent ?? null,
        model,
      })
      .select('id, name')
      .single(),
  )
  console.log(`Saved version ${row.id} "${row.name}"`)
}

async function render(file, options) {
  const { chromium } = await import('playwright-core')
  const { createServer } = await import('vite')
  const model = await readFile(file, 'utf8')
  const contextFile = options.context ?? path.join(path.dirname(file), '..', 'context.json')
  const context = await readFile(contextFile, 'utf8').catch(() => null)
  if (!context) console.warn(`No site data at ${contextFile}, rendering the house alone.`)

  const server = await createServer({
    root,
    logLevel: 'error',
    server: { port: 0, host: '127.0.0.1' },
    plugins: [
      {
        name: 'haus-render-data',
        configureServer(vite) {
          vite.middlewares.use((request, response, next) => {
            const body = { '/__haus/model': model, '/__haus/context': context }[request.url]
            if (body === undefined) return next()
            response.statusCode = body === null ? 204 : 200
            response.setHeader('Content-Type', 'application/json')
            response.end(body ?? '')
          })
        },
      },
    ],
  })
  await server.listen()
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  })
  try {
    const [width, height] = (options.size ?? '1400x900').split('x').map(Number)
    const page = await browser.newPage({ viewport: { width, height } })
    page.on('pageerror', (error) => console.error('page error:', error.message))
    await page.goto(`${server.resolvedUrls.local[0]}scripts/haus/render.html`)
    await page.waitForFunction(() => window.__hausReady || window.__hausError, null, { timeout: 120000 })
    const failure = await page.evaluate(() => window.__hausError)
    if (failure) throw new Error(failure)

    const button = (key) => page.locator(`#host [data-h="${key}"]`)
    const setChip = async (key, on) => {
      const chip = button(key)
      if ((await chip.getAttribute('aria-pressed')) !== String(on)) await chip.evaluate((el) => el.click())
    }
    const chips = (list) => (list ? list.split(',').map((name) => name.trim()).filter(Boolean) : [])
    // House toggles are t-<name>, site toggles c-<name> (see viewer.js).
    const chipFor = async (name) => ((await button(`t-${name}`).count()) ? `t-${name}` : `c-${name}`)
    for (const name of chips(options.off)) await setChip(await chipFor(name), false)
    for (const name of chips(options.on)) await setChip(await chipFor(name), true)
    if (options.level) await button(`lv-${options.level}`).click({ force: true })
    if (options.cut) {
      const [mode, position] = options.cut.split(':')
      await button('cutmode').selectOption(mode)
      if (position !== undefined) await button('cutpos').fill(position)
    }
    if (options.view) await page.locator(`#host [data-view="${options.view}"]`).click({ force: true })
    if (!options.panel) await page.evaluate(() => document.body.classList.add('no-panel'))
    await page.waitForTimeout(2500)
    await page.screenshot({ path: options.out })
    console.log(`Wrote ${options.out}`)
  } finally {
    await browser.close()
    await server.close()
  }
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    name: { type: 'string' },
    note: { type: 'string' },
    parent: { type: 'string' },
    context: { type: 'string' },
    view: { type: 'string' },
    level: { type: 'string' },
    off: { type: 'string' },
    on: { type: 'string' },
    cut: { type: 'string' },
    panel: { type: 'boolean' },
    size: { type: 'string' },
  },
})
const [command, file] = positionals

try {
  if (command === 'pull') await pull({ out: values.out ?? path.join(root, '.haus') })
  else if (command === 'save' && file) await save(file, values)
  else if (command === 'render' && file) {
    if (!values.out) throw new Error('--out is required.')
    await render(file, values)
  } else {
    console.error('Usage: house.mjs pull | save <model.json> --name … | render <model.json> --out …')
    process.exitCode = 2
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
