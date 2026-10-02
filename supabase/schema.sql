-- Bautagebuch database schema.
-- Run once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to run again: it only creates what is missing.

-- ---------------------------------------------------------------------------
-- Members: only these Google accounts can read or write any data.
-- ---------------------------------------------------------------------------
create table if not exists public.members (
  email text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);

-- True when the signed-in user's email is in public.members.
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;

-- ---------------------------------------------------------------------------
-- Diary entries. Photos live in a shared Google Drive folder; only the
-- Drive file IDs are stored here.
-- ---------------------------------------------------------------------------
create table if not exists public.diary_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null,
  weather text not null default '',
  workers integer check (workers is null or workers >= 0),
  work text not null check (length(trim(work)) > 0),
  notes text not null default '',
  photo_ids text[] not null default '{}',
  created_by uuid default auth.uid(),
  author_name text default (auth.jwt() -> 'user_metadata' ->> 'full_name'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists diary_entries_entry_date_idx
  on public.diary_entries (entry_date desc);

-- ---------------------------------------------------------------------------
-- Finances: funding (where the money comes from) and expenses.
-- ---------------------------------------------------------------------------
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  tx_date date not null,
  type text not null check (type in ('funding', 'expense')),
  category text not null,
  description text not null check (length(trim(description)) > 0),
  amount numeric(12, 2) not null check (amount > 0),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists transactions_tx_date_idx
  on public.transactions (tx_date desc);

-- ---------------------------------------------------------------------------
-- Row level security: every member can read and change everything,
-- nobody else can see anything.
-- ---------------------------------------------------------------------------
alter table public.members enable row level security;
alter table public.diary_entries enable row level security;
alter table public.transactions enable row level security;

drop policy if exists "members can read the member list" on public.members;
create policy "members can read the member list"
  on public.members for select to authenticated
  using (public.is_member());

drop policy if exists "members have full access" on public.diary_entries;
create policy "members have full access"
  on public.diary_entries for all to authenticated
  using (public.is_member())
  with check (public.is_member());

drop policy if exists "members have full access" on public.transactions;
create policy "members have full access"
  on public.transactions for all to authenticated
  using (public.is_member())
  with check (public.is_member());

-- ---------------------------------------------------------------------------
-- Add your family's Google accounts here (lower case), then run.
-- To add someone later, run just this statement with their address.
-- ---------------------------------------------------------------------------
-- insert into public.members (email) values
--   ('you@gmail.com'),
--   ('partner@gmail.com')
-- on conflict do nothing;
