import { registerSW } from 'virtual:pwa-register';

/**
 * autoUpdate service worker. A new version activates on its own; we never reload
 * in the middle of a round, so the page picks it up on the next navigation.
 */
export function startServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  registerSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      // Check for a new build every hour while the app stays open.
      setInterval(() => reg.update().catch(() => {}), 3600_000);
    },
  });
}
