-- Finance categories: expense categories and funding sources the family
-- can add, rename and delete in the app. Transactions store the category
-- name, so renaming goes through rename_finance_category() below.
-- Safe to run again: it only creates what is missing.

create table if not exists public.finance_categories (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('funding', 'expense')),
  name text not null check (length(trim(name)) > 0 and name = trim(name)),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists finance_categories_type_name_key
  on public.finance_categories (type, lower(name));

-- Starting lists, only added while a type has no categories at all.
insert into public.finance_categories (type, name, sort_order)
select 'expense', name, ord
from unnest(array[
  'Land & purchase costs', 'Planning & permits', 'Shell construction', 'Roof',
  'Windows & doors', 'Building services', 'Interior finishing',
  'Kitchen & furnishing', 'Outdoor & landscaping', 'Fees & insurance', 'Other'
]) with ordinality as t(name, ord)
where not exists (select 1 from public.finance_categories where type = 'expense');

insert into public.finance_categories (type, name, sort_order)
select 'funding', name, ord
from unnest(array[
  'Own funds', 'Bank loan', 'Housing subsidy', 'Family / private loan', 'Other funding'
]) with ordinality as t(name, ord)
where not exists (select 1 from public.finance_categories where type = 'funding');

-- Renames a category and every transaction that uses it, in one step.
-- Runs with the caller's rights, so row level security still applies.
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
end;
$$;

revoke all on function public.rename_finance_category(uuid, text) from public, anon;
grant execute on function public.rename_finance_category(uuid, text) to authenticated;

-- Row level security: every member can read and change everything,
-- nobody else can see anything.
alter table public.finance_categories enable row level security;

drop policy if exists "members have full access" on public.finance_categories;
create policy "members have full access"
  on public.finance_categories for all to authenticated
  using (public.is_member())
  with check (public.is_member());
