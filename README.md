# Bautagebuch

A basic React app (Vite) with a login page.

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
