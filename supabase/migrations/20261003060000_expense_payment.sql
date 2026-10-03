-- Diary expenses can be still open (an invoice not yet paid) or paid,
-- in details.payment ('open' | 'paid'; missing means paid, as for every
-- expense entered before). The transaction keeps both that state and
-- whether the entry has a receipt (a photo or file), so the Finanzen tab
-- can show open amounts per category and item, and which bookings have
-- a receipt.
-- Safe to run again.

alter table public.transactions
  add column if not exists paid boolean not null default true;

alter table public.transactions
  add column if not exists has_receipt boolean not null default false;

-- Runs with the caller's rights, so row level security still applies.
create or replace function public.sync_diary_expense()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  item_id uuid;
begin
  if new.entry_type = 'expense' then
    select b.id into item_id
      from public.budget_items b
      join public.finance_categories c on c.id = b.category_id
      where b.id::text = new.details ->> 'budgetItem'
        and c.type = 'expense'
        and c.name = new.details ->> 'category';
    insert into public.transactions
      (tx_date, type, category, description, amount, diary_entry_id, budget_item_id, paid, has_receipt)
    values (
      new.entry_date,
      'expense',
      new.details ->> 'category',
      new.work,
      (new.details ->> 'amount')::numeric(12, 2),
      new.id,
      item_id,
      coalesce(new.details ->> 'payment', 'paid') <> 'open',
      cardinality(new.photo_ids) > 0 or jsonb_array_length(new.files) > 0
    )
    on conflict (diary_entry_id) do update
      set tx_date = excluded.tx_date,
          category = excluded.category,
          description = excluded.description,
          amount = excluded.amount,
          budget_item_id = excluded.budget_item_id,
          paid = excluded.paid,
          has_receipt = excluded.has_receipt;
  else
    -- The entry was changed to another kind: its expense goes away.
    delete from public.transactions where diary_entry_id = new.id;
  end if;
  return new;
end;
$$;

-- Receipts of expenses entered so far.
update public.transactions t
  set has_receipt = true
  from public.diary_entries d
  where t.diary_entry_id = d.id
    and (cardinality(d.photo_ids) > 0 or jsonb_array_length(d.files) > 0)
    and not t.has_receipt;
