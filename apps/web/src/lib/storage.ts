// localStorage can throw (private mode, blocked storage) — never let it break the app.

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export interface Session {
  playerId?: string;
  secret?: string;
  hostKey?: string;
  name?: string;
  vest?: string;
}

export const sessionKey = (code: string) => `klk.session.${code.toUpperCase()}`;
export const getSession = (code: string) => load<Session | null>(sessionKey(code), null);
export const setSession = (code: string, s: Session | null) => save(sessionKey(code), s);

export interface StoredProfile {
  id: string;
  token: string;
  name: string;
  /** Set when the profile is signed in with email (it then works on any phone). */
  email?: string | null;
}
export const getProfile = () => load<StoredProfile | null>('klk.profile', null);
export const setProfile = (p: StoredProfile | null) => save('klk.profile', p);

/** Signed in as a host (an organiser's username and password). Only hosts create games and events. */
export interface StoredHost {
  username: string;
  token: string;
}
export const getHost = () => load<StoredHost | null>('klk.host', null);
export const setHost = (h: StoredHost | null) => save('klk.host', h);

export interface Settings {
  /** Light, dark, or follow the phone. Applied by lib/theme.ts (and index.html before first paint). */
  theme: 'system' | 'light' | 'dark';
  simGps: boolean;
  sound: boolean;
  vibrate: boolean;
  /** Beta: draw your own route on a map after each game (kept on this phone only). */
  runMap: boolean;
}
const DEFAULT_SETTINGS: Settings = { theme: 'system', simGps: false, sound: true, vibrate: true, runMap: true };
export const getSettings = (): Settings => ({ ...DEFAULT_SETTINGS, ...load<Partial<Settings>>('klk.settings', {}) });
export const setSettings = (s: Settings) => save('klk.settings', s);

export const lastName = () => getProfile()?.name ?? load<string>('klk.name', '');

/** First launch: the splash, tour and sign-in run once, then the app opens straight to Home. */
export const hasWelcomed = () => load<boolean>('klk.welcomed', false);
export const setWelcomed = () => save('klk.welcomed', true);
export const rememberName = (n: string) => save('klk.name', n);
