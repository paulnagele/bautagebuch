// Starts Claude for a request written in the Haus tab chat.
//
// The app saves the request in public.house_chat and calls this function
// with its id. The function checks that the caller is a member, then
// calls the API trigger of a Claude Code scheduled task on the owner's
// Claude account. That starts a cloud session which reads the request,
// changes the model and answers in house_chat (see docs/haus-chat.md).
//
// The task's API trigger URL (…/routines/trig_…/fire) and token are set
// in the app (Einstellungen → Haus-Chat, table secret_settings, read here
// with the service role), or as Edge Function secrets HAUS_CHAT_FIRE_URL /
// HAUS_CHAT_FIRE_TOKEN, which win. Never in the repo.
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are
// provided by Supabase.
//
// Body { check: true } only answers { configured } (for the app's button).
import { createClient } from 'npm:@supabase/supabase-js@2.117.2'

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

// The trigger: secrets first, else what members set in the app.
async function triggerSettings() {
  let fireUrl = Deno.env.get('HAUS_CHAT_FIRE_URL') ?? ''
  let fireToken = Deno.env.get('HAUS_CHAT_FIRE_TOKEN') ?? ''
  if (fireUrl && fireToken) return { fireUrl, fireToken }
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
  const { data } = await admin
    .from('secret_settings')
    .select('key, value')
    .in('key', ['haus_chat_fire_url', 'haus_chat_fire_token'])
  for (const row of data ?? []) {
    if (row.key === 'haus_chat_fire_url') fireUrl = row.value
    if (row.key === 'haus_chat_fire_token') fireToken = row.value
  }
  return { fireUrl, fireToken }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return reply(405, { error: 'Nur POST.' })

  // Acts as the caller, so row level security decides what they may see.
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
    // handled below
  }

  const { fireUrl, fireToken } = await triggerSettings()
  if (input.check === true) return reply(200, { configured: Boolean(fireUrl && fireToken) })
  if (!fireUrl || !fireToken) {
    return reply(503, { error: 'Der Claude-Chat ist noch nicht eingerichtet (Einstellungen → Haus-Chat).' })
  }

  const id = String(input.id ?? '')
  if (!/^[0-9a-f-]{36}$/.test(id)) return reply(400, { error: 'Anfrage fehlt.' })

  const { data: row, error: rowError } = await supabase
    .from('house_chat')
    .select('id, role, status')
    .eq('id', id)
    .maybeSingle()
  if (rowError) return reply(500, { error: rowError.message })
  if (!row || row.role !== 'user') return reply(404, { error: 'Anfrage nicht gefunden.' })
  if (row.status !== 'queued') return reply(409, { error: 'Diese Anfrage läuft schon.' })

  const response = await fetch(fireUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${fireToken}`,
      'anthropic-beta': 'experimental-cc-routine-2026-04-01',
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    // Only the id: the session reads the request itself from house_chat.
    body: JSON.stringify({ text: `Haus-Chat-Anfrage ${id}` }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message =
      response.status === 429
        ? 'Zu viele Anfragen in dieser Stunde. Bitte später noch einmal.'
        : `Claude ließ sich nicht starten (${response.status}).`
    await supabase.from('house_chat').update({ status: 'failed', error: message }).eq('id', id)
    return reply(502, { error: message })
  }

  const sessionUrl = typeof body.claude_code_session_url === 'string' ? body.claude_code_session_url : null
  // Only moves a request that is still queued: the session may already
  // have picked it up and set it to working.
  await supabase.from('house_chat').update({ session_url: sessionUrl }).eq('id', id)
  await supabase.from('house_chat').update({ status: 'started' }).eq('id', id).eq('status', 'queued')
  return reply(200, { sessionUrl })
})
