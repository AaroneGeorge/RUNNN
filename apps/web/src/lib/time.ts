import { useEffect, useState } from 'react';

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(r).padStart(2, '0')}`;
}

export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function relTime(ms: number): string {
  const d = ms - Date.now();
  const abs = Math.abs(d);
  const fmt = (n: number, u: string) => `${n} ${u}${n === 1 ? '' : 's'}`;
  let s: string;
  if (abs < 60_000) s = 'now';
  else if (abs < 3600_000) s = fmt(Math.round(abs / 60_000), 'min');
  else if (abs < 86400_000) s = fmt(Math.round(abs / 3600_000), 'hour');
  else s = fmt(Math.round(abs / 86400_000), 'day');
  if (s === 'now') return 'now';
  return d > 0 ? `in ${s}` : `${s} ago`;
}
