-- Expenses are entered in the diary (entry kind "expense"). Each such
-- entry keeps exactly one expense transaction in sync, so the Finances
-- tab (totals, budget plan, money flow) keeps working unchanged.
-- The diary entry is the source: its details hold the category and the
-- amount, its text is the transaction's description.
-- Safe to run again.

alter table public.transactions
  add column if not exists diary_entry_id uuid
  references public.diary_entries (id) on delete cascade;

create unique index if not exists transactions_diary_entry_id_key
  on public.transactions (diary_entry_id);

-- Runs with the caller's rights, so row level security still applies.
create or replace function public.sync_diary_expense()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.entry_type = 'expense' then
    insert into public.transactions (tx_date, type, category, description, amount, diary_entry_id)
    values (
      new.entry_date,
      'expense',
      new.details ->> 'category',
      new.work,
      (new.details ->> 'amount')::numeric(12, 2),
      new.id
    )
    on conflict (diary_entry_id) do update
      set tx_date = excluded.tx_date,
          category = excluded.category,
          description = excluded.description,
          amount = excluded.amount;
  else
    -- The entry was changed to another kind: its expense goes away.
    delete from public.transactions where diary_entry_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_diary_expense on public.diary_entries;
create trigger sync_diary_expense
  after insert or update on public.diary_entries
  for each row execute function public.sync_diary_expense();

-- Renaming a category now also renames it in diary expense entries, so a
-- later edit of the entry does not bring back the old name.
create or replace function public.rename_finance_category(category_id uuid, new_name text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  old_name text;
  category_type text;
begin
  new_name := trim(new_name);
  select name, type into old_name, category_type
    from public.finance_categories
    where id = category_id;
  if not found then
    raise exception 'Category not found' using errcode = 'P0002';
  end if;
  update public.finance_categories set name = new_name where id = category_id;
  update public.transactions
    set category = new_name
    where type = category_type and category = old_name;
  if category_type = 'expense' then
    update public.diary_entries
      set details = jsonb_set(details, '{category}', to_jsonb(new_name))
      where entry_type = 'expense' and details ->> 'category' = old_name;
  end if;
end;
$$;
