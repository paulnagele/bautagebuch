// Starts Claude for a request written in the Haus tab chat.
//
// The app saves the request in public.house_chat and calls this function
// with its id. The function checks that the caller is a member, then
// calls the API trigger of a Claude Code scheduled task on the owner's
// Claude account. That starts a cloud session which reads the request,
// changes the model and answers in house_chat (see docs/haus-chat.md).
//
// Secrets (Supabase → Edge Functions → Secrets), never in the repo:
//   HAUS_CHAT_FIRE_URL    the task's API trigger URL (…/routines/trig_…/fire)
//   HAUS_CHAT_FIRE_TOKEN  the task's API token
// SUPABASE_URL and SUPABASE_ANON_KEY are provided by Supabase.
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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return reply(405, { error: 'Nur POST.' })

  const fireUrl = Deno.env.get('HAUS_CHAT_FIRE_URL')
  const fireToken = Deno.env.get('HAUS_CHAT_FIRE_TOKEN')
  if (!fireUrl || !fireToken) {
    return reply(503, { error: 'Der Claude-Chat ist noch nicht eingerichtet (Secrets fehlen).' })
  }

  // Acts as the caller, so row level security decides what they may see.
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: request.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  })
  const { data: member, error: memberError } = await supabase.rpc('is_member')
  if (memberError || member !== true) return reply(403, { error: 'Nur für Mitglieder.' })

  let id = ''
  try {
    id = String((await request.json()).id ?? '')
  } catch {
    // handled below
  }
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
