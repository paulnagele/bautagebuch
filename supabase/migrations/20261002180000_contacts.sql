-- Contacts: the people involved in the build (contractors, trades,
-- architect, authorities, suppliers) with how to reach them.
-- Safe to run again: it only creates what is missing.

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  role text not null default '',
  company text not null default '',
  phone text not null default '',
  email text not null default '',
  notes text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- Row level security: every member can read and change everything,
-- nobody else can see anything.
alter table public.contacts enable row level security;

drop policy if exists "members have full access" on public.contacts;
create policy "members have full access"
  on public.contacts for all to authenticated
  using (public.is_member())
  with check (public.is_member());

grant select, insert, update, delete on public.contacts to authenticated;
