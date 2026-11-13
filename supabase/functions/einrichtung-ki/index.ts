// KI-Entwurf for the Einrichtung tab: sends a view of a room and pictures
// of things wanted in it to an image model on OpenRouter and returns the
// furnished room as an image. Nothing is stored here: the app saves the
// result as a picture in the room (Drive), if the member keeps it.
//
// The OpenRouter key and model are set in the app (Einstellungen →
// KI-Entwürfe, table secret_settings, read here with the service role),
// or as Edge Function secrets OPENROUTER_API_KEY / OPENROUTER_MODEL, which
// win. Never in the repo.
//
// Image models that also write text go through chat completions; pure
// image models (e.g. Qwen Image) through the Image API (/api/v1/images,
// pictures as input_references), used when OpenRouter asks for it.
//
// Body { check: true } only answers { configured, model }.
// Body { base, refs: [{ image, title, note }], note, room, openings } with
// images as data URLs (JPEG/PNG); each picture's title and note, the room's
// name and the windows/doors seen in the base view (from Aufnehmen) go
// into the prompt. Answers
// { image } (a data URL) or { error }.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2'

const DEFAULT_MODEL = 'google/gemini-2.5-flash-image'
const MAX_REFS = 8

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

async function settings() {
  let key = Deno.env.get('OPENROUTER_API_KEY') ?? ''
  let model = Deno.env.get('OPENROUTER_MODEL') ?? ''
  if (!key || !model) {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })
    const { data } = await admin
      .from('secret_settings')
      .select('key, value')
      .in('key', ['openrouter_key', 'openrouter_model'])
    for (const row of data ?? []) {
      if (row.key === 'openrouter_key' && !key) key = row.value
      if (row.key === 'openrouter_model' && !model) model = row.value
    }
  }
  return { key, model: model || DEFAULT_MODEL }
}

const isImage = (v: unknown): v is string =>
  typeof v === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length < 8_000_000

type Label = { title: string; note: string }

