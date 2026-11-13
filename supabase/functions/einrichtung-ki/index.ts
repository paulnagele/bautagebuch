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
// Body { check: true } only answers { configured, model }.
// Body { base, refs, note } with images as data URLs (JPEG/PNG) answers
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

function prompt(refCount: number, note: string) {
  return [
    'The first image is a view of a room in a house that is being planned (a simple 3D rendering or a photo).',
    refCount > 0
      ? `The other ${refCount === 1 ? 'image shows a piece' : `${refCount} images show pieces`} of furniture, lamps, materials or decoration the owners want in this room.`
      : '',
    'Create a photorealistic interior photo of exactly this room, furnished' +
      (refCount > 0 ? ' with these items (keep their look, colour and material).' : ' in a warm, modern style.'),
    'Keep the room itself unchanged: same camera position and perspective, same walls, windows, doors, stairs, ceiling height and floor. Only add or replace furniture, lighting, textiles and decoration, and make the surfaces look real.',
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
  const refs = Array.isArray(input.refs) ? input.refs.filter(isImage).slice(0, MAX_REFS) : []
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 1000) : ''
  if (!isImage(base)) return reply(400, { error: 'Das Raumbild fehlt.' })

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'X-Title': 'Bautagebuch Einrichtung',
    },
    body: JSON.stringify({
      model,
      modalities: ['image', 'text'],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt(refs.length, note) },
            { type: 'image_url', image_url: { url: base } },
            ...refs.map((url) => ({ type: 'image_url', image_url: { url } })),
          ],
        },
      ],
    }),
  })
  const body = await response.json().catch(() => ({}))
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
  const image = findImage(body)
  if (!image) {
    const text = body?.choices?.[0]?.message?.content
    return reply(502, {
      error: `Das Modell ${model} hat kein Bild geliefert${typeof text === 'string' && text ? `: ${text.slice(0, 300)}` : '.'}`,
    })
  }
  return reply(200, { image, model })
})
