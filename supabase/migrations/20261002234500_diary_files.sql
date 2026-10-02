-- Files attached to diary entries (PDFs, plans, offers, …). Like photos
-- they live in Google Drive, in their own folder; only the Drive file ID
-- and the original file name are stored here: [{ "id": …, "name": … }].
-- Safe to run again.

alter table public.diary_entries
  add column if not exists files jsonb not null default '[]'::jsonb;
