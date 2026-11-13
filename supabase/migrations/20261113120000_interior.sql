-- Einrichtung tab: a mood board per room. Members collect pictures of
-- things they want in a room (photos, screenshots, renders of the house
-- model) with a title, a note and a favourite star.
--
-- interior_rooms: the tab's own list of rooms. It is filled once from the
-- house model's room names (in the app), then kept by hand; nothing links
-- back to the model. `folder` is the Drive folder name under
-- Haus/Einrichtung/, fixed when the room is created, so renaming a room
-- does not move its pictures.
--
-- interior_items: one picture (a Drive file ID) in a room. `view` is set
-- for renders of the house model: where the camera stood, as plain
-- numbers ({ x, feet, z, yaw, pitch, fov }, plus the version's name as
-- text), so the same view can be rendered again from a newer version.
-- Safe to run again: it only creates what is missing.

create table if not exists public.interior_rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0 and name = trim(name)),
  folder text not null check (length(trim(folder)) > 0),
  sort_order integer not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.interior_items (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.interior_rooms (id) on delete cascade,
  photo_id text not null check (length(photo_id) > 0),
  title text not null default '',
  note text not null default '',
  favorite boolean not null default false,
  view jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists interior_items_room_id on public.interior_items (room_id);

-- Row level security: every member can read and change everything,
-- nobody else can see anything.
alter table public.interior_rooms enable row level security;
alter table public.interior_items enable row level security;

drop policy if exists "members have full access" on public.interior_rooms;
create policy "members have full access"
  on public.interior_rooms for all to authenticated
  using (public.is_member())
  with check (public.is_member());

drop policy if exists "members have full access" on public.interior_items;
create policy "members have full access"
  on public.interior_items for all to authenticated
  using (public.is_member())
  with check (public.is_member());

grant select, insert, update, delete on public.interior_rooms to authenticated;
grant select, insert, update, delete on public.interior_items to authenticated;

-- Live updates, like the other shared tables (see 20261002190000_realtime.sql).
do $$
declare
  t text;
begin
  foreach t in array array['interior_rooms', 'interior_items'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;
