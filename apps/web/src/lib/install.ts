import { useEffect, useState } from 'react';
import { load, save } from './storage.ts';

// Chrome/Android fire `beforeinstallprompt` once, early, often before React mounts,
// so capture it at module load and let components subscribe.
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notifyAll = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    notifyAll();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notifyAll();
  });
}

export const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

// iOS has no install API, only Share → Add to Home Screen, so we have to know we're on it
// to show those steps. This is about the platform's install flow, not about touch support.
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const DISMISS_KEY = 'klk.installDismissedAt';

export function useInstall() {
  const [, force] = useState(0);
  const [dismissedAt, setDismissedAt] = useState(() => load<number>(DISMISS_KEY, 0));
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  const standalone = isStandalone();
  const ios = !standalone && isIOS();
  // Ask again a week after a "not now".
  const snoozed = Date.now() - dismissedAt < 7 * 86400_000;
  return {
    show: !standalone && !snoozed && (!!deferred || ios),
    ios,
    canPrompt: !!deferred,
    async install() {
      if (!deferred) return false;
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null;
      notifyAll();
      return outcome === 'accepted';
    },
    dismiss() {
      const now = Date.now();
      save(DISMISS_KEY, now);
      setDismissedAt(now);
    },
  };
}
