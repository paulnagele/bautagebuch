-- Document types for the Dokumente tab, e.g. "Rechnungen", "Pläne".
--
-- The documents themselves stay where they are: files of diary entries,
-- receipts of expenses and quote PDFs, all in Google Drive. Only which
-- type a document has is stored here, by its Drive file ID.
--
-- document_types: the list of types, kept by the members in the app. The
-- one marked `receipts` (seeded as "Rechnungen") is where receipts of
-- diary expenses (Ausgaben) land without being sorted. Every other
-- document without an assignment counts as unsorted (Unsortiert).
--
-- document_assignments: one row per document sorted by hand; type_id
-- null means it was put back to unsorted (also when its type is deleted).
-- Safe to run again: it only creates what is missing.

create table if not exists public.document_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0 and name = trim(name)),
  receipts boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create unique index if not exists document_types_one_receipts
  on public.document_types (receipts) where receipts;

create table if not exists public.document_assignments (
  file_id text primary key check (length(file_id) > 0),
  type_id uuid references public.document_types (id) on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Row level security: every member can read and change everything,
-- nobody else can see anything.
alter table public.document_types enable row level security;
alter table public.document_assignments enable row level security;

drop policy if exists "members have full access" on public.document_types;
create policy "members have full access"
  on public.document_types for all to authenticated
  using (public.is_member())
  with check (public.is_member());

drop policy if exists "members have full access" on public.document_assignments;
create policy "members have full access"
  on public.document_assignments for all to authenticated
  using (public.is_member())
  with check (public.is_member());

grant select, insert, update, delete on public.document_types to authenticated;
grant select, insert, update, delete on public.document_assignments to authenticated;

-- Live updates, like the other shared tables (see 20261002190000_realtime.sql).
do $$
declare
  t text;
begin
  foreach t in array array['document_types', 'document_assignments'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;

-- A first list of types, only while there are none yet, so types the
-- members deleted do not come back.
insert into public.document_types (name, receipts)
select name, name = 'Rechnungen'
  from unnest(array['Rechnungen', 'Angebote', 'Verträge', 'Pläne', 'Genehmigungen']) as name
  where not exists (select 1 from public.document_types);
