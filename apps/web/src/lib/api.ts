import { getHost, getProfile, setHost, setProfile } from './storage.ts';
import type { HostSession, Profile, SignInResponse } from '@kalikkam/shared';

export class ApiError extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const prof = getProfile();
  if (prof) headers.authorization = `Bearer ${prof.token}`;
  const host = getHost();
  if (host) headers['x-host-token'] = host.token;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'No connection to the game server');
  }
  const data = await res.json().catch(() => ({}));
  // A host session that expired or was signed out elsewhere: forget it, so the app shows the player view.
  if (res.status === 403 && host && path.startsWith('/api/host/')) setHost(null);
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Error ${res.status}`);
  return data as T;
}

/** Sign in as a host. The host is also signed in to their own player profile on this phone. */
export async function hostSignIn(username: string, password: string): Promise<HostSession> {
  const s = await api<HostSession>('/api/host/login', { body: { username, password } });
  setHost({ username: s.username, token: s.token });
  setProfile({ id: s.profile.id, token: s.profileToken, name: s.profile.name });
  return s;
}

export async function hostSignOut() {
  await api('/api/host/logout', { body: {} }).catch(() => undefined);
  setHost(null);
}

/** Email sign-in, step 1: email a 6-digit code (or, without a mail service, print it in the server console). */
export function requestEmailCode(email: string) {
  return api<{ ok: true; delivery: 'email' | 'console' }>('/api/auth/email/start', { body: { email } });
}

/** Email sign-in, step 2: trade the code for the profile and keep it on this device. A guest keeps their XP. */
export async function verifyEmailCode(email: string, code: string): Promise<SignInResponse> {
  const r = await api<SignInResponse>('/api/auth/email/verify', { body: { email, code } });
  setProfile({ id: r.profile.id, token: r.token, name: r.profile.name, email: r.email });
  return r;
}

/** Make sure this device has a profile (creates one on first use). */
export async function ensureProfile(name: string): Promise<{ id: string; token: string; name: string }> {
  const existing = getProfile();
  if (existing) {
    if (name && name !== existing.name) {
      try {
        await api('/api/me', { method: 'PATCH', body: { name } });
        const p = { ...existing, name };
        setProfile(p);
        return p;
      } catch (e) {
        // Token unknown to this server (e.g. DB reset) — fall through and recreate.
        if (!(e instanceof ApiError && e.status === 401)) return existing;
      }
    } else return existing;
  }
  const r = await api<{ profile: Profile; token: string }>('/api/profile', { body: { name } });
  const p = { id: r.profile.id, token: r.token, name: r.profile.name };
  setProfile(p);
  return p;
}
