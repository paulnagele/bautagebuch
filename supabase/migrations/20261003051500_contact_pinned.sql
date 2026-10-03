-- Pinned contacts (e.g. the owners themselves) come first in the diary's
-- people suggestions. Set with "Immer zuerst vorschlagen" in Kontakte.
-- Safe to run again: it only adds what is missing.

alter table public.contacts
  add column if not exists pinned boolean not null default false;
