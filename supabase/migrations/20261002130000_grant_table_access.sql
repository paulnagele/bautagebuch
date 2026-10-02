-- Table access for signed-in users. Newer Supabase projects no longer grant
-- this automatically, so every query failed with "permission denied for
-- table" even for members. Which rows a user may see or change is still
-- decided by the row level security policies (members only).
-- Safe to run again.

grant usage on schema public to authenticated;
grant select on public.members to authenticated;
grant select, insert, update, delete
  on public.diary_entries, public.transactions, public.finance_categories
  to authenticated;
