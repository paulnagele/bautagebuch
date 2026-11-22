// Runs the app against a made-up project: Supabase, Google (sign-in,
// Drive, Calendar) and the weather service are answered inside the
// browser test, nothing goes over the network. Writes change the copy of
// the data for this test and are recorded in `writes`.
import { demoTables, USER } from './demo-data.js'

export const SUPABASE_URL = 'https://mock.supabase.co'
// The "today" of the demo project (the real clock keeps running from it).
export const TODAY = '2026-11-15'

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')

function session(user) {
  const exp = Math.floor(Date.now() / 1000) + 36000
  const claims = { sub: user.id, exp, role: 'authenticated', aud: 'authenticated', email: user.email }
  return {
    access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.sig`,
    refresh_token: 'r',
    expires_at: exp,
    expires_in: 36000,
    token_type: 'bearer',
    user: {
      id: user.id,
      aud: 'authenticated',
      email: user.email,
      user_metadata: { full_name: user.name, name: user.name },
      app_metadata: { provider: 'google', providers: ['google'] },
    },
  }
}

// Stand-in for https://accounts.google.com/gsi/client.
const FAKE_GSI = `
window.google = { accounts: {
  id: {
    initialize(options) { window.__gsi = options },
    renderButton(element) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = 'Mit Google anmelden (Test)'
      button.onclick = () => window.__gsi.callback({ credential: 'test-google-id-token' })
      element.appendChild(button)
    },
    prompt() {},
    disableAutoSelect() {},
  },
  oauth2: {
    initTokenClient(options) {
      return { requestAccessToken() { options.callback({ access_token: 'demo', expires_in: 3600, scope: options.scope }) } }
    },
    hasGrantedAllScopes() { return true },
    revoke(token, done) { done && done() },
  },
} }
`

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
  'access-control-expose-headers': 'content-range, location',
}

let nextId = 1
// How long the mocked Drive takes for one file upload (ms).
export const google = { uploadDelay: 0 }
const newId = () => `10000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`

// Applies PostgREST filters (eq., is., in.) from the query string.
function filterRows(rows, params) {
  let out = rows
  for (const [key, value] of params) {
    if (['select', 'order', 'offset', 'limit', 'on_conflict', 'columns'].includes(key)) continue
    if (value.startsWith('eq.')) out = out.filter((r) => String(r[key]) === value.slice(3))
    else if (value.startsWith('is.')) out = out.filter((r) => String(r[key] ?? 'null') === value.slice(3))
    else if (value.startsWith('in.(')) {
      const set = value.slice(4, -1).split(',').map((v) => v.replace(/^"|"$/g, ''))
      out = out.filter((r) => set.includes(String(r[key])))
    }
  }
  return out
}

// Opens the app signed in (or, with signedIn: false, at the login).
//   member: false   the account is not in the member list
export async function openApp(page, { signedIn = true, member = true, path = '/', tables = demoTables() } = {}) {
  const writes = []
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.addInitScript(
    ([s, today]) => {
      // Fixed "today" for the demo project; the clock keeps running.
      const offset = new Date(`${today}T10:30:00+01:00`).getTime() - Date.now()
      const RealDate = Date
      class DemoDate extends RealDate {
        constructor(...args) {
          super(...(args.length ? args : [RealDate.now() + offset]))
        }
        static now() {
          return RealDate.now() + offset
        }
      }
      window.Date = DemoDate
      if (!sessionStorage.getItem('test-init')) {
        sessionStorage.setItem('test-init', '1')
        if (s) localStorage.setItem('sb-mock-auth-token', JSON.stringify(s))
        localStorage.setItem('installHint.dismissed', 'true')
        localStorage.setItem('bautagebuch.photosPrivate', '1')
        const token = JSON.stringify({ accessToken: 'demo', expiresAt: RealDate.now() + 36e6 })
        localStorage.setItem('bautagebuch.driveToken', token)
        localStorage.setItem('bautagebuch.calendarToken', token)
      }
    },
    [signedIn ? session(USER) : null, TODAY],
  )

  // Google's sign-in script: a stand-in whose button signs in at once.
  await page.route(/accounts\.google\.com\/gsi\/client/, (r) =>
    r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_GSI }),
  )
  // Embedded calendar, weather, fonts: empty answers.
  await page.route(/calendar\.google\.com\/calendar\/embed|open-meteo|googleusercontent|fonts\.g/, (r) =>
    r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }),
  )
  // Drive and Calendar API
  await page.route(/googleapis\.com/, async (r) => {
    const req = r.request()
    if (req.method() !== 'GET' && req.method() !== 'OPTIONS') writes.push({ google: true, method: req.method(), url: req.url() })
    // Resumable uploads: the first request opens a session (Location),
    // the file itself is then sent there with PUT.
    if (req.method() === 'POST' && req.url().includes('/upload/drive/')) {
      const session = `https://www.googleapis.com/upload/drive/v3/files?upload_id=${newId()}`
      return r.fulfill({ status: 200, contentType: 'application/json', headers: { ...cors, location: session }, body: '{}' })
    }
    if (req.method() === 'PUT' && req.url().includes('upload_id=')) {
      await new Promise((resolve) => setTimeout(resolve, google.uploadDelay))
      const body = { id: `google-${newId()}` }
      return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) })
    }
    const body = req.method() === 'POST' ? { id: `google-${newId()}` } : {}
    return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) })
  })

  // Live updates (Supabase Realtime, Phoenix protocol): every channel
  // joins fine, nothing ever changes.
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    ws.onMessage((message) => {
      const [joinRef, ref, topic, event] = JSON.parse(String(message))
      if (event === 'phx_join' || event === 'heartbeat' || event === 'access_token' || event === 'phx_leave') {
        ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: [] } }]))
      }
    })
  })

  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname
    const json = (body, status = 200, headers = {}) =>
      route.fulfill({ status, contentType: 'application/json', headers: { ...cors, ...headers }, body: JSON.stringify(body) })

    if (req.method() === 'OPTIONS') return json({})
    if (path.startsWith('/auth/v1/user')) return json(session(USER).user)
    if (path.startsWith('/auth/v1/token')) {
      writes.push({ auth: url.searchParams.get('grant_type'), body: req.postDataJSON() })
      return json(session(USER))
    }
    if (path.startsWith('/auth/')) return json({})
    if (path.startsWith('/functions/')) return json({ configured: false })
    if (path.startsWith('/rest/v1/rpc/')) {
      const fn = path.split('/').pop()
      if (fn === 'is_member') return json(member)
      writes.push({ rpc: fn, body: req.postDataJSON() })
      return json(null)
    }
    if (!path.startsWith('/rest/v1/')) return json({})

    const table = path.split('/').pop()
    tables[table] ??= []
    const single = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object')
    const answer = (rows) => {
      if (single) return rows[0] ? json(rows[0]) : json({ code: 'PGRST116', message: 'no rows', details: '', hint: null }, 406)
      return json(rows, req.method() === 'POST' ? 201 : 200)
    }

    if (req.method() === 'GET' || req.method() === 'HEAD') {
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const limit = Number(url.searchParams.get('limit') ?? 100000)
      const rows = filterRows(tables[table], url.searchParams).slice(offset, offset + limit)
      if (single) return answer(rows)
      return json(rows, 200, { 'content-range': `${offset}-${offset + rows.length - 1}/*` })
    }
    if (req.method() === 'POST') {
      const body = req.postDataJSON()
      const rows = (Array.isArray(body) ? body : [body]).map((row) => ({
        id: newId(),
        created_at: new Date().toISOString(),
        created_by: USER.id,
        author_name: table === 'diary_entries' ? USER.name : undefined,
        ...row,
      }))
      tables[table].push(...rows)
      writes.push({ table, method: 'POST', body })
      return answer(rows)
    }
    if (req.method() === 'PATCH') {
      const body = req.postDataJSON()
      const rows = filterRows(tables[table], url.searchParams)
      rows.forEach((row) => Object.assign(row, body))
      writes.push({ table, method: 'PATCH', body, filter: url.search })
      return answer(rows)
    }
    if (req.method() === 'DELETE') {
      const gone = new Set(filterRows(tables[table], url.searchParams))
      tables[table] = tables[table].filter((row) => !gone.has(row))
      writes.push({ table, method: 'DELETE', filter: url.search })
      return json([], 204)
    }
    return json({})
  })

  await page.goto(path)
  return { writes, errors, tables }
}

// Opens a tab by its name, on phones through "Mehr".
export async function openTab(page, label) {
  await page.getByRole('tablist').waitFor()
  const tab = page.getByRole('tab', { name: label, exact: true })
  if (await tab.isVisible()) return tab.click()
  await page.locator('.tab-more').click()
  await page.getByRole('dialog', { name: 'Weitere Bereiche' }).getByRole('button', { name: label }).click()
}
