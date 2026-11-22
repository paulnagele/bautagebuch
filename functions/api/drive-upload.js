// Cloudflare Pages Function at /api/drive-upload, for uploads that keep
// going while the app is closed (src/backgroundUpload.js).
//
// The browser's Background Fetch can only send a cross-site request that
// needs no CORS preflight, and Google Drive wants each file as a PUT,
// which does. So the browser sends the file here, to the app's own
// address, and this passes it on to Drive unchanged. `target` is the
// file's resumable upload session (opened by the app with the member's
// own Drive access); that address itself authorizes the upload, so no
// token is needed or kept here. Only Drive upload sessions are accepted,
// and only from the app's own pages.

const DRIVE_SESSION = /^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?(.*&)?upload_id=/

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

// GET: lets the app check that the relay exists on this site.
export function onRequestGet() {
  return json(200, { relay: true })
}

async function relay({ request }) {
  const url = new URL(request.url)
  const target = url.searchParams.get('target') ?? ''
  if (!DRIVE_SESSION.test(target)) return json(400, { error: { message: 'Keine Drive-Upload-Adresse.' } })
  const origin = request.headers.get('Origin')
  const site = request.headers.get('Sec-Fetch-Site')
  // Background Fetch reports its requests as Sec-Fetch-Site "none".
  if ((origin && origin !== url.origin) || (site && site !== 'same-origin' && site !== 'none')) {
    return json(403, { error: { message: 'Nur aus dem Bautagebuch.' } })
  }
  // Passed on as a stream; with its length, so Drive gets Content-Length
  // instead of a chunked upload.
  const length = Number(request.headers.get('Content-Length'))
  const body =
    request.body && length > 0 && typeof FixedLengthStream === 'function'
      ? request.body.pipeThrough(new FixedLengthStream(length))
      : request.body
  const response = await fetch(target, {
    method: 'PUT',
    headers: { 'Content-Type': request.headers.get('Content-Type') || 'application/octet-stream' },
    body,
    duplex: 'half',
  })
  return new Response(response.body, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

export const onRequestPut = relay
export const onRequestPost = relay
