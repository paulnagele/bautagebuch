-- When a diary expense that came from the payment schedule (Zahlungsplan,
-- "Rechnung erhalten") is changed to another kind of entry, its booking
-- goes away (sync_diary_expense) and now its payment is unlinked too. It
-- then counts as planned or due again everywhere, and "Rechnung erhalten"
-- records it anew. Before, the payment stayed linked to an entry that was
-- no longer an expense: Finanzen showed it as due, Home left it out, and
-- recording it again did nothing.
-- Safe to run again.

-- Same as in 20261003060000_expense_payment.sql, plus the unlinking.
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
    -- The entry was changed to another kind: its expense goes away, and a
    -- planned payment it was recorded for is no longer recorded.
    delete from public.transactions where diary_entry_id = new.id;
    update public.payment_plan set diary_entry_id = null where diary_entry_id = new.id;
  end if;
  return new;
end;
$$;

-- Payments linked to entries changed before this migration.
update public.payment_plan p
  set diary_entry_id = null
  from public.diary_entries d
  where p.diary_entry_id = d.id
    and d.entry_type <> 'expense';
