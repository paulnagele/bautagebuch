-- Share links for the house model: a member makes a secret link for one
-- version, and whoever opens it sees that version on haus.html without
-- signing in, always as it is now in the database, with the site data.
-- Nothing else can be read with a link: no other version, no link list,
-- nothing outside the house.
-- Safe to run again: it only creates what is missing.

-- One row per link. Only the SHA-256 hash of the secret part of the link
-- is stored (hex); the link itself is shown once, when it is made.
-- Revoking a link deletes its row.
create table if not exists public.house_shares (
  id uuid primary key default gen_random_uuid(),
  label text not null check (length(trim(label)) > 0),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  version_id text not null references public.house_versions (id) on delete cascade,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists house_shares_version on public.house_shares (version_id);

-- Only members manage links. House editors (Claude's login) and visitors
-- without a login can't read the table.
alter table public.house_shares enable row level security;

drop policy if exists "members have full access" on public.house_shares;
create policy "members have full access"
  on public.house_shares for all to authenticated
  using (public.is_member())
  with check (public.is_member());

grant select, insert, update, delete on public.house_shares to authenticated;

-- A shared version can't be deleted while a link points to it.
drop policy if exists "members can delete unlocked versions" on public.house_versions;
create policy "members can delete unlocked versions"
  on public.house_versions for delete to authenticated
  using (
    public.is_member() and not is_current and not locked
    and not exists (select 1 from public.house_shares s where s.version_id = house_versions.id)
  );

-- What a link shows: the linked version (name, note, date, model) and the
-- site data, or null when the link doesn't exist (any more). The only
-- way in for visitors without a login.
create or replace function public.get_shared_house(token text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'name', v.name,
    'note', v.note,
    'created_at', v.created_at,
    'model', v.model,
    'context', (select c.data from public.house_context c where c.id = 'site')
  )
  from public.house_shares s
  join public.house_versions v on v.id = s.version_id
  where length(token) between 20 and 100
    and s.token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex');
$$;

revoke all on function public.get_shared_house(text) from public;
grant execute on function public.get_shared_house(text) to anon, authenticated;
