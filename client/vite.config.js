import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png', 'favicon.svg', 'icons.svg'],
      manifest: {
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
      },
      workbox: {
        // Private app: NEVER cache API responses. Only the app shell
        // (HTML/JS/CSS/fonts/icons) is precached; navigation falls back to
        // the cached shell so the installed app opens gracefully offline,
        // then data loads fresh once connectivity returns.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
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
        target: 'http://localhost:5000',
        changeOrigin: true
      }
    }
  }
})
