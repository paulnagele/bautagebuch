-- Renaming an expense category now also renames it in the payment
-- schedule (payment_plan), which stores the category by name. Before,
-- planned payments kept the old name, and recording one ("Rechnung
-- erhalten") booked the expense in a category that no longer existed.
-- Safe to run again.

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
    update public.payment_plan
      set category = new_name
      where category = old_name;
  end if;
end;
$$;
