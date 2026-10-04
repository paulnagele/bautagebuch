-- Schedule slots: the bars of the Gantt chart on the Zeitplan tab. Each
-- slot belongs to an expense category from Finanzen (e.g. "Dach") and has
-- a task name and a start and end date. A category can have any number.
-- Safe to run again: it only creates what is missing.

create table if not exists public.schedule_slots (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.finance_categories (id) on delete cascade,
  name text not null check (length(trim(name)) > 0 and name = trim(name)),
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create index if not exists schedule_slots_category_id_idx
  on public.schedule_slots (category_id);

-- Row level security: every member can read and change everything,
-- nobody else can see anything.
alter table public.schedule_slots enable row level security;

drop policy if exists "members have full access" on public.schedule_slots;
create policy "members have full access"
  on public.schedule_slots for all to authenticated
  using (public.is_member())
  with check (public.is_member());

grant select, insert, update, delete on public.schedule_slots to authenticated;

-- Live updates, like the other shared tables (see 20261002190000_realtime.sql).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'schedule_slots'
  ) then
    alter publication supabase_realtime add table public.schedule_slots;
  end if;
end
$$;
