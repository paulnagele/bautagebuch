-- Diary entries have one text field (see 20261003000000_diary_single_text).
-- Any notes still left (e.g. saved by an older app version since then) are
-- appended to the main text, then the unused column is dropped.

update public.diary_entries
  set work = work || E'\n\n' || notes
  where notes <> '';

alter table public.diary_entries drop column if exists notes;
