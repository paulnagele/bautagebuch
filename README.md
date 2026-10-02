# Bautagebuch

A React app (Vite) for keeping a construction diary. After signing in
there are three tabs:

- **Diary** – write and edit daily site entries (date, weather, workers
  on site, work carried out, notes).
- **Finances** – record income and expenses by category, with totals and
  the current balance.
- **Timetable** – schedule tasks with trade, start/end date and status;
  overdue tasks are flagged.

## Getting started

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

## Login

There is no backend yet. `src/pages/Login.jsx` uses a placeholder
`fakeAuthenticate` function that accepts any valid email address with a
password of at least 6 characters. Replace it with a real API call once
authentication is available.

## Data storage

There is no backend yet, so all entries are saved in the browser's
`localStorage`, separately per signed-in email address
(`src/storage.js`). Data stays on that device and browser only and is
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
