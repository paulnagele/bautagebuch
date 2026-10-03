-- Budget items: planned line items under an expense category (e.g. under
-- "Dach": Dachdecker, Spengler, Material), each with a planned amount.
-- When a category has items, its planned amount is their sum (worked out
-- in the app; finance_categories.planned_amount is then not used).
-- Diary expenses can be assigned to an item; the transaction keeps it in
-- budget_item_id so spent vs. planned can be shown per item.
-- Safe to run again: it only creates what is missing.

create table if not exists public.budget_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.finance_categories (id) on delete cascade,
  name text not null check (length(trim(name)) > 0 and name = trim(name)),
  planned_amount numeric(12, 2) not null default 0 check (planned_amount >= 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists budget_items_category_id_idx
  on public.budget_items (category_id);

alter table public.transactions
  add column if not exists budget_item_id uuid
  references public.budget_items (id) on delete set null;

-- Row level security: every member can read and change everything,
-- nobody else can see anything.
alter table public.budget_items enable row level security;

drop policy if exists "members have full access" on public.budget_items;
create policy "members have full access"
  on public.budget_items for all to authenticated
  using (public.is_member())
  with check (public.is_member());

grant select, insert, update, delete on public.budget_items to authenticated;

-- Live updates, like the other shared tables (see 20261002190000_realtime.sql).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'budget_items'
  ) then
    alter publication supabase_realtime add table public.budget_items;
  end if;
end
$$;

-- Diary expenses now also carry their item (details.budgetItem). Only an
-- item that still exists and belongs to the entry's category is kept, so
-- a deleted item or a changed category never blocks saving the entry.
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
      (tx_date, type, category, description, amount, diary_entry_id, budget_item_id)
    values (
      new.entry_date,
      'expense',
      new.details ->> 'category',
      new.work,
      (new.details ->> 'amount')::numeric(12, 2),
      new.id,
      item_id
    )
    on conflict (diary_entry_id) do update
      set tx_date = excluded.tx_date,
          category = excluded.category,
          description = excluded.description,
          amount = excluded.amount,
          budget_item_id = excluded.budget_item_id;
  else
    -- The entry was changed to another kind: its expense goes away.
    delete from public.transactions where diary_entry_id = new.id;
  end if;
  return new;
end;
$$;
