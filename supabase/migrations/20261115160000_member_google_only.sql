-- Code review 2026-11-15, S4 and S7.
--
-- S4: Members sign in with Google only. Since Claude's house login, the
-- e-mail/password sign-in is switched on in Supabase, and is_member() only
-- looked at the e-mail address in the token. Someone who registered with
-- a password under the address of a member who has not signed in yet
-- would have counted as that member. Now only a login with a Google
-- identity counts (Google has checked that the address is theirs). House
-- logins (is_house_editor) keep using a password.
--
-- S7: House logins change requests in the Haus chat only to move them
-- along. The table now lets signed-in users change just status,
-- session_url and error of a row, never the text a member wrote (the app
-- and the Edge Function haus-chat change nothing else either).
-- Safe to run again.

create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
      coalesce(auth.jwt() -> 'app_metadata' -> 'providers', '[]'::jsonb) ? 'google'
      or auth.jwt() -> 'app_metadata' ->> 'provider' = 'google'
    )
    and exists (
      select 1 from public.members
      where email = lower(coalesce(auth.jwt() ->> 'email', ''))
    );
$$;

revoke all on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;

revoke update on public.house_chat from authenticated;
grant update (status, session_url, error) on public.house_chat to authenticated;
