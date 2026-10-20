import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Provision POS', short_name: 'Provision POS', description: 'Offline POS, barcode scanner and inventory',
        display: 'standalone', start_url: '/', scope: '/', theme_color: '#1b6b3a', background_color: '#ffffff',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
        navigateFallbackDenylist: [/^\/\.well-known\//],   // Android app verification file must never be replaced by the app page
        // product photos already seen stay viewable offline (requested with CORS, so they are not "opaque" and cost no extra quota)
        runtimeCaching: [{ urlPattern: /^https:\/\/res\.cloudinary\.com\//, handler: 'CacheFirst',
          options: { cacheName: 'product-photos', expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 60 }, cacheableResponse: { statuses: [200] } } }]
      }
    })
  ],
  test: { environment: 'node', setupFiles: ['fake-indexeddb/auto'], include: ['src/**/*.test.ts'] }
});
