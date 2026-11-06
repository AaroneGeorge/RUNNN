import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const SERVER = process.env.KALIKKAM_SERVER ?? 'http://127.0.0.1:2567';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Zombie Run',
        short_name: 'Zombie Run',
        description: 'Zombie Run: an outdoor infection-tag game for adults in Kochi.',
        theme_color: '#eeebe3',
        background_color: '#eeebe3',
        id: '/',
        lang: 'en-IN',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        categories: ['games', 'sports', 'social'],
        // Long-press the app icon for these.
        shortcuts: [
          { name: 'Join a game', short_name: 'Join', url: '/join', icons: [{ src: 'pwa-192.png', sizes: '192x192' }] },
          { name: 'Host a game', short_name: 'Host', url: '/host', icons: [{ src: 'pwa-192.png', sizes: '192x192' }] },
          { name: 'Watch a simulation', short_name: 'Simulate', url: '/sim', icons: [{ src: 'pwa-192.png', sizes: '192x192' }] },
        ],
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//, /^\/ws/],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2}'],
        runtimeCaching: [
          {
            // Map tiles + styles: cache what you've seen so a dropped signal mid-game keeps the map.
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\/.*/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'map-tiles', expiration: { maxEntries: 3000, maxAgeSeconds: 30 * 86400 } },
          },
        ],
      },
    }),
  ],
  server: {
    host: true,
    port: 5180,
    proxy: {
      '/api': SERVER,
      '/ws': { target: SERVER.replace(/^http/, 'ws'), ws: true },
    },
  },
});
