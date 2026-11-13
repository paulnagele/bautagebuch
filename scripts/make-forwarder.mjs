// Builds the forwarding site that GitHub Pages serves once the main app
// has moved to its own address (repository variable MAIN_URL).
//
// Every old link keeps working: the page sends the browser to the same
// path at the new address, with the query (?tab=…) and the part after #
// (the key of shared house links, haus.html#k=…) unchanged.
//
// Usage: node scripts/make-forwarder.mjs <MAIN_URL> <base path> <out dir>
//   e.g. node scripts/make-forwarder.mjs https://bau.example.com /bautagebuch forward
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const [target, basePath = '', outDir = 'forward'] = process.argv.slice(2)
let url
try {
  url = new URL(target)
} catch {
  console.log(`::error title=MAIN_URL::"${target}" is not a valid address (e.g. https://bau.example.com).`)
  process.exit(1)
}
if (url.protocol !== 'https:') {
  console.log('::error title=MAIN_URL::The address must start with https://.')
  process.exit(1)
}
const main = url.origin + url.pathname.replace(/\/+$/, '')
const base = basePath.replace(/\/+$/, '')

const page = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Bautagebuch ist umgezogen</title>
<script>
  (function () {
    var main = ${JSON.stringify(main)}
    var base = ${JSON.stringify(base)}
    var p = location.pathname
    if (base && p.indexOf(base) === 0) p = p.slice(base.length)
    if (p === '/index.html') p = '/'
    // Loop guard: a browser that still remembers an old redirect from the
    // new address back to this one would bounce forever. After 3 visits
    // within a minute, stop and show the link and a hint instead.
    var now = Date.now(), hits = []
    try { hits = JSON.parse(sessionStorage.getItem('forward-hits') || '[]') } catch (e) {}
    hits = hits.filter(function (t) { return now - t < 60000 }).concat(now)
    try { sessionStorage.setItem('forward-hits', JSON.stringify(hits)) } catch (e) {}
    if (hits.length > 3) {
      document.documentElement.className = 'loop'
      return
    }
    location.replace(main + (p || '/') + location.search + location.hash)
  })()
</script>
</head>
<body style="font-family: system-ui, sans-serif; padding: 24px">
<p>Das Bautagebuch ist umgezogen: <a id="to" href="${main}/">${main.replace(/^https:\/\//, '')}</a></p>
<p class="hint">Falls die Seite immer wieder hierher zurückspringt: Dein Browser merkt sich noch eine alte Weiterleitung.
Lösche in den Browser-Einstellungen die Website-Daten von ${url.hostname.split('.').slice(-2).join('.')} und öffne den Link dann neu.</p>
<style>.hint { display: none; color: #555 } .loop .hint { display: block }</style>
<script>document.getElementById('to').href = ${JSON.stringify(main)} + '/' + location.search + location.hash</script>
</body>
</html>
`

// The app's old service worker would otherwise keep answering from its
// cache. This one replaces it and removes itself; saved drafts in the
// Cache API are left alone.
const sw = `self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(self.registration.unregister())
})
`

await mkdir(outDir, { recursive: true })
for (const name of ['index.html', 'haus.html', '404.html']) {
  await writeFile(path.join(outDir, name), page)
}
await writeFile(path.join(outDir, 'sw.js'), sw)
console.log(`Forwarding ${base || '/'} → ${main}`)
