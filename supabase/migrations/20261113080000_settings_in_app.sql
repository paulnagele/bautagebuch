-- Settings in the app (Einstellungen): every member can set the Drive
-- folder, the calendar and the site's location, and add or remove
-- members and house logins, without the SQL Editor. All members have the
-- same rights. Changes go through the functions below, which check the
-- values; the tables themselves stay read-only for the API.
-- Safe to run again: it only creates what is missing.

-- ---------------------------------------------------------------------------
-- app_settings: one function to set or clear a known key.
-- ---------------------------------------------------------------------------
create or replace function public.set_app_setting(setting_key text, setting_value text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v text := nullif(trim(coalesce(setting_value, '')), '');
begin
  if not public.is_member() then
    raise exception 'Nur Mitglieder können Einstellungen ändern.';
  end if;
  if setting_key not in ('drive_folder_id', 'calendar_id', 'site_location') then
    raise exception 'Unbekannte Einstellung: %', setting_key;
  end if;
  if v is null then
    delete from public.app_settings where key = setting_key;
  else
    insert into public.app_settings (key, value) values (setting_key, v)
    on conflict (key) do update set value = excluded.value;
  end if;
end;
$$;

revoke all on function public.set_app_setting(text, text) from public, anon;
grant execute on function public.set_app_setting(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- members: add any address; remove anyone but yourself, never the last.
-- ---------------------------------------------------------------------------
create or replace function public.add_member(member_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e text := lower(trim(coalesce(member_email, '')));
begin
  if not public.is_member() then
    raise exception 'Nur Mitglieder können Mitglieder hinzufügen.';
  end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Bitte eine gültige E-Mail-Adresse angeben.';
  end if;
  insert into public.members (email) values (e) on conflict do nothing;
end;
$$;

create or replace function public.remove_member(member_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e text := lower(trim(coalesce(member_email, '')));
begin
  if not public.is_member() then
    raise exception 'Nur Mitglieder können Mitglieder entfernen.';
  end if;
  if e = lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'Du kannst dich nicht selbst entfernen.';
  end if;
  if (select count(*) from public.members) <= 1 then
    raise exception 'Das letzte Mitglied kann nicht entfernt werden.';
  end if;
  delete from public.members where email = e;
end;
$$;

revoke all on function public.add_member(text) from public, anon;
revoke all on function public.remove_member(text) from public, anon;
grant execute on function public.add_member(text) to authenticated;
grant execute on function public.remove_member(text) to authenticated;

-- ---------------------------------------------------------------------------
-- house_editors (house-only logins, e.g. Claude's): members can list,
-- add and remove them. The login itself is still created in Supabase
-- (Authentication → Users).
-- ---------------------------------------------------------------------------
create or replace function public.list_house_editors()
returns table (email text, added_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_member() then
    raise exception 'Nur Mitglieder sehen die Haus-Logins.';
  end if;
  return query select h.email, h.added_at from public.house_editors h order by h.added_at;
end;
$$;

create or replace function public.add_house_editor(editor_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e text := lower(trim(coalesce(editor_email, '')));
begin
  if not public.is_member() then
    raise exception 'Nur Mitglieder können Haus-Logins hinzufügen.';
  end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Bitte eine gültige E-Mail-Adresse angeben.';
  end if;
  insert into public.house_editors (email) values (e) on conflict do nothing;
end;
$$;

create or replace function public.remove_house_editor(editor_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_member() then
    raise exception 'Nur Mitglieder können Haus-Logins entfernen.';
  end if;
  delete from public.house_editors where email = lower(trim(coalesce(editor_email, '')));
end;
$$;

revoke all on function public.list_house_editors() from public, anon;
revoke all on function public.add_house_editor(text) from public, anon;
revoke all on function public.remove_house_editor(text) from public, anon;
grant execute on function public.list_house_editors() to authenticated;
grant execute on function public.add_house_editor(text) to authenticated;
grant execute on function public.remove_house_editor(text) to authenticated;
