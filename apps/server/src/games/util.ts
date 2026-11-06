import type { Player, Room } from '../room.ts';

export function fmtDuration(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r} s`;
  return r ? `${m} min ${r} s` : `${m} min`;
}

/** Closest player in `list` to `p` (fresh GPS fixes only). */
export function nearest(room: Room, p: Player, list: Player[]): { player: Player; d: number } | null {
  let best: { player: Player; d: number } | null = null;
  for (const q of list) {
    if (q.id === p.id) continue;
    const d = room.dist(p, q);
    if (d !== null && (!best || d < best.d)) best = { player: q, d };
  }
  return best;
}
