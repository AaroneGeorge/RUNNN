import { useEffect } from 'react';
import type { RoomView } from '@kalikkam/shared';
import type { Settings } from '../lib/storage.ts';
import { beep, vibrate } from '../lib/sound.ts';

type Level = 'none' | 'near' | 'close';
const EVERY: Record<Level, number> = { none: 0, near: 2500, close: 1100 };
const PITCH: Record<Level, number> = { none: 0, near: 600, close: 900 };

/** How close the nearest player from the other team on your radar is: inside half the range = close. */
function enemyLevel(view: RoomView | null): Level {
  const hud = view?.hud;
  const mine = view?.me.role;
  if (view?.phase !== 'live' || hud?.kind !== 'zombies' || !hud.radar || (mine !== 'zombie' && mine !== 'survivor')) return 'none';
  const enemy = hud.radar.blips.filter((b) => b.team !== mine).map((b) => Math.hypot(b.e, b.n));
  if (!enemy.length) return 'none';
  return Math.min(...enemy) <= hud.radar.range / 2 ? 'close' : 'near';
}

/** Geiger-counter style buzz + blip while the other team is on your radar, faster when they're close. */
export function useRadarFeedback(view: RoomView | null, settings: Settings) {
  const level = enemyLevel(view);
  const isZombie = view?.me.role === 'zombie';
  useEffect(() => {
    if (level === 'none') return;
    const fire = () => {
      if (settings.sound) beep(PITCH[level] * (isZombie ? 0.6 : 1), level === 'close' ? 140 : 90, isZombie ? 0.06 : 0.12, isZombie ? 'triangle' : 'sine');
      // Zombies get a quieter cue; survivors feel the danger.
      if (settings.vibrate && !isZombie) vibrate(level === 'close' ? [160, 80, 160] : [80]);
    };
    fire();
    const id = setInterval(fire, EVERY[level]);
    return () => clearInterval(id);
  }, [level, isZombie, settings.sound, settings.vibrate]);
}
