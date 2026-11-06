import { registerSW } from 'virtual:pwa-register';

// An installed app can stay open for days without reloading, so it would keep running an old version.
// Look for a new version every few minutes and whenever the app comes back to the front, then reload
// onto it. Never mid-game: a reload there waits until the player leaves the game screen.
const CHECK_MS = 5 * 60_000;
const inGame = () => location.pathname.startsWith('/play/');

let ready = false;
const reloadIfSafe = () => {
  if (ready && !inGame()) location.reload();
};

registerSW({
  immediate: true,
  onNeedReload() {
    ready = true;
    reloadIfSafe();
  },
  onRegisteredSW(_url, reg) {
    if (!reg) return;
    const check = () => {
      if (navigator.onLine) reg.update().catch(() => undefined);
    };
    setInterval(check, CHECK_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
  },
});

// Route changes don't fire an event (pushState), so catch the player leaving a game with a cheap poll.
setInterval(reloadIfSafe, 2000);
