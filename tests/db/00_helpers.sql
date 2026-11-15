-- Helpers for the database tests (pgTAP). Loaded before every test file
-- by scripts/test-db.sh; the test database is thrown away afterwards.
-- All people and addresses are made up.

-- Acts as a signed-in user for the rest of the transaction, the way
-- PostgREST does it: role "authenticated" and the token's claims.
--   provider: 'google' for the members' Google sign-in, 'email' for a
--   password login (house logins)
create or replace function tests_login(email text, provider text default 'google')
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', md5(email)::uuid,
    'email', email,
    'role', 'authenticated',
    'app_metadata', json_build_object('provider', provider, 'providers', json_build_array(provider)),
    'user_metadata', json_build_object('full_name', 'Test ' || split_part(email, '@', 1))
  )::text, true);
  execute 'set local role authenticated';
end;
$$;

-- Visitor without a login.
create or replace function tests_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
end;
$$;

-- Back to the test's own rights (to set up data or look behind RLS).
create or replace function tests_admin()
returns void
language plpgsql
as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

grant execute on function tests_login(text, text), tests_anon(), tests_admin()
  to anon, authenticated;
