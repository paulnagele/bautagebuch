-- The Haus chat: the house login answers and moves requests along but
-- cannot change what a member wrote (code review S7).
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into members (email) values ('mitglied@example.com');
insert into house_editors (email) values ('hauslogin@example.com');

select tests_login('mitglied@example.com');
insert into house_chat (id, role, text, status)
  values ('55555555-5555-4555-8555-555555555555', 'user', 'Bitte Fenster größer', 'queued');
select is((select count(*)::int from house_chat), 1, 'member writes a request');

select tests_login('hauslogin@example.com', 'email');
select lives_ok(
  $$update house_chat set status = 'started', session_url = 'https://example.com/s'
    where id = '55555555-5555-4555-8555-555555555555'$$,
  'house login moves the request along'
);
select throws_ok(
  $$update house_chat set text = 'Etwas anderes' where id = '55555555-5555-4555-8555-555555555555'$$,
  '42501', null,
  'house login cannot change the request''s text'
);
select lives_ok(
  $$insert into house_chat (role, text, reply_to) values ('claude', 'Erledigt', '55555555-5555-4555-8555-555555555555')$$,
  'house login answers'
);
select throws_ok(
  $$insert into house_chat (role, text) values ('user', 'Eigene Anfrage')$$,
  '42501', null,
  'house login cannot write requests of its own'
);

select tests_admin();
select is(
  (select text from house_chat where id = '55555555-5555-4555-8555-555555555555'),
  'Bitte Fenster größer', 'the member''s text is unchanged'
);

select * from finish();
rollback;
