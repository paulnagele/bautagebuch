# Bautagebuch

A React app (Vite) for keeping a construction diary. After signing in
there are four tabs:

- **Diary** – write and edit daily site entries (date, weather, workers
  on site, work carried out, notes) with photos. Photos are stored in a
  shared Google Drive folder.
- **Finances** – record funding (own funds, bank loan, housing subsidy,
  …) and expenses by category; categories and funding sources can be
  added, renamed and deleted under "Manage categories". Shows funding secured, spent annd
  remaining, a money-flow diagram from funding sources to expense
  categories, and a planned budget per expense category next to what has
  been spent. A category can be split into budget items (e.g. under "Dach":
  Zimmerei, Spengler) with their own planned amounts; diary expenses can
  be assigned to an item. The money-flow diagram also shows the planned
  but not yet spent part of each category, hatched.
- **Timetable** – the project's Google Calendar, embedded
  (`src/tabs/Timetable.jsx`). Diary entries of kind "Termin", and
  "Aufgabe" and "Mangel" entries with a due date, are added to it
  automatically. Above it, the build's milestones (name, date, reached)
  can be kept; each is also an all-day event "Meilenstein: …" in the
  calendar, with "✓" once reached. The calendar must be public to be visible to
  everyone using the app.
- **Haus** – the 3D model of the house (three.js, `src/haus/viewer.js`):
  floors, section cuts, the site around it, walking through at eye
  height, and versions of the model (Bestand, variants). The model and
  the site data are stored in Supabase (`house_versions`,
  `house_context`), not in this repository, since they contain the
  address and the floor plans. When the tables are empty, the tab offers
  a one-time import of the Haus3D export file.
- **Einrichtung** – a mood board per room (`src/tabs/Interior.jsx`):
  pictures of things wanted in a room, each with a title, a note and a
  favourite star. The rooms are copied once from the house model's room
  names and then kept by hand (`interior_rooms`); nothing links back to
  the model. Pictures come from the gallery or camera, from "Teilen →
  Bautagebuch" (shared pictures ask: Tagebuch or Einrichtung?) or from
  the model: "Ansicht aus Modell" opens the Haus tab walking in that room
  (found by its name), and "Aufnehmen" saves the view as a picture. A
  render keeps where the camera stood as plain numbers, so "Neu rendern"
  shows the same view from the current version. Pictures go to
  `Haus/Einrichtung/<room>/` in Drive (`interior_items`).
- **Heizwärme** – an estimate of the heating demand (HWB, kWh/m²a) and
  heating load (`src/tabs/Energy.jsx`, `src/energy/`): a simplified
  monthly balance in the style of ÖNORM B 8110-6 / OIB-RL 6 from the
  building parts (area, U-value, correction factor), ventilation,
  internal and solar gains. The areas can be taken from a version of the
  house model; U-values can be entered or worked out from layers. Saved
  in Supabase (`heat_demand`, one JSON document).
- **Contacts** – the people involved in the build (contractors, trades,
  architect, authorities) with role, company, phone, email and notes.
  Phone numbers and emails open the phone or mail app; the list can be
  searched.

## How it fits together

- **Sign-in**: "Sign in with Google". The Google ID token is exchanged for
  a [Supabase](https://supabase.com) session.
- **Data**: diary entries, finances and contacts are stored in Supabase (Postgres).
  Only email addresses in the `members` table can read or write anything;
  this is enforced by the database (row level security), see
  `supabase/migrations/`.
- **Photos and files**: uploaded to a shared Google Drive folder (e.g.
  "Haus") with the signed-in person's own Google account, into a folder
  per entry kind and creation date, e.g. `Haus/Mangel/2026_10_02`.
  The database only keeps the Drive file IDs. Nothing is shared by link:
  members load photos with their own Drive access (one tap to connect
  Google Drive when it has run out) and each device keeps the photos it
  has shown, so they then load instantly and offline.
- **Timetable**: the project's Google Calendar, embedded
  (`src/tabs/Timetable.jsx`). Saving a diary "Termin" adds or updates
  its event in the calendar; an "Aufgabe" or "Mangel" with a due date
  becomes an all-day event on that date ("Mangel: …", with "✓" once
  fixed or done). Deleting the entry deletes the event,
  with the signed-in person's own Google account (Calendar API,
  `src/calendar.js`); the app asks for calendar access the first time.
  Changes made directly in Google Calendar are not copied back to the
  diary.
  The calendar ID is stored in the database like the folder ID.

## Setup

The three settings below are public (they end up in the browser anyway),
so they are kept in `.env.production`, which is committed. The photo
folder ID and the calendar ID are not among them; they are stored in the
database (see step 4).