function prompt(refCount: number, note: string, labels: Label[] = [], room = '', openings: string[] = []) {
  const described = labels
    .map((label, i) => {
      const text = [label.title, label.note].filter(Boolean).join(' – ')
      return text ? `Image ${i + 2}: ${text}` : ''
    })
    .filter(Boolean)
  return [
    `Edit the first image. It is a view of ${room ? `the room "${room}" (German name)` : 'a room'} in a house that is being planned (a simple 3D rendering or a photo).`,
    refCount > 0
      ? `The other ${refCount === 1 ? 'image shows a piece' : `${refCount} images show pieces`} of furniture, lamps, materials or decoration the owners want in this room.`
      : '',
    described.length ? `What the owners wrote about these images (German):\n${described.join('\n')}` : '',
    'Turn the first image into a photorealistic interior photo of exactly this room, furnished' +
      (refCount > 0 ? ' with these items (keep their look, colour and material).' : ' in a warm, modern style.'),
    'Keep the architecture unchanged: same camera position and perspective, same walls, ceiling height, floor, stairs and built-in parts.',
    openings.length
      ? `Every window and door must stay exactly where it is, with the same size, clearly visible with daylight coming in. Do not remove, move, shrink or wall up any of them, and do not cover them with furniture or closed curtains. Visible in the first image, from left to right: ${openings.join('; ')}.`
      : 'Keep every window and door exactly where it is, with the same size, and do not remove, wall up or cover any of them.',
    'Only add or replace furniture, lighting, textiles and decoration, and make the surfaces look real.',
    note ? `Wishes of the owners (German): ${note}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

// The generated image as a data URL, wherever the model put it.
function findImage(body: any): string | null {
  const message = body?.choices?.[0]?.message
  for (const image of message?.images ?? []) {
    const url = image?.image_url?.url ?? image?.url
    if (typeof url === 'string' && url.startsWith('data:image/')) return url
  }
  if (Array.isArray(message?.content)) {
    for (const part of message.content) {
      const url = part?.image_url?.url
      if (typeof url === 'string' && url.startsWith('data:image/')) return url
    }
  }
  return null
}

// The first image of an Image API answer ({ data: [{ b64_json, media_type }] }) as a data URL.
function findApiImage(body: any): string | null {
  for (const item of body?.data ?? []) {
    if (typeof item?.b64_json === 'string' && item.b64_json) {
      return `data:${item.media_type || 'image/png'};base64,${item.b64_json}`
    }
    if (typeof item?.url === 'string' && item.url.startsWith('data:image/')) return item.url
  }
  return null
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return reply(405, { error: 'Nur POST.' })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: request.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  })
  const { data: member, error: memberError } = await supabase.rpc('is_member')
  if (memberError || member !== true) return reply(403, { error: 'Nur für Mitglieder.' })

  let input: Record<string, unknown> = {}
  try {
    input = await request.json()
  } catch {
    return reply(400, { error: 'Ungültige Anfrage.' })
  }

  const { key, model } = await settings()
  if (input.check === true) return reply(200, { configured: Boolean(key), model })
  if (!key) return reply(503, { error: 'Die KI-Entwürfe sind noch nicht eingerichtet (Einstellungen → KI-Entwürfe).' })

  const base = input.base
  // refs: data URLs, or { image, title, note } so the model knows what each picture is
  const entries = (Array.isArray(input.refs) ? input.refs : [])
    .map((r: any) => (typeof r === 'string' ? { image: r, title: '', note: '' } : r))
    .filter((r: any) => r && isImage(r.image))
    .slice(0, MAX_REFS)
  const refs: string[] = entries.map((r: any) => r.image)
  const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
  const labels: Label[] = entries.map((r: any) => ({ title: clip(r.title, 120), note: clip(r.note, 400) }))
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 1000) : ''
  if (!isImage(base)) return reply(400, { error: 'Das Raumbild fehlt.' })

  const headers = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    'X-Title': 'Bautagebuch Einrichtung',
  }
  const room = typeof input.room === 'string' ? input.room.trim().slice(0, 80) : ''
  const openings = (Array.isArray(input.openings) ? input.openings : [])
    .filter((o: unknown) => typeof o === 'string')
    .slice(0, 12)
    .map((o: string) => o.slice(0, 160))
  const text = prompt(refs.length, note, labels, room, openings)
  const images = [base, ...refs].map((url) => ({ type: 'image_url', image_url: { url } }))

  // Models that also write text (Gemini, GPT-5 image, …) answer on chat
  // completions; pure image models (Qwen Image, Flux, …) only on the
  // Image API. Try chat first and switch when OpenRouter says so.
  let response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      modalities: ['image', 'text'],
      messages: [{ role: 'user', content: [{ type: 'text', text }, ...images] }],
    }),
  })
  let body = await response.json().catch(() => ({}))
  let image: string | null = null
  if (!response.ok && /api\/v1\/images|image generation model/i.test(String(body?.error?.message ?? ''))) {
    response = await fetch('https://openrouter.ai/api/v1/images', {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, prompt: text, input_references: images }),
    })
    body = await response.json().catch(() => ({}))
    if (response.ok) image = findApiImage(body)
  } else if (response.ok) {
    image = findImage(body)
  }
  if (!response.ok) {
    const detail = body?.error?.message ? `: ${String(body.error.message).slice(0, 300)}` : ''
    const message =
      response.status === 401
        ? 'Der OpenRouter-Schlüssel stimmt nicht (Einstellungen → KI-Entwürfe).'
        : response.status === 402
          ? 'Das Guthaben bei OpenRouter ist aufgebraucht.'
          : response.status === 429
            ? 'Zu viele Anfragen. Bitte gleich noch einmal.'
            : `OpenRouter-Fehler (${response.status})${detail}`
    return reply(502, { error: message })
  }
  if (!image) {
    const said = body?.choices?.[0]?.message?.content
    return reply(502, {
      error: `Das Modell ${model} hat kein Bild geliefert${typeof said === 'string' && said ? `: ${said.slice(0, 300)}` : '.'}`,
    })
  }
  return reply(200, { image, model })
})
