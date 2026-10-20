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
      workbox: { globPatterns: ['**/*.{js,css,html,png,svg,ico}'] }
    })
  ],
  test: { environment: 'node', setupFiles: ['fake-indexeddb/auto'], include: ['src/**/*.test.ts'] }
});
