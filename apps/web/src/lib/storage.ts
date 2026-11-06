import { useSyncExternalStore } from 'react';

const PREFIX = 'runnn:';
const listeners = new Set<() => void>();

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* private mode: keep going in memory */
  }
  cache.clear();
  for (const l of listeners) l();
}

const cache = new Map<string, unknown>();
function cached<T>(key: string, fallback: T): T {
  if (!cache.has(key)) cache.set(key, read(key, fallback));
  return cache.get(key) as T;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith(PREFIX)) {
      cache.clear();
      fn();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('storage', onStorage);
  };
}

export function useStored<T>(key: string, fallback: T): T {
  return useSyncExternalStore(subscribe, () => cached(key, fallback));
}

// ───────────────────────────── settings ─────────────────────────────

export interface Settings {
  sound: boolean;
  vibrate: boolean;
  theme: 'system' | 'light' | 'dark';
  /** GPS test mode: tap the map to move. */
  gpsTest: boolean;
  seenWelcome: boolean;
}

const DEFAULT_SETTINGS: Settings = { sound: true, vibrate: true, theme: 'system', gpsTest: false, seenWelcome: false };

export const getSettings = (): Settings => ({ ...DEFAULT_SETTINGS, ...cached<Partial<Settings>>('settings', {}) });
export const setSettings = (patch: Partial<Settings>) => write('settings', { ...getSettings(), ...patch });
export function useSettings(): Settings {
  const raw = useStored<Partial<Settings>>('settings', {});
  return { ...DEFAULT_SETTINGS, ...raw };
}

// ───────────────────────────── identity ─────────────────────────────

export interface Organiser {
  token: string;
  username: string;
}

export const getProfileToken = () => cached<string | null>('profile', null);
export const setProfileToken = (t: string | null) => write('profile', t);
export const useProfileToken = () => useStored<string | null>('profile', null);

export const getOrganiser = () => cached<Organiser | null>('organiser', null);
export const setOrganiser = (o: Organiser | null) => write('organiser', o);
export const useOrganiser = () => useStored<Organiser | null>('organiser', null);

export const getLastName = () => cached<string>('name', '');
export const setLastName = (n: string) => write('name', n);

// ───────────────────────────── game sessions ─────────────────────────────

export interface Session {
  playerId?: string;
  secret?: string;
  organiserKey?: string;
  name?: string;
  bib?: string;
}

type Sessions = Record<string, Session & { at: number }>;

export function getSession(code: string): Session {
  return cached<Sessions>('sessions', {})[code] ?? {};
}

export function setSession(code: string, patch: Session) {
  const all = { ...cached<Sessions>('sessions', {}) };
  all[code] = { ...all[code], ...patch, at: Date.now() };
  // Keep the 20 most recent.
  const keep = Object.entries(all)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, 20);
  write('sessions', Object.fromEntries(keep));
}

export function forgetSession(code: string) {
  const all = { ...cached<Sessions>('sessions', {}) };
  delete all[code];
  write('sessions', all);
}

export function recentSessions(): { code: string; at: number; isHost: boolean }[] {
  return Object.entries(cached<Sessions>('sessions', {}))
    .map(([code, s]) => ({ code, at: s.at, isHost: !!s.organiserKey }))
    .sort((a, b) => b.at - a.at);
}
