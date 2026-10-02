-- App settings that only members may read, e.g. the Google Drive photo
-- folder ID, which is kept out of the repository and the public site.
-- Values are added by hand in the SQL editor; see README.
-- Safe to run again: it only creates what is missing.

create table if not exists public.app_settings (
  key text primary key,
  value text not null
);

alter table public.app_settings enable row level security;

drop policy if exists "members can read" on public.app_settings;
create policy "members can read"
  on public.app_settings for select to authenticated
  using (public.is_member());

grant select on public.app_settings to authenticated;
