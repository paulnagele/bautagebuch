-- Deleting an expense category also clears it from the diary entries that
-- name it as their row in the Bauablauf (Zeitplan), so they do not keep a
-- name that no longer exists. And the payment plan (Zahlungsplan), removed
-- from the app, goes from the database.
-- Safe to run again.

-- Deletes a category. Its Posten (with their quotes) and its time slots in
-- the Bauablauf go with it (on delete cascade). Diary entries that name an
-- expense category keep their text and just lose the category. A category
-- still used by bookings cannot be deleted; the app checks this first.
-- Runs with the caller's rights, so row level security still applies.
create or replace function public.delete_finance_category(category_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  old_name text;
  category_type text;
begin
  select name, type into old_name, category_type
    from public.finance_categories
    where id = category_id;
  if not found then
    raise exception 'Category not found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.transactions
    where type = category_type and category = old_name
  ) then
    raise exception 'Die Kategorie „%“ wird noch von Buchungen verwendet.', old_name;
  end if;
  if category_type = 'expense' then
    update public.diary_entries
      set details = jsonb_set(details, '{category}', to_jsonb(''::text))
      where details ->> 'category' = old_name and entry_type <> 'expense';
  end if;
  delete from public.finance_categories where id = category_id;
end;
$$;

grant execute on function public.delete_finance_category(uuid) to authenticated;

-- Renaming no longer needs to keep the payment plan in step.
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
      where details ->> 'category' = old_name;
  end if;
end;
$$;

-- The payment plan is no longer used by the app.
drop function if exists public.record_planned_payment(uuid, date);
drop table if exists public.payment_plan;
