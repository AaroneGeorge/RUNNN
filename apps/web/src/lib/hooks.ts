import { useEffect, useRef, useState, type RefObject } from 'react';
import jsQR from 'jsqr';
import type { LatLng } from '@runnn/shared';

export interface Fix {
  lat: number;
  lng: number;
  acc: number;
  at: number;
}

export interface GeoState {
  fix: Fix | null;
  error: string | null;
  /** Test mode: call this with a tapped map point. */
  moveTo: (p: LatLng) => void;
}

/**
 * Real GPS, or in test mode the "fix" is wherever you tapped the map —
 * that is how you play a round from a desk.
 */
export function useGeolocation(enabled: boolean, sim: boolean, simStart: LatLng | null): GeoState {
  const [fix, setFix] = useState<Fix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const simPos = useRef<LatLng | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (sim) {
      setError(null);
      if (!simPos.current && simStart) simPos.current = simStart;
      const push = () => simPos.current && setFix({ ...simPos.current, acc: 5, at: Date.now() });
      push();
      const id = setInterval(push, 3000);
      return () => clearInterval(id);
    }
    if (!window.isSecureContext) {
      setError('GPS needs HTTPS. Open the secure link, or turn on test mode (tap-to-move) in Settings.');
      return;
    }
    if (!('geolocation' in navigator)) {
      setError('This browser has no GPS access.');
      return;
    }
    let lastReading = 0;
    const onPos = (p: GeolocationPosition) => {
      lastReading = Date.now();
      setError(null);
      setFix({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, at: Date.now() });
    };
    const onErr = (e: GeolocationPositionError) => {
      if (e.code === e.PERMISSION_DENIED) setError('Location is blocked. Allow it for this site in your browser settings.');
      else if (e.code === e.TIMEOUT) setError('Waiting for a GPS fix… step out from under cover.');
      else setError('GPS is unavailable right now.');
    };
    const id = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
    // watchPosition goes quiet when you stand still. Nudge it, or the server thinks you dropped off.
    const nudge = setInterval(() => {
      if (Date.now() - lastReading > 10_000)
        navigator.geolocation.getCurrentPosition(onPos, () => {}, { enableHighAccuracy: true, maximumAge: 5000, timeout: 10_000 });
    }, 10_000);
    return () => {
      navigator.geolocation.clearWatch(id);
      clearInterval(nudge);
    };
  }, [enabled, sim, simStart?.lat, simStart?.lng]);

  const moveTo = (p: LatLng) => {
    simPos.current = p;
    if (sim) setFix({ ...p, acc: 5, at: Date.now() });
  };

  return { fix, error, moveTo };
}

/** Keep the screen on during a round. Re-acquired on visibility change (it is dropped on tab blur). */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let gone = false;
    const get = async () => {
      try {
        if (document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen');
      } catch {
        /* battery saver, unsupported: fine */
      }
      if (gone) lock?.release().catch(() => {});
    };
    get();
    const onVis = () => document.visibilityState === 'visible' && get();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      gone = true;
      document.removeEventListener('visibilitychange', onVis);
      lock?.release().catch(() => {});
    };
  }, [active]);
}

/** Re-render every `ms`. */
export function useNow(ms = 250): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

type Detector = { detect(v: HTMLVideoElement): Promise<{ rawValue: string }[]> };

/** Native BarcodeDetector first (fast on Android Chrome), jsQR as the fallback. */
export function useQrCamera(video: RefObject<HTMLVideoElement | null>, active: boolean, onCode: (text: string) => void) {
  const cb = useRef(onCode);
  cb.current = onCode;
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    let detector: Detector | null = null;
    try {
      detector = BD ? new BD({ formats: ['qr_code'] }) : null;
    } catch {
      detector = null;
    }
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const loop = async () => {
      const v = video.current;
      if (stopped) return;
      if (v && v.readyState >= 2 && v.videoWidth) {
        try {
          if (detector) {
            for (const c of await detector.detect(v)) cb.current(c.rawValue);
          } else if (ctx) {
            const scale = Math.min(1, 640 / v.videoWidth); // jsQR is CPU-bound
            canvas.width = Math.round(v.videoWidth * scale);
            canvas.height = Math.round(v.videoHeight * scale);
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
            if (code) cb.current(code.data);
          }
        } catch {
          /* a bad frame */
        }
      }
      timer = window.setTimeout(loop, 120); // ~8 fps is plenty, and cheap
    };

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(window.isSecureContext ? 'This browser cannot open the camera.' : 'The camera needs HTTPS.');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false })
      .then(async (s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        const v = video.current;
        if (v) {
          v.srcObject = s;
          await v.play().catch(() => {});
        }
        setReady(true);
        setError(null);
        loop();
      })
      .catch((e: DOMException) =>
        setError(e.name === 'NotAllowedError' ? 'Camera access is blocked. Allow it in your browser settings.' : 'Could not open the camera.'),
      );

    return () => {
      stopped = true;
      clearTimeout(timer);
      // Stop every track or the camera light stays on.
      stream?.getTracks().forEach((t) => t.stop());
      if (video.current) video.current.srcObject = null;
      setReady(false);
    };
  }, [active, video]);

  return { error, ready };
}

export function useOnline(): boolean {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOn(true);
    const down = () => setOn(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return on;
}
