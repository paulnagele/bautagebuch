-- Diary entries have one text field. Existing notes are appended to the
-- main text (after a blank line) so nothing is lost. The notes column
-- stays for now; the app no longer fills it.
-- Safe to run again: entries without notes are left alone.

update public.diary_entries
  set work = work || E'\n\n' || notes,
      notes = ''
  where notes <> '';
