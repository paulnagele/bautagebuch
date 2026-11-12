-- Haus chat: Claude changes the open version in place instead of saving
-- a new version each time (Paul's wish, 2026-11-12). Before each change
-- the old model is kept in house_model_backups, so a member can undo it
-- with "Rückgängig" in the chat.
-- Safe to run again: it only creates what is missing.

create table if not exists public.house_model_backups (
  id uuid primary key default gen_random_uuid(),
  version_id text not null references public.house_versions (id) on delete cascade,
  model json not null,
  created_at timestamptz not null default now()
);

create index if not exists house_model_backups_version
  on public.house_model_backups (version_id, created_at desc);

-- Only through the functions below; members may look at them.
alter table public.house_model_backups enable row level security;

drop policy if exists "members can read" on public.house_model_backups;
create policy "members can read"
  on public.house_model_backups for select to authenticated
  using (public.is_member());

grant select on public.house_model_backups to authenticated;

-- Claude's answer points at the backup of the change it made.
alter table public.house_chat
  add column if not exists backup_id uuid references public.house_model_backups (id) on delete set null;

-- Replaces a version's model, keeping the old one as a backup (the last
-- 30 per version). For members and house editors (Claude's login);
-- locked versions (e.g. Bestand) can't be changed. Returns the backup id.
create or replace function public.update_house_model(version_id text, model json)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  old_model json;
  is_locked boolean;
  backup uuid;
begin
  if not (public.is_member() or public.is_house_editor()) then
    raise exception 'Keine Berechtigung.';
  end if;
  select v.model, v.locked into old_model, is_locked
    from public.house_versions v where v.id = update_house_model.version_id for update;
  if not found then raise exception 'Version % gibt es nicht.', update_house_model.version_id; end if;
  if is_locked then raise exception 'Die Version ist gesperrt.'; end if;
  if json_typeof(update_house_model.model) <> 'object' or json_typeof(update_house_model.model -> 'walls') <> 'array' then
    raise exception 'Das ist kein Hausmodell.';
  end if;

  insert into public.house_model_backups (version_id, model)
    values (update_house_model.version_id, old_model)
    returning id into backup;
  update public.house_versions v set model = update_house_model.model
    where v.id = update_house_model.version_id;
  delete from public.house_model_backups b
    where b.version_id = update_house_model.version_id
      and b.id not in (
        select b2.id from public.house_model_backups b2
        where b2.version_id = update_house_model.version_id
        order by b2.created_at desc limit 30
      );
  return backup;
end;
$$;

revoke all on function public.update_house_model(text, json) from public, anon;
grant execute on function public.update_house_model(text, json) to authenticated;

-- Puts a backup back (members only) and removes it; the model it replaces
-- is kept as a new backup, so an undo can be undone too.
create or replace function public.restore_house_backup(backup_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.house_model_backups;
  again uuid;
begin
  if not public.is_member() then raise exception 'Keine Berechtigung.'; end if;
  select * into b from public.house_model_backups where id = restore_house_backup.backup_id;
  if not found then raise exception 'Diese Änderung lässt sich nicht mehr rückgängig machen.'; end if;
  again := public.update_house_model(b.version_id, b.model);
  delete from public.house_model_backups where id = b.id;
  return again;
end;
$$;

revoke all on function public.restore_house_backup(uuid) from public, anon;
grant execute on function public.restore_house_backup(uuid) to authenticated;
