# Bautagebuch

A React app (Vite) for keeping a construction diary. After signing in
there are three tabs:

- **Diary** – write and edit daily site entries (date, weather, workers
  on site, work carried out, notes) with photos. Photos are stored in a
  shared Google Drive folder.
- **Finances** – record funding (own funds, bank loan, housing subsidy,
  …) and expenses by category; categories and funding sources can be
  added, renamed and deleted under "Manage categories". Shows funding secured, spent and
  remaining, and a money-flow diagram from funding sources to expense
  categories.
- **Timetable** – the project's Google Calendar, embedded
  (`src/tabs/Timetable.jsx`). The calendar must be public to be visible
  to everyone using the app.

## How it fits together

- **Sign-in**: "Sign in with Google". The Google ID token is exchanged for
  a [Supabase](https://supabase.com) session.
- **Data**: diary entries and finances are stored in Supabase (Postgres).
  Only email addresses in the `members` table can read or write anything;
  this is enforced by the database (row level security), see
  `supabase/migrations/`.
- **Photos**: uploaded to a shared Google Drive folder with the signed-in
  person's own Google account. The database only keeps the Drive file IDs.
  Viewing photos asks once per browser session for Google Drive access.
- **Timetable**: the project's Google Calendar, embedded
  (`src/tabs/Timetable.jsx`).

## Setup

All four settings below are public (they end up in the browser anyway),
so they are kept in `.env.production`, which is committed.

### 1. Google Cloud (sign-in and Drive access)

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and
   create a project, e.g. "Bautagebuch".
2. **APIs & Services → Library**: enable the **Google Drive API**.
3. **Google Auth Platform → Branding**: app name and support email.
4. **Audience**: *External*, publishing status *Testing*, and add every
   family member's Google account under **Test users**. (Full Drive access
   is a restricted scope, so the app stays in testing mode; Google shows
   an "unverified app" notice the first time, choose *Continue*.)
5. **Data Access → Add or remove scopes**: add
   `https://www.googleapis.com/auth/drive`.
6. **Clients → Create client**, type *Web application*. Under
   **Authorized JavaScript origins** add `https://paulnagele.github.io`
   (and `http://localhost:5173` for local development). No redirect URIs
   are needed. Note the **Client ID** and **Client secret**.

### 2. Google Drive (photo folder)

Create a folder, e.g. "Bautagebuch Fotos", and share it with every family
member as **Editor**. Its ID is the last part of the folder URL:
`https://drive.google.com/drive/folders/<folder ID>`.

### 3. Supabase (database)

1. Create a free project at [supabase.com](https://supabase.com); region
   *Central EU (Frankfurt)* keeps the data in the EU.
2. Add three **repository secrets** in GitHub (*Settings → Secrets and
   variables → Actions*):
   - `SUPABASE_PROJECT_REF`: the project ID, the part before
     `.supabase.co` in the Project URL.
   - `SUPABASE_DB_PASSWORD`: the database password chosen when creating
     the project.
   - `SUPABASE_ACCESS_TOKEN`: a personal access token from
     *Account → Access Tokens*.

   Then run **Actions → Apply Supabase migrations → Run workflow** once.
   It creates the tables (see [Changing the database](#changing-the-database)).
   Then, in the Supabase **SQL Editor**, add your family's Google accounts
   (lower case) and **Run**:
   ```sql
   insert into public.members (email) values
     ('you@gmail.com'),
     ('partner@gmail.com')
   on conflict do nothing;
   ```
3. **Authentication → Sign In / Providers → Google**: enable it, enter the
   **Client ID** (under *Client IDs*) and **Client secret** from step 1,
   and save.
4. **Project Settings → API Keys / Data API**: note the **Project URL**
   and the **anon / publishable** key. Never use the `service_role` /
   secret key in the app.

### 4. Fill in `.env.production`

```
VITE_GOOGLE_CLIENT_ID=<Client ID from step 1>
VITE_SUPABASE_URL=<Project URL from step 3>
VITE_SUPABASE_ANON_KEY=<anon / publishable key from step 3>
VITE_DRIVE_FOLDER_ID=<folder ID from step 2>
```

Commit to `main`; the GitHub Actions workflow deploys the site. (Repository
variables named `GOOGLE_CLIENT_ID`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`DRIVE_FOLDER_ID` override these values if set.) If anything is missing,
the deploy run shows a warning and the site shows "Setup not finished".

### Adding a family member later

1. Supabase SQL Editor:
   `insert into public.members (email) values ('name@gmail.com');`
2. Google Cloud → Audience → add them as a test user.
3. Share the Drive photo folder with them as Editor.

## Changing the database

Schema changes live in `supabase/migrations/` as SQL files that each run
exactly once, in file-name order. To change the schema, add a new file
instead of editing an old one, e.g.
`supabase/migrations/20261015120000_add_diary_location.sql`:

```sql
alter table public.diary_entries
  add column if not exists location text not null default '';
```

Pushing it to `main` runs the **Apply Supabase migrations** workflow, which
applies every migration the database has not seen yet (`supabase db push`).
Supabase records which ones ran in `supabase_migrations.schema_migrations`.

The existing migrations only create what is missing, so they are also safe
on a database that was set up by hand with the old `supabase/schema.sql`:
existing data, members and categories are kept.

## Local development

```bash
cp .env.example .env.local   # fill in the same values
npm install
npm run dev
```

Then open http://localhost:5173.

## Deployment

Pushes to `main` are built and deployed to GitHub Pages by
`.github/workflows/deploy-pages.yml`. The site is served at
https://paulnagele.github.io/bautagebuch/.

One-time setup: in the repository go to **Settings → Pages** and set
**Source** to **GitHub Actions**.

## Scripts

- `npm run dev` – start the dev server
- `npm run build` – production build into `dist/`
- `npm run preview` – preview the production build
- `npm run lint` – lint with oxlint
