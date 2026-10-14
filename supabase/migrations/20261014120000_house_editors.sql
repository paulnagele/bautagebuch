-- House editors: logins that may only work on the house model, for
-- example the login Claude uses to read the model and suggest changes.
-- They are not members: they can't see the diary, money, contacts or
-- anything else. They can read the versions and the site data and add
-- new versions, but can't change, delete or make any version the
-- current one; members decide that in the Haus tab.
-- Add one in the SQL Editor:
--   insert into public.house_editors (email) values ('…') on conflict do nothing;
-- Safe to run again: it only creates what is missing.

create table if not exists public.house_editors (
  email text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);

-- No policies: nobody reads or changes the list through the API.
alter table public.house_editors enable row level security;

-- True when the signed-in user's email is in public.house_editors.
create or replace function public.is_house_editor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.house_editors
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_house_editor() from public, anon;
grant execute on function public.is_house_editor() to authenticated;

drop policy if exists "house editors can read" on public.house_versions;
create policy "house editors can read"
  on public.house_versions for select to authenticated
  using (public.is_house_editor());

drop policy if exists "house editors can add" on public.house_versions;
create policy "house editors can add"
  on public.house_versions for insert to authenticated
  with check (public.is_house_editor() and not is_current and not locked);

drop policy if exists "house editors can read" on public.house_context;
create policy "house editors can read"
  on public.house_context for select to authenticated
  using (public.is_house_editor());
