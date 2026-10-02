-- Milestones of the build (e.g. "Rohbau fertig", "Einzug"), kept on the
-- Zeitplan tab. The app also puts each one into the Google Calendar as an
-- all-day event; calendar_event_id is that event's ID.
-- Safe to run again: it only creates what is missing.

create table if not exists public.milestones (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  due_date date not null,
  reached boolean not null default false,
  calendar_event_id text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- Row level security: every member can read and change everything,
-- nobody else can see anything.
alter table public.milestones enable row level security;

drop policy if exists "members have full access" on public.milestones;
create policy "members have full access"
  on public.milestones for all to authenticated
  using (public.is_member())
  with check (public.is_member());

grant select, insert, update, delete on public.milestones to authenticated;

-- Live updates, like the other shared tables (see 20261002190000_realtime.sql).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'milestones'
  ) then
    alter publication supabase_realtime add table public.milestones;
  end if;
end
$$;
