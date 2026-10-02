# Bautagebuch

A React app (Vite) for keeping a construction diary. After signing in
there are three tabs:

- **Diary** – write and edit daily site entries (date, weather, workers
  on site, work carried out, notes) with photos.
- **Finances** – record funding (own funds, bank loan, housing subsidy,
  …) and expenses by category. Shows funding secured, spent and
  remaining, how the project is financed and where the money goes.
- **Timetable** – the project's Google Calendar, embedded
  (`src/tabs/Timetable.jsx`). The calendar must be public to be visible
  to everyone using the app.

## Getting started

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

## Google sign-in

Users sign in with their Google account ("Sign in with Google", Google
Identity Services). Only name, email address and profile picture are
requested. Without a configured Client ID the login page offers a demo
mode instead.

### One-time setup

1. Open the [Google Cloud Console](https://console.cloud.google.com/),
   create a project (e.g. "Bautagebuch").
2. **Google Auth Platform → Branding**: enter an app name and support
   email. **Audience**: choose *External*. Either add every family member
   under *Test users*, or click *Publish app* (no Google review is needed
   for name/email sign-in).
3. **Google Auth Platform → Clients → Create client**: type *Web
   application*. Under **Authorized JavaScript origins** add:
   - `https://paulnagele.github.io`
   - `http://localhost:5173` (local development)
   - `http://localhost:4173` (local `npm run preview`)

   No redirect URIs are needed. Copy the **Client ID**.
4. **GitHub**: in the repository go to **Settings → Secrets and
   variables → Actions → Variables** and add:
   - `GOOGLE_CLIENT_ID` – the Client ID from step 3
   - `ALLOWED_EMAILS` (optional) – comma-separated Google accounts that
     may sign in, e.g. `anna@gmail.com,ben@gmail.com`

   Then re-run the "Deploy to GitHub Pages" workflow (Actions tab).
5. **Local development**: copy `.env.example` to `.env.local` and fill in
   the same values.

The Client ID is not a secret. Note that without a backend the allowlist
is only checked in the browser; real access control comes with the
backend.

## Data storage

There is no backend yet, so all entries are saved in the browser's
`localStorage`, separately per signed-in email address
(`src/storage.js`). Diary photos are resized to at most 1600 px and kept
in IndexedDB (`src/imageStore.js`). Data stays on that device and browser only and is
lost if site data is cleared.

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
