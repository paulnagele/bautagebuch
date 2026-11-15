-- Who can see and change what (row level security).
-- Members sign in with Google and are listed in members; house logins
-- (house_editors) may only work on the house model; nobody else sees
-- anything.
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

-- Set up as admin: one member, one house login, some data.
insert into members (email) values ('mitglied@example.com');
insert into house_editors (email) values ('hauslogin@example.com');
insert into finance_categories (type, name, sort_order) values ('expense', 'Testkategorie', 99);
insert into diary_entries (entry_date, work) values ('2026-11-01', 'Testeintrag');
insert into contacts (name) values ('Erika Beispiel');
insert into house_versions (id, name, model, is_current) values ('v1', 'Bestand', '{}', true);
insert into house_versions (id, name, model) values ('v2', 'Variante', '{}');
insert into house_context (id, data) values ('site', '{"terrain":1}');
insert into secret_settings (key, value) values ('openrouter_key', 'geheim');
with share as (
  insert into house_shares (label, token_hash)
  values ('Test', encode(sha256(convert_to('richtiger-link-' || repeat('a', 20), 'UTF8')), 'hex'))
  returning id
)
insert into house_share_versions (share_id, version_id) select id, 'v2' from share;

-- Every table in public has row level security switched on.
select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0,
  'every public table has row level security'
);

-- ---------------------------------------------------------------------------
-- A member (Google sign-in)
select tests_login('mitglied@example.com');
select ok(is_member(), 'member with Google sign-in counts as member');
select is((select count(*)::int from diary_entries), 1, 'member reads the diary');
select is((select count(*)::int from contacts), 1, 'member reads contacts');
select is((select count(*)::int from house_versions), 2, 'member reads house versions');
select lives_ok(
  $$insert into diary_entries (entry_date, work) values ('2026-11-02', 'Vom Mitglied')$$,
  'member writes diary entries'
);
select is(
  (select author_name from diary_entries where work = 'Vom Mitglied'),
  'Test mitglied',
  'author name comes from the sign-in'
);
select throws_ok(
  $$select * from secret_settings$$,
  '42501', null,
  'member cannot read secret settings'
);
select is((select count(*)::int from members), 1, 'member sees the member list');
select throws_ok(
  $$insert into members (email) values ('neu@example.com')$$,
  '42501', null,
  'members table cannot be written directly'
);
select lives_ok($$select add_member('Neu@Example.com ')$$, 'member adds a member through add_member');
select throws_ok(
  $$select remove_member('mitglied@example.com')$$,
  'P0001', 'Du kannst dich nicht selbst entfernen.',
  'member cannot remove themselves'
);
select throws_like(
  $$select set_app_setting('unbekannt', 'x')$$,
  'Unbekannte Einstellung%',
  'unknown settings are refused'
);
select is(
  (select count(*)::int from house_versions where id = 'v1'),
  1, 'current version is visible'
);
delete from house_versions where id = 'v1';
select is(
  (select count(*)::int from house_versions where id = 'v1'),
  1, 'current version cannot be deleted'
);

-- ---------------------------------------------------------------------------
-- Same address, but signed up with a password (code review S4)
select tests_login('mitglied@example.com', 'email');
select ok(not is_member(), 'password login with a member''s address is not a member');
select is((select count(*)::int from diary_entries), 0, '… and sees no diary entries');
select throws_ok(
  $$insert into diary_entries (entry_date, work) values ('2026-11-03', 'Eindringling')$$,
  '42501', null,
  '… and cannot write any'
);
select throws_like($$select add_member('x@example.com')$$, 'Nur Mitglieder%', '… nor add members');

-- ---------------------------------------------------------------------------
-- Someone signed in with Google who is not a member
select tests_login('fremd@example.com');
select is((select count(*)::int from diary_entries), 0, 'non-member sees no diary entries');
select is((select count(*)::int from transactions), 0, 'non-member sees no money');
select is((select count(*)::int from house_versions), 0, 'non-member sees no house');
select is((select count(*)::int from members), 0, 'non-member sees no member list');

-- ---------------------------------------------------------------------------
-- The house login (password, only the house model)
select tests_login('hauslogin@example.com', 'email');
select ok(is_house_editor(), 'house login is a house editor');
select is((select count(*)::int from house_versions), 2, 'house login reads house versions');
select is((select count(*)::int from house_context), 1, 'house login reads the site');
select is((select count(*)::int from diary_entries), 0, 'house login sees no diary');
select is((select count(*)::int from contacts), 0, 'house login sees no contacts');
select lives_ok(
  $$insert into house_versions (name, model) values ('Claude: Test', '{}')$$,
  'house login adds a version'
);
select throws_ok(
  $$insert into house_versions (name, model, is_current) values ('Claude: aktuell', '{}', true)$$,
  '42501', null,
  'house login cannot add a current version'
);

-- ---------------------------------------------------------------------------
-- Visitor without a login
select tests_anon();
select is((select count(*)::int from diary_entries), 0, 'visitor sees no diary entries');
select is((select count(*)::int from transactions), 0, 'visitor sees no money');
select is((select count(*)::int from house_versions), 0, 'visitor sees no house');
select is((select count(*)::int from members), 0, 'visitor sees no member list');
select ok(get_shared_house('falsch-' || repeat('0', 30)) is null, 'a wrong share link shows nothing');
select is(
  get_shared_house('richtiger-link-' || repeat('a', 20)) -> 'versions' -> 0 ->> 'name',
  'Variante',
  'a share link shows its version'
);
select is(
  json_array_length(get_shared_house('richtiger-link-' || repeat('a', 20)) -> 'versions'),
  1,
  '… and only that one'
);

select * from finish();
rollback;
