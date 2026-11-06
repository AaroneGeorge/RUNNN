import { useEffect, useRef } from 'react';
import type { Radar, Role } from '@runnn/shared';
import { beep } from '../lib/sound.ts';

/** Closest blip of the other side, in metres, or null. */
export function nearestThreat(radar: Radar | null, role: Role | null): number | null {
  if (!radar || (role !== 'hunter' && role !== 'runner')) return null;
  const other = role === 'hunter' ? 'runner' : 'hunter';
  let best: number | null = null;
  for (const b of radar.blips) {
    if (b.team !== other) continue;
    const d = Math.hypot(b.e, b.n);
    if (best === null || d < best) best = d;
  }
  return best;
}

/**
 * Geiger-counter feedback: silent when the other side is out of range, a slow blip inside
 * range, fast within half of it. The chased side gets the stronger cue: the hunted should
 * feel hunted.
 */
export function useGeiger(radar: Radar | null, role: Role | null, enabled: boolean) {
  const state = useRef({ radar, role });
  state.current = { radar, role };

  useEffect(() => {
    if (!enabled) return;
    let timer = 0;
    let stopped = false;
    const loop = () => {
      if (stopped) return;
      const { radar: r, role: me } = state.current;
      const d = nearestThreat(r, me);
      let wait = 1200;
      if (d !== null && r) {
        const k = Math.max(0, Math.min(1, d / r.range));
        wait = d < r.range / 2 ? 180 + 420 * k : 700 + 900 * k;
        const runner = me === 'runner';
        beep(runner ? 1250 - 400 * k : 700, runner ? 45 : 35, runner ? 0.12 : 0.07, runner ? 'square' : 'sine');
      }
      timer = window.setTimeout(loop, wait);
    };
    loop();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [enabled]);
}
