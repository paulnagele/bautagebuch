-- Quotes (Angebote) per budget item, and the payment schedule (Zahlungsplan).
--
-- quotes: offers from several companies for one budget item, e.g. three
-- roofers for "Dachdecker", each with an amount and optionally its PDF in
-- Google Drive ([{ "id": …, "name": … }], like diary files). One quote per
-- item can be chosen; choosing it makes its amount the item's plan.
--
-- payment_plan: payments agreed with a company, e.g. "2. Rate nach Rohbau",
-- with amount and due date, under an expense category and optionally a
-- budget item. When the invoice comes, the payment is recorded as an open
-- diary expense (record_planned_payment), which it then links to.
-- Safe to run again: it only creates what is missing.

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  budget_item_id uuid not null references public.budget_items (id) on delete cascade,
  company text not null check (length(trim(company)) > 0 and company = trim(company)),
  amount numeric(12, 2) not null check (amount >= 0),
  note text not null default '',
  files jsonb not null default '[]'::jsonb,
  chosen boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists quotes_budget_item_id_idx on public.quotes (budget_item_id);
create unique index if not exists quotes_one_chosen_per_item
  on public.quotes (budget_item_id) where chosen;

create table if not exists public.payment_plan (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0 and name = trim(name)),
  category text not null check (length(trim(category)) > 0),
  budget_item_id uuid references public.budget_items (id) on delete set null,
  amount numeric(12, 2) not null check (amount > 0),
  due_date date,
  diary_entry_id uuid references public.diary_entries (id) on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists payment_plan_due_date_idx on public.payment_plan (due_date);

-- Row level security: every member can read and change everything,
-- nobody else can see anything.
alter table public.quotes enable row level security;
alter table public.payment_plan enable row level security;

drop policy if exists "members have full access" on public.quotes;
create policy "members have full access"
  on public.quotes for all to authenticated
  using (public.is_member())
  with check (public.is_member());

drop policy if exists "members have full access" on public.payment_plan;
create policy "members have full access"
  on public.payment_plan for all to authenticated
  using (public.is_member())
  with check (public.is_member());

grant select, insert, update, delete on public.quotes to authenticated;
grant select, insert, update, delete on public.payment_plan to authenticated;

-- Live updates, like the other shared tables (see 20261002190000_realtime.sql).
do $$
declare
  t text;
begin
  foreach t in array array['quotes', 'payment_plan'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;

-- Chooses a quote (or, with pick = false, takes the choice back). A
-- chosen quote's amount becomes its budget item's planned amount.
-- Runs with the caller's rights, so row level security still applies.
create or replace function public.choose_quote(quote_id uuid, pick boolean default true)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  item_id uuid;
  quote_amount numeric(12, 2);
begin
  select budget_item_id, amount into item_id, quote_amount
    from public.quotes where id = quote_id;
  if not found then
    raise exception 'Quote not found' using errcode = 'P0002';
  end if;
  update public.quotes q set chosen = false where q.budget_item_id = item_id and q.chosen;
  if pick then
    update public.quotes set chosen = true where id = quote_id;
    update public.budget_items set planned_amount = quote_amount where id = item_id;
  end if;
end;
$$;

grant execute on function public.choose_quote(uuid, boolean) to authenticated;

-- Records a planned payment as an open diary expense (the invoice has
-- come), dated entry_date (the app's today) and payable by the payment's
-- due date, and links it.
-- Returns the new diary entry's id. The diary entry keeps the expense in
-- the finances in sync as usual (sync_diary_expense).
create or replace function public.record_planned_payment(payment_id uuid, entry_date date default current_date)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  payment public.payment_plan;
  entry_id uuid;
begin
  select * into payment from public.payment_plan where id = payment_id;
  if not found then
    raise exception 'Payment not found' using errcode = 'P0002';
  end if;
  if payment.diary_entry_id is not null then
    return payment.diary_entry_id;
  end if;
  insert into public.diary_entries (entry_type, entry_date, work, details)
  values (
    'expense',
    record_planned_payment.entry_date,
    payment.name,
    jsonb_strip_nulls(jsonb_build_object(
      'category', payment.category,
      'budgetItem', coalesce(payment.budget_item_id::text, ''),
      'amount', payment.amount,
      'payment', 'open',
      'payBy', coalesce(payment.due_date::text, '')
    ))
  )
  returning id into entry_id;
  update public.payment_plan set diary_entry_id = entry_id where id = payment_id;
  return entry_id;
end;
$$;

grant execute on function public.record_planned_payment(uuid, date) to authenticated;
