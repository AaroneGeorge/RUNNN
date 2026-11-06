import { useCallback, useEffect, useRef, useState } from 'react';
import type { LatLng } from '@kalikkam/shared';

export interface GeoFix extends LatLng {
  acc: number;
  at: number;
}

export type GeoState =
  | { kind: 'idle' }
  | { kind: 'waiting' }
  | { kind: 'ok'; fix: GeoFix }
  | { kind: 'error'; message: string; fix?: GeoFix };

/**
 * Live GPS. With `sim` on, the position is whatever you tap on the map —
 * lets us test full games from a laptop.
 */
export function useGeolocation(enabled: boolean, sim: boolean, simStart: LatLng | null) {
  const [state, setState] = useState<GeoState>({ kind: 'idle' });
  const simPos = useRef<LatLng | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (sim) {
      const start = simPos.current ?? simStart;
      if (start) {
        simPos.current = start;
        setState({ kind: 'ok', fix: { ...start, acc: 5, at: Date.now() } });
      }
      // Keep the fix "fresh" like a real GPS would.
      const id = setInterval(() => {
        if (simPos.current) setState({ kind: 'ok', fix: { ...simPos.current, acc: 5, at: Date.now() } });
      }, 3000);
      return () => clearInterval(id);
    }
    if (!('geolocation' in navigator)) {
      setState({ kind: 'error', message: 'This browser has no GPS access.' });
      return;
    }
    if (!window.isSecureContext) {
      setState({ kind: 'error', message: 'GPS needs HTTPS. Open the secure link, or turn on test mode (tap-to-move).' });
      return;
    }
    setState((s) => (s.kind === 'ok' ? s : { kind: 'waiting' }));
    let lastReading = Date.now();
    const onPos = (p: GeolocationPosition) => {
      lastReading = Date.now();
      setState({ kind: 'ok', fix: { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, at: Date.now() } });
    };
    // watchPosition can go quiet for a long time when you don't move: ask for a reading now and then.
    const nudge = setInterval(() => {
      if (Date.now() - lastReading > 10_000) navigator.geolocation.getCurrentPosition(onPos, () => undefined, { enableHighAccuracy: true, maximumAge: 5000, timeout: 10_000 });
    }, 10_000);
    const id = navigator.geolocation.watchPosition(
      onPos,
      (err) =>
        setState((s) => ({
          kind: 'error',
          message:
            err.code === err.PERMISSION_DENIED
              ? 'Location permission denied. Allow location for this site in your browser settings.'
              : err.code === err.TIMEOUT
                ? 'GPS is slow to respond. Step into open sky.'
                : 'GPS unavailable right now.',
          fix: s.kind === 'ok' ? s.fix : undefined,
        })),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
    );
    return () => {
      navigator.geolocation.clearWatch(id);
      clearInterval(nudge);
    };
  }, [enabled, sim, simStart?.lat, simStart?.lng]);

  const setSimPos = useCallback((p: LatLng) => {
    simPos.current = p;
    setState({ kind: 'ok', fix: { ...p, acc: 5, at: Date.now() } });
  }, []);

  return { state, setSimPos };
}

/** Keep the screen on during a game (the radar only works with the app open). */
export function useWakeLock(active: boolean) {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
        if (cancelled) return void lock.release();
        setHeld(true);
        lock.addEventListener('release', () => setHeld(false));
      } catch {
        setHeld(false);
      }
    };
    void acquire();
    const onVis = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      void lock?.release();
    };
  }, [active]);
  return held;
}
