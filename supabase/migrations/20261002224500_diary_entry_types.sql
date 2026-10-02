-- Diary entries come in kinds: status reports (all existing entries),
-- defects, appointments, … The list of kinds and their extra fields
-- live in the app (src/diaryTypes.js), so a new kind needs no migration.
-- Fields only one kind uses (a defect's state, an appointment's time)
-- are kept in `details`.
-- Safe to run again: it only adds what is missing.

alter table public.diary_entries
  add column if not exists entry_type text not null default 'status',
  add column if not exists details jsonb not null default '{}'::jsonb;

create index if not exists diary_entries_entry_type_idx
  on public.diary_entries (entry_type);
