-- KI-Entwürfe in the Einrichtung tab: an image model on OpenRouter
-- furnishes a view of a room with the pictures picked from its board.
-- The OpenRouter key and the model are set in the app (Einstellungen →
-- KI-Entwürfe) and kept in secret_settings (see …_haus_chat_settings.sql):
-- nobody can read them through the API, only the Edge Function
-- einrichtung-ki with the service role. Each site (database) has its own.
-- Safe to run again.

create or replace function public.set_openrouter_settings(api_key text, model text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  k text := nullif(trim(coalesce(api_key, '')), '');
  m text := nullif(trim(coalesce(model, '')), '');
begin
  if not public.is_member() then
    raise exception 'Nur Mitglieder können die KI-Entwürfe einrichten.';
  end if;
  if k is null and m is null then
    delete from public.secret_settings where key in ('openrouter_key', 'openrouter_model');
    return;
  end if;
  if m is not null and m !~ '^[A-Za-z0-9._:/-]+$' then
    raise exception 'Das Modell sieht so aus: anbieter/modell, z. B. google/gemini-2.5-flash-image';
  end if;
  if k is not null then
    insert into public.secret_settings (key, value) values ('openrouter_key', k)
    on conflict (key) do update set value = excluded.value;
  end if;
  if m is not null then
    insert into public.secret_settings (key, value) values ('openrouter_model', m)
    on conflict (key) do update set value = excluded.value;
  end if;
end;
$$;

revoke all on function public.set_openrouter_settings(text, text) from public, anon;
grant execute on function public.set_openrouter_settings(text, text) to authenticated;
