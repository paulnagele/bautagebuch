-- A share link can show several versions; the visitor switches between
-- them on haus.html. Replaces house_shares.version_id with a list.
-- Safe to run again: it only creates what is missing.

create table if not exists public.house_share_versions (
  share_id uuid not null references public.house_shares (id) on delete cascade,
  version_id text not null references public.house_versions (id) on delete cascade,
  position integer not null default 0,
  primary key (share_id, version_id)
);

create index if not exists house_share_versions_version on public.house_share_versions (version_id);

alter table public.house_share_versions enable row level security;

drop policy if exists "members have full access" on public.house_share_versions;
create policy "members have full access"
  on public.house_share_versions for all to authenticated
  using (public.is_member())
  with check (public.is_member());

grant select, insert, update, delete on public.house_share_versions to authenticated;

-- A shared version can't be deleted while a link shows it.
drop policy if exists "members can delete unlocked versions" on public.house_versions;
create policy "members can delete unlocked versions"
  on public.house_versions for delete to authenticated
  using (
    public.is_member() and not is_current and not locked
    and not exists (select 1 from public.house_share_versions s where s.version_id = house_versions.id)
  );

-- Move the links made so far, then drop the old column.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'house_shares' and column_name = 'version_id'
  ) then
    insert into public.house_share_versions (share_id, version_id, position)
      select id, version_id, 0 from public.house_shares
      on conflict do nothing;
    alter table public.house_shares drop column version_id;
  end if;
end
$$;

-- What a link shows: its versions in order (name, note, date, model) and
-- the site data, or null when the link doesn't exist (any more) or shows
-- no version.
create or replace function public.get_shared_house(token text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'versions', json_agg(
      json_build_object(
        'id', v.id,
        'name', v.name,
        'note', v.note,
        'created_at', v.created_at,
        'model', v.model
      )
      order by sv.position, v.created_at
    ),
    'context', (select c.data from public.house_context c where c.id = 'site')
  )
  from public.house_shares s
  join public.house_share_versions sv on sv.share_id = s.id
  join public.house_versions v on v.id = sv.version_id
  where length(token) between 20 and 100
    and s.token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex')
  having count(*) > 0;
$$;

revoke all on function public.get_shared_house(text) from public;
grant execute on function public.get_shared_house(text) to anon, authenticated;
