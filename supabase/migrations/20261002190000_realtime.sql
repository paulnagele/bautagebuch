-- Live updates: publish row changes of the shared tables through
-- Supabase Realtime, so an entry one member saves appears right away on
-- the other members' screens. Realtime applies the tables' row level
-- security, so only members receive the changes.
-- Safe to run again: it only adds tables that are not yet published.

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['diary_entries', 'transactions', 'finance_categories', 'contacts'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;
