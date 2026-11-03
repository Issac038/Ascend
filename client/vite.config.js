import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// The canonical web app manifest. Single source of truth: it is passed to
// VitePWA below (production build output) and served verbatim by the
// dev-only middleware further down, so dev and prod can never drift.
const webManifest = {
  name: 'Ascend — Become better. Every day.',
  short_name: 'Ascend',
  description: 'A personal command center for self-improvement: goals, habits, tasks, journaling and analytics.',
  lang: 'en',
  display: 'standalone',
  orientation: 'portrait',
  start_url: '/',
  scope: '/',
  background_color: '#080808',
  theme_color: '#080808',
  categories: ['productivity', 'lifestyle', 'health'],
  icons: [
    { src: '/icons/pwa-icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icons/pwa-icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/icons/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ]
}

// Dev-only: vite-plugin-pwa only serves /manifest.webmanifest during `vite dev`
// when devOptions.enabled is true — and that flag would also register a dev
// service worker, which we don't want. Without it, the request falls through
// to Vite's HTML fallback and the browser receives index.html (text/html),
// which Chrome reports as "Manifest: Line 1, column 1, Syntax error".
// This middleware serves the exact same manifest object with the correct
// content type. Production keeps using the plugin-generated file.
function serveWebManifestInDev() {
  return {
    name: 'ascend:dev-web-manifest',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url || '').split('?')[0]
        if (path !== '/manifest.webmanifest') return next()
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/manifest+json')
        res.setHeader('Cache-Control', 'no-cache')
        res.end(JSON.stringify(webManifest, null, 2))
      })
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    serveWebManifestInDev(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png', 'favicon.svg', 'icons.svg'],
      manifest: webManifest,
      workbox: {
        // Private app: NEVER cache API responses. Only the app shell
        // (HTML/JS/CSS/fonts/icons) is precached; navigation falls back to
        // the cached shell so the installed app opens gracefully offline,
        // then data loads fresh once connectivity returns.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        // Push handlers run INSIDE the generated service worker — this is
        // what delivers notifications while the app is closed/backgrounded.
        importScripts: ['push-handler.js'],
        runtimeCaching: [
          {
            // Google Fonts: cacheable static assets, stale-while-revalidate
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'ascend-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 }
            }
          }
        ],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024
      },
      devOptions: { enabled: false }
    })
  ],
  server: {
    // Development only: forward /api to the local backend so the client
    // never needs a hardcoded localhost API URL. In production set
    // VITE_API_URL to the real API origin (see client/.env.example).
    proxy: {
      '/api': {
        // Must match the Express backend's port: server/server.js listens on
        // PORT || 5000. Override with VITE_API_PORT only if you run the
        // backend elsewhere. Production is unaffected (no dev proxy there).
        target: `http://localhost:${process.env.VITE_API_PORT || 5000}`,
        changeOrigin: true
      }
    }
  }
})
