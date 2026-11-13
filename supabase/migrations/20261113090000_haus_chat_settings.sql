-- Haus chat set up in the app (Einstellungen → Haus-Chat) instead of as
-- Edge Function secrets, so each site (database) can have its own.
-- The trigger URL and token are kept in secret_settings, which nobody can
-- read through the API: only the Edge Function haus-chat reads it, with
-- the service role. Members can set or clear the values, never read them.
-- Secrets set in Supabase (HAUS_CHAT_FIRE_URL / _TOKEN) still win.
-- Safe to run again: it only creates what is missing.

create table if not exists public.secret_settings (
  key text primary key,
  value text not null
);

-- No policies: not readable or writable through the API.
alter table public.secret_settings enable row level security;
revoke all on public.secret_settings from anon, authenticated;

create or replace function public.set_haus_chat_trigger(fire_url text, fire_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  u text := nullif(trim(coalesce(fire_url, '')), '');
  t text := nullif(trim(coalesce(fire_token, '')), '');
begin
  if not public.is_member() then
    raise exception 'Nur Mitglieder können den Haus-Chat einrichten.';
  end if;
  if u is null and t is null then
    delete from public.secret_settings where key in ('haus_chat_fire_url', 'haus_chat_fire_token');
    return;
  end if;
  if u is null or t is null then
    raise exception 'Bitte URL und Token angeben.';
  end if;
  if u !~ '^https://api\.anthropic\.com/v1/claude_code/routines/[A-Za-z0-9_]+/fire$' then
    raise exception 'Die URL muss so aussehen: https://api.anthropic.com/v1/claude_code/routines/trig_…/fire';
  end if;
  insert into public.secret_settings (key, value)
  values ('haus_chat_fire_url', u), ('haus_chat_fire_token', t)
  on conflict (key) do update set value = excluded.value;
end;
$$;

revoke all on function public.set_haus_chat_trigger(text, text) from public, anon;
grant execute on function public.set_haus_chat_trigger(text, text) to authenticated;