### 1. Google Cloud (sign-in, Drive and Calendar access)

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and
   create a project, e.g. "Bautagebuch".
2. **APIs & Services → Library**: enable the **Google Drive API** and the
   **Google Calendar API**.
3. **Google Auth Platform → Branding**: app name and support email.
4. **Audience**: *External*, publishing status *Testing*, and add every
   family member's Google account under **Test users**. (Full Drive access
   is a restricted scope, so the app stays in testing mode; Google shows
   an "unverified app" notice the first time, choose *Continue*.)
5. **Data Access → Add or remove scopes**: add
   `https://www.googleapis.com/auth/drive` and
   `https://www.googleapis.com/auth/calendar.events`.
6. **Clients → Create client**, type *Web application*. Under
   **Authorized JavaScript origins** add the address of every site
   (`https://paulnagele.github.io` and the second site's
   `https://….pages.dev`, see [Deployment](#deployment)) and
   `http://localhost:5173` for local development. No redirect URIs
   are needed. Note the **Client ID** and **Client secret**.

### 2. Google Drive (folder)

Create a folder, e.g. "Haus", and share it with every family member as
**Editor**. Its ID is the last part of the folder URL:
`https://drive.google.com/drive/folders/<folder ID>`. The app puts each
diary entry's photos and files into `<entry kind>/<creation date>` inside
it (e.g. `Status/2026_10_02`, `Mangel/2026_10_02`) and creates these
folders on upload.

Keep the folder and its files restricted (not "Anyone with the link").
Older versions of the app shared each photo by link; the app takes that
back once per device as soon as a member connects Google Drive.

### 2b. Google Calendar

Create a calendar for the build (e.g. "Bauzeitplan"). In its settings:
- **Access permissions for events**: *Make available to public*, so the
  embedded calendar shows for everyone.
- **Share with specific people**: add every family member with
  *Make changes to events*, so their diary entries can be added.
- **Integrate calendar → Calendar ID** (e.g. `…@group.calendar.google.com`)
  is needed in step 4.

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
```

The folder, the calendar and the building site's location (for the
weather in Status entries) are kept out of the repository and the public
site: they are stored in the database (`app_settings`), where only
signed-in members can read them. Once you are a member, set them in the
app under **Einstellungen** (tap your name at the top) → **Projekt**. The
app checks with your Google access that the folder and calendar work.

Commit to `main`; the GitHub Actions workflow deploys the site (see
[Deployment](#deployment)). (Repository variables named `GOOGLE_CLIENT_ID`, `SUPABASE_URL` and `SUPABASE_ANON_KEY`
override these values if set.) If anything is missing,
the deploy run shows a warning and the site shows "Setup not finished".

### Adding a family member later

1. In the app: **Einstellungen → Mitglieder → Hinzufügen**. Every member
   can add and remove members (not themselves, never the last one).
2. Google Cloud → Audience → add them as a test user.
3. Share the Drive folder with them as Editor, and the calendar with
   *Make changes to events*.

### A login for the house model only (e.g. for Claude)

A house editor can read the house model and add new versions, but sees
nothing else and can't change, delete or pick the current version.

1. Supabase → **Authentication → Users → Add user → Create new user**,
   with **Auto Confirm User** ticked (the email needn't be a real
   mailbox). The **Email** provider must be on. Don't add it to `members`.
2. In the app: **Einstellungen → Mitglieder → Haus-Logins**, add its
   email address.
3. `scripts/haus/house.mjs` signs in with `HAUS_BOT_EMAIL` and
   `HAUS_BOT_PASSWORD`: `pull` copies the versions and site data into
   `.haus/` (ignored by git), `render` takes pictures of a model with the
   app's viewer in headless Chromium, `save` adds a version named
   "Claude: …". See the comment at the top of the script.

### Claude chat in the Haus tab

The **Claude** button in the Haus tab sends requests to a Claude Code
scheduled task on the owner's Claude account, which changes the model with
the login above and answers in the chat. Setup (scheduled task with an API
trigger, two Supabase secrets) and the task's prompt: `docs/haus-chat.md`.

## Changing the database

Schema changes live in `supabase/migrations/` as SQL files that each run
exactly once, in file-name order. To change the schema, add a new file
instead of editing an old one, e.g.
`supabase/migrations/20261015120000_add_diary_location.sql`:

```sql
alter table public.diary_entries
  add column if not exists location text not null default '';
```

Every push to `main` first runs the **Apply Supabase migrations** workflow
for each site's database, which applies every migration that database has
not seen yet (`supabase db push`), and only then publishes the new version
of that site; if a migration fails, that site is not updated.
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

Every push to `main` deploys every site (`.github/workflows/deploy.yml`).
Each site has its own Supabase database and its own settings in a GitHub
**environment**:

| Site | Environment | Cloudflare Pages project | Address |
| --- | --- | --- | --- |
| Main | `production` | `bautagebuch` | own domain, set in Cloudflare |
| Second | `second` | `bautagebuch-second` | own domain, set in Cloudflare |

Each site is deployed on its own (`deploy-target.yml`): first its database
migrations and Edge Functions, then the app. If one site fails, the other
is still updated. The second site refuses to run if any of its settings
point to the production database (`scripts/check-target.mjs`).

The main app is also published to GitHub Pages, at the old address
https://paulnagele.github.io/bautagebuch/ (one-time setup: **Settings →
Pages → Source: GitHub Actions**). See [Moving the main app](#moving-the-main-app).

### Moving the main app

Old links (shared house links `haus.html#k=…`, start links `?tab=…`,
bookmarks) keep working through the old address:

1. Merge; the next deploy also puts the main app on Cloudflare (project
   `bautagebuch`). GitHub Pages still serves the app as before.
2. Cloudflare → *Workers & Pages → bautagebuch → Custom domains*: add the
   new address (e.g. `bau.example.com`).
3. Google Cloud → *Clients → Web client → Authorized JavaScript origins*:
   add the new address. Keep `https://paulnagele.github.io`.
4. Open the new address and check that sign-in works.
5. Repository variable `MAIN_URL` = the new address (e.g.
   `https://bau.example.com`), then *Actions → Deploy → Run workflow*. From
   then on GitHub Pages only serves a page that forwards every old link to
   the same page at the new address, with `?…` and `#…` unchanged
   (`scripts/make-forwarder.mjs`). Deleting `MAIN_URL` brings the app back
   there.

The installed phone app belongs to its address: install it again from the
new one (otherwise "Teilen → Bautagebuch" opens the forwarding page). Unsent
diary drafts are kept per address, so send them before switching.

### One-time Cloudflare setup

1. Create a free account at https://dash.cloudflare.com/sign-up.
2. **Account ID**: in the dashboard, open *Workers & Pages*; the Account
   ID is in the right-hand column (or in the browser address:
   `dash.cloudflare.com/<account ID>/…`). In GitHub, *Settings → Secrets
   and variables → Actions → Variables*, add `CLOUDFLARE_ACCOUNT_ID`.
3. **API token**: *My Profile → API Tokens → Create Token → Custom token*.
   Permission: *Account · Cloudflare Pages · Edit*; Account Resources:
   your account. Add it as the repository **secret**
   `CLOUDFLARE_API_TOKEN`.
4. The first deploy of each site creates its Pages project. If the name is already taken on pages.dev,
   Cloudflare adds a suffix; the address is shown at the end of the
   "Deploy to Cloudflare Pages" step and in the dashboard. A different
   project name can be set with the variable `CLOUDFLARE_PROJECT` in the
   site's environment.
5. Google Cloud → *Clients → Web client → Authorized JavaScript origins*:
   add the site's address (no trailing slash).

Optional: a custom domain is added in Cloudflare under the Pages project →
*Custom domains* (then add it as a Google origin too).

### The second site

1. Create a second Supabase project and set it up like
   [step 3](#3-supabase-database) (Google provider with the same Client ID
   and secret, members), but don't add repository secrets. Edge Function
   secrets (e.g. for the Haus chat) are set in that project too.
2. GitHub → *Settings → Environments → New environment* `second`:
   - Secrets: `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD` (and
     `SUPABASE_ACCESS_TOKEN` if the project belongs to another Supabase
     account).
   - Variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (and `GOOGLE_CLIENT_ID`
     to use another Google client).
3. Repository variable `SECOND_SITE` = `true`, then *Actions → Deploy →
   Run workflow*. It creates the second database's tables and the
   `bautagebuch-second` Pages project.
4. Add the address as a Google origin. In the second project's SQL Editor
   add the first member (step 3); everything else is set in that site's
   **Einstellungen**: its own Drive folder and calendar (so the sites don't
   share photos or calendar events), further members, categories and
   document types.

Migrations for one site can be run by hand with *Actions → Apply Supabase
migrations → Run workflow* and choosing the site.

## Scripts

- `npm run dev` – start the dev server
- `npm run build` – production build into `dist/`
- `npm run preview` – preview the production build
- `npm run lint` – lint with oxlint
