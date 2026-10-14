-- The heating demand calculation (Heizwärme tab): building parts with
-- their areas and U-values, climate and ventilation settings, as one
-- JSON document. One row, id 'main'. Only members can see or change it.
-- Safe to run again: it only creates what is missing.

create table if not exists public.heat_demand (
  id text primary key,
  data jsonb not null,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

alter table public.heat_demand enable row level security;

drop policy if exists "members have full access" on public.heat_demand;
create policy "members have full access"
  on public.heat_demand for all to authenticated
  using (public.is_member())
  with check (public.is_member());

grant select, insert, update, delete on public.heat_demand to authenticated;
