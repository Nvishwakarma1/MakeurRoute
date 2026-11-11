import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        enabled: true
      },
      includeAssets: ['favicon.svg', 'icon-192x192.png', 'icon-512x512.png', 'icon-maskable-512x512.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // Never intercept or cache Mapbox tile, style, font, or telemetry hosts (Mapbox ToS + 429 safety).
        // Cross-origin api.mapbox.com / *.tiles.mapbox.com / events.mapbox.com requests pass straight to network.
        navigateFallbackDenylist: [/^\/api\//, /^https:\/\/(?:api|events|[^/]+\.tiles)\.mapbox\.com\//i],
        runtimeCaching: [],
      },
      manifest: {
        id: '/',
        start_url: '/',
        scope: '/',
        name: 'Custom GPS Navigator',
        short_name: 'NavApp',
        description: 'Draw custom bypass routes, search places, and navigate live',
        theme_color: '#090d16',
        background_color: '#090d16',
        display: 'standalone',
        icons: [
          {
            src: '/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/icon-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      }
    })
  ]
})