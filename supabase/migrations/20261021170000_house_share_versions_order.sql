-- A link's versions show in the order they were added. Positions could
-- repeat after taking a version off and adding another, so the order now
-- comes from when each version was added.
-- Safe to run again: it only changes what is missing.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'house_share_versions' and column_name = 'added_at'
  ) then
    alter table public.house_share_versions add column added_at timestamptz;
    -- Versions added so far: keep their order by position.
    update public.house_share_versions
      set added_at = timestamptz '2026-10-21 00:00:00+00' + position * interval '1 second';
    alter table public.house_share_versions
      alter column added_at set default clock_timestamp(),
      alter column added_at set not null;
  end if;
end
$$;

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
      order by sv.added_at, sv.position
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
