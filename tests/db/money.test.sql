-- Money in the database: diary expenses become bookings (transactions),
-- renaming and deleting categories, choosing a quote.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into members (email) values ('mitglied@example.com');
select tests_login('mitglied@example.com');

insert into finance_categories (type, name, sort_order) values
  ('expense', 'Testgewerk', 90),
  ('expense', 'Leer', 91);

-- An Ausgabe in the diary books an expense.
insert into diary_entries (id, entry_type, entry_date, work, details) values (
  '11111111-1111-4111-8111-111111111111', 'expense', '2026-11-01', 'Rechnung Test',
  '{"category": "Testgewerk", "amount": 1234.5, "payment": "open"}'
);
select results_eq(
  $$select category, amount, paid from transactions
    where diary_entry_id = '11111111-1111-4111-8111-111111111111'$$,
  $$values ('Testgewerk'::text, 1234.50::numeric(12, 2), false)$$,
  'diary expense is booked, still unpaid'
);

update diary_entries set details = details || '{"amount": 99, "payment": "paid"}'
  where id = '11111111-1111-4111-8111-111111111111';
select results_eq(
  $$select amount, paid from transactions
    where diary_entry_id = '11111111-1111-4111-8111-111111111111'$$,
  $$values (99.00::numeric(12, 2), true)$$,
  'changing the entry changes the booking'
);

-- Renaming a category follows into bookings and diary entries.
select lives_ok(
  $$select rename_finance_category((select id from finance_categories where name = 'Testgewerk'), ' Neuer Name ')$$,
  'rename a category'
);
select is(
  (select category from transactions where diary_entry_id = '11111111-1111-4111-8111-111111111111'),
  'Neuer Name', 'booking has the new name'
);
select is(
  (select details ->> 'category' from diary_entries where id = '11111111-1111-4111-8111-111111111111'),
  'Neuer Name', 'diary entry has the new name'
);

-- A category still used by bookings cannot be deleted.
select throws_like(
  $$select delete_finance_category((select id from finance_categories where name = 'Neuer Name'))$$,
  '%wird noch von Buchungen verwendet%',
  'used category cannot be deleted'
);

-- Deleting an unused category clears it from status entries.
insert into diary_entries (entry_date, work, details) values ('2026-11-02', 'Status mit Kategorie', '{"category": "Leer"}');
select lives_ok(
  $$select delete_finance_category((select id from finance_categories where name = 'Leer'))$$,
  'unused category is deleted'
);
select is(
  (select details ->> 'category' from diary_entries where work = 'Status mit Kategorie'),
  '', 'its name is cleared from diary entries'
);

-- Turning the expense into another kind removes its booking; deleting
-- the entry does too.
update diary_entries set entry_type = 'status' where id = '11111111-1111-4111-8111-111111111111';
select is(
  (select count(*)::int from transactions where diary_entry_id = '11111111-1111-4111-8111-111111111111'),
  0, 'no booking once the entry is no longer an expense'
);

-- Choosing a quote sets the budget item's plan.
insert into budget_items (id, category_id, name, planned_amount)
  values ('22222222-2222-4222-8222-222222222222', (select id from finance_categories where name = 'Neuer Name'), 'Posten', 1000);
insert into quotes (id, budget_item_id, company, amount) values
  ('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', 'Firma A', 1500),
  ('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', 'Firma B', 1200);
select lives_ok($$select choose_quote('44444444-4444-4444-8444-444444444444')$$, 'choose a quote');
select is(
  (select planned_amount from budget_items where id = '22222222-2222-4222-8222-222222222222'),
  1200.00::numeric(12, 2), 'the item''s plan is the chosen quote'
);
select is(
  (select count(*)::int from quotes where chosen),
  1, 'only one quote is chosen'
);

select * from finish();
rollback;
