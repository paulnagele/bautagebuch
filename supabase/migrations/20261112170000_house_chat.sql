-- ---------------------------------------------------------------------------
-- Claude chat in the Haus tab. A member writes a request; the Edge
-- Function haus-chat (supabase/functions/haus-chat) starts a Claude Code
-- session on the owner's Claude account, which changes the model, saves
-- a new "Claude: …" version and writes its answer back here with the
-- house editor login (see …_house_editors.sql and scripts/haus/house.mjs).
-- Safe to run again: it only creates what is missing.

create table if not exists public.house_chat (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  -- 'user': a member's request; 'claude': Claude's answer to one.
  role text not null check (role in ('user', 'claude')),
  text text not null check (length(trim(text)) > 0),
  -- user: the version open when asking; claude: the version it saved (or null).
  version_id text references public.house_versions (id) on delete set null,
  -- claude: the request this answers.
  reply_to uuid references public.house_chat (id) on delete cascade,
  -- user requests: queued → started (session running) → done | failed.
  status text check (status in ('queued', 'started', 'working', 'done', 'failed')),
  session_url text,
  error text
);

create index if not exists house_chat_created on public.house_chat (created_at);
create index if not exists house_chat_reply_to on public.house_chat (reply_to);

alter table public.house_chat enable row level security;

drop policy if exists "members have full access" on public.house_chat;
create policy "members have full access"
  on public.house_chat for all to authenticated
  using (public.is_member())
  with check (public.is_member());

-- Claude's house-only login: reads the chat, answers, and moves a
-- request's status along. It can't write requests of its own.
drop policy if exists "house editors can read" on public.house_chat;
create policy "house editors can read"
  on public.house_chat for select to authenticated
  using (public.is_house_editor());

drop policy if exists "house editors can answer" on public.house_chat;
create policy "house editors can answer"
  on public.house_chat for insert to authenticated
  with check (public.is_house_editor() and role = 'claude');

drop policy if exists "house editors can update requests" on public.house_chat;
create policy "house editors can update requests"
  on public.house_chat for update to authenticated
  using (public.is_house_editor() and role = 'user')
  with check (public.is_house_editor() and role = 'user');

grant select, insert, update, delete on public.house_chat to authenticated;

-- Live updates: the answer shows up in the open chat.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'house_chat'
  ) then
    alter publication supabase_realtime add table public.house_chat;
  end if;
end
$$;
