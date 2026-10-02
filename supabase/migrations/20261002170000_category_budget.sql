-- Planned budget per expense category, compared with what was actually
-- spent on the Finances tab. Empty means "no plan set yet".
-- Safe to run again.

alter table public.finance_categories
  add column if not exists planned_amount numeric(12, 2)
  check (planned_amount is null or planned_amount >= 0);
