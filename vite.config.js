import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the build works under a subpath,
  // e.g. GitHub Pages at /bautagebuch/.
  base: './',
  // The Haus tab's chunk holds three.js (about 600 kB, 165 kB gzipped);
  // it is only loaded when that tab is opened.
  // Two pages: the app, and haus.html, the shared house page (no login).
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: { input: { main: 'index.html', haus: 'haus.html' } },
  },
})
