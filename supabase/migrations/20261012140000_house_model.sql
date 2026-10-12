-- The 3D model of the house (Haus tab). Moved here from the Haus3D page.
-- The model and the site data stay in the database, not in the
-- repository: they include the address, the floor plans and the terrain.
-- Safe to run again: it only creates what is missing.

-- Versions of the model (Bestand, Variante A, …). `model` is the whole
-- model as JSON (walls, openings, slabs, roof, furniture …). Stored as
-- json, not jsonb, so the text keeps its key order for the editor.
-- Exactly one version is current: it opens first. Locked versions
-- (Bestand) and the current one can't be deleted.
create table if not exists public.house_versions (
  id text primary key default gen_random_uuid()::text,
  name text not null check (length(trim(name)) > 0),
  note text not null default '',
  parent_id text references public.house_versions (id) on delete set null,
  model json not null,
  is_current boolean not null default false,
  locked boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create unique index if not exists house_versions_one_current
  on public.house_versions (is_current) where is_current;

-- Site data around the house (terrain from the laser scan, neighbouring
-- buildings, roads, trees, power line); one row, id 'site'.
create table if not exists public.house_context (
  id text primary key,
  data json not null,
  updated_at timestamptz not null default now()
);

-- Row level security: members can read and change everything, nobody else
-- can see anything. Deleting skips the current and locked versions.
alter table public.house_versions enable row level security;
alter table public.house_context enable row level security;

drop policy if exists "members can read" on public.house_versions;
create policy "members can read"
  on public.house_versions for select to authenticated
  using (public.is_member());

drop policy if exists "members can add" on public.house_versions;
create policy "members can add"
  on public.house_versions for insert to authenticated
  with check (public.is_member());

drop policy if exists "members can change" on public.house_versions;
create policy "members can change"
  on public.house_versions for update to authenticated
  using (public.is_member())
  with check (public.is_member());

drop policy if exists "members can delete unlocked versions" on public.house_versions;
create policy "members can delete unlocked versions"
  on public.house_versions for delete to authenticated
  using (public.is_member() and not is_current and not locked);

drop policy if exists "members have full access" on public.house_context;
create policy "members have full access"
  on public.house_context for all to authenticated
  using (public.is_member())
  with check (public.is_member());

grant select, insert, update, delete on public.house_versions to authenticated;
grant select, insert, update, delete on public.house_context to authenticated;

-- Makes one version the current one. Two steps, because the unique index
-- allows only one current version at any moment.
create or replace function public.set_current_house_version(version_id text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (select 1 from public.house_versions where id = version_id) then
    raise exception 'house version % not found', version_id using errcode = 'P0002';
  end if;
  update public.house_versions set is_current = false where is_current and id <> version_id;
  update public.house_versions set is_current = true where id = version_id;
end
$$;

revoke all on function public.set_current_house_version(text) from public, anon;
grant execute on function public.set_current_house_version(text) to authenticated;
