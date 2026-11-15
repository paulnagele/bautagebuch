-- Haus tab: changes to the house model show up without reloading the app.
-- The viewer listens to house_versions over Realtime and compares
-- updated_at, so it only downloads a model again when that model changed
-- (e.g. the Haus chat or Claude's login changed the open version in place).
-- Safe to run again.

-- New column; existing rows get their creation time.
do
$$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'house_versions' and column_name = 'updated_at'
  ) then
    alter table public.house_versions add column updated_at timestamptz not null default now();
    update public.house_versions set updated_at = created_at;
  end if;
end
$$;

create or replace function public.touch_house_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.model::text is distinct from old.model::text then
    new.updated_at := now();
  end if;
  return new;
end
$$;

drop trigger if exists house_versions_touch on public.house_versions;
create trigger house_versions_touch
  before update on public.house_versions
  for each row execute function public.touch_house_version();

do
$$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'house_versions'
  ) then
    alter publication supabase_realtime add table public.house_versions;
  end if;
end
$$;
