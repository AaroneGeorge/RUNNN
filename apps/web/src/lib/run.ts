// "Your run" (beta): your own route during a game, kept only on this phone. It's never sent to the server,
// so the promise on the join screen still holds: the game itself doesn't store anyone's location.
import { distance, type LatLng } from '@kalikkam/shared';
import { load, save } from './storage.ts';

export interface RunPoint {
  lat: number;
  lng: number;
  /** Seconds since the round started. */
  t: number;
  /** 1 while you were a zombie, so the route can change colour when you were infected. */
  z: 0 | 1;
}
export interface Run {
  startedAt: number;
  points: RunPoint[];
}

const MAX_POINTS = 5000;
/** A fuzzier fix than this would draw zig-zags that you never ran. */
const MAX_ACC = 35;
const key = (code: string) => `klk.run.${code}`;

/** Add a fix to this game's run: only when you've moved a few metres, or every 15 s while standing still. */
export function recordRun(code: string, startedAt: number, fix: LatLng & { acc: number; at: number }, zombie: boolean) {
  if (fix.acc > MAX_ACC) return;
  let run = load<Run | null>(key(code), null);
  // A rematch in the same room starts a new run.
  if (!run || run.startedAt !== startedAt) run = { startedAt, points: [] };
  if (run.points.length >= MAX_POINTS) return;
  const t = Math.max(0, Math.round((fix.at - startedAt) / 1000));
  const z = zombie ? 1 : 0;
  const last = run.points.at(-1);
  if (last && last.z === z && distance(last, fix) < 3 && t - last.t < 15) return;
  run.points.push({ lat: +fix.lat.toFixed(6), lng: +fix.lng.toFixed(6), t, z });
  save(key(code), run);
}

export function getRun(code: string, startedAt: number | null): Run | null {
  const run = load<Run | null>(key(code), null);
  return run && startedAt !== null && run.startedAt === startedAt && run.points.length >= 2 ? run : null;
}

export function forgetRun(code: string) {
  save(key(code), null);
}

/** Metres run and seconds covered. */
export function runStats(run: Run): { metres: number; secs: number } {
  let metres = 0;
  for (let i = 1; i < run.points.length; i++) metres += distance(run.points[i - 1], run.points[i]);
  return { metres, secs: run.points.at(-1)!.t - run.points[0].t };
}

/** The route as coloured pieces: white while you were a survivor, yellow once you were a zombie. */
export function runSegments(run: Run): { points: LatLng[]; color: string }[] {
  const out: { points: LatLng[]; color: string; z: number }[] = [];
  for (const p of run.points) {
    const cur = out.at(-1);
    if (!cur || cur.z !== p.z) {
      // Start the next piece where the last one ended, so the line doesn't break.
      const from = cur?.points.at(-1);
      out.push({ points: from ? [from, p] : [p], color: p.z ? '#ffc21a' : '#ffffff', z: p.z });
    } else cur.points.push(p);
  }
  return out.map(({ points, color }) => ({ points, color }));
}
