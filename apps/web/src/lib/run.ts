import { useEffect, useRef } from 'react';
import type { ClientMsg } from '@runnn/shared';
import type { Fix } from './hooks.ts';

/**
 * Send positions on a timer, not per fix: a 5 s cadence, skipping fixes older than 60 s.
 * High-accuracy GPS fires several times a second while moving; forwarding all of it burns
 * battery and tells the server nothing new. Going quiet when GPS is truly lost is the right
 * signal: it is how the server knows to stop trusting this position.
 */
export function usePositionSender(fix: Fix | null, send: (m: ClientMsg) => boolean, active: boolean) {
  const lastFix = useRef<Fix | null>(null);
  const lastSent = useRef(0);
  lastFix.current = fix;

  useEffect(() => {
    if (!active) return;
    const tick = () => {
      const f = lastFix.current;
      const now = Date.now();
      if (!f || now - lastSent.current < 4500 || now - f.at > 60_000) return;
      if (send({ t: 'pos', lat: f.lat, lng: f.lng, acc: f.acc })) lastSent.current = now;
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [active, send]);

  // The very first fix goes out right away so the lobby map is not empty.
  useEffect(() => {
    if (active && fix && lastSent.current === 0 && send({ t: 'pos', lat: fix.lat, lng: fix.lng, acc: fix.acc }))
      lastSent.current = Date.now();
  }, [active, fix, send]);
}
