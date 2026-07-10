import { defineConfig } from 'vite';

// Vite serves the frontend. `vercel dev` runs this alongside the
// serverless functions in /api, proxying automatically so a single
// `vercel dev` gives you the app + the Gemini briefing endpoint.
export default defineConfig({
  server: {
    port: 5173,
    // In plain `npm run dev` there are no serverless functions, so proxy the
    // one keyless endpoint (humans in space) to the live feed through the dev
    // server. This dodges the mixed-content/CORS issue and lets the feature
    // show locally. In production, Vercel's /api/humans function handles it.
    proxy: {
      '/api/humans': {
        target: 'http://api.open-notify.org',
        changeOrigin: true,
        rewrite: () => '/astros.json',
      },
    },
  },
  build: {
    target: 'esnext',
  },
});
