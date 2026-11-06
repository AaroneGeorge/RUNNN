import { describe, expect, it } from 'vitest';
import { AuthError, Store } from '../src/store.ts';

const T0 = 1_700_000_000_000;

describe('email sign-in', () => {
  it('rejects addresses that are clearly wrong', () => {
    const s = new Store(':memory:');
    for (const bad of ['', 'nope', 'a@b', 'a b@c.com']) expect(() => s.startEmailLogin(bad, T0)).toThrow(AuthError);
  });

  it('signs in with the right code once, and creates a profile for a new address', () => {
    const s = new Store(':memory:');
    const { code } = s.startEmailLogin('  Anu@Example.com ', T0);
    expect(code).toMatch(/^\d{6}$/);
    const r = s.verifyEmailLogin('anu@example.com', code, null, T0 + 1000);
    expect(r).toMatchObject({ created: true, email: 'anu@example.com' });
    expect(s.profile(r.pid)!.name).toBe('anu');
    expect(s.emailOf(r.pid)).toBe('anu@example.com');
    // A code works once.
    expect(() => s.verifyEmailLogin('anu@example.com', code, null, T0 + 2000)).toThrow(/expired/);
  });

  it('signs the same address back into the same profile on another phone', () => {
    const s = new Store(':memory:');
    const first = s.verifyEmailLogin('zed@example.com', s.startEmailLogin('zed@example.com', T0).code, null, T0);
    const again = s.verifyEmailLogin('zed@example.com', s.startEmailLogin('zed@example.com', T0 + 60_000).code, null, T0 + 61_000);
    expect(again).toMatchObject({ pid: first.pid, token: first.token, created: false });
  });

  it('keeps a guest’s XP by adding the email to their profile', () => {
    const s = new Store(':memory:');
    const guest = s.createProfile('Bobby');
    s.db.prepare('UPDATE profiles SET xp = 120 WHERE id = ?').run(guest.profile.id);
    const r = s.verifyEmailLogin('bobby@example.com', s.startEmailLogin('bobby@example.com', T0).code, guest.profile.id, T0);
    expect(r).toMatchObject({ pid: guest.profile.id, token: guest.token, created: false });
    expect(s.profile(r.pid)!.xp).toBe(120);
  });

  it('counts wrong codes and locks after five', () => {
    const s = new Store(':memory:');
    const { code } = s.startEmailLogin('a@example.com', T0);
    const wrong = code === '000000' ? '111111' : '000000';
    expect(() => s.verifyEmailLogin('a@example.com', wrong, null, T0)).toThrow(/4 tries left/);
    for (let i = 0; i < 4; i++) expect(() => s.verifyEmailLogin('a@example.com', wrong, null, T0)).toThrow(AuthError);
    expect(() => s.verifyEmailLogin('a@example.com', code, null, T0)).toThrow(/Too many wrong tries/);
  });

  it('expires codes after 10 minutes and rate-limits sending', () => {
    const s = new Store(':memory:');
    const { code } = s.startEmailLogin('b@example.com', T0);
    expect(() => s.startEmailLogin('b@example.com', T0 + 5_000)).toThrow(/few seconds/);
    expect(() => s.verifyEmailLogin('b@example.com', code, null, T0 + 11 * 60_000)).toThrow(/expired/);
    for (let i = 1; i < 5; i++) s.startEmailLogin('b@example.com', T0 + i * 31_000);
    expect(() => s.startEmailLogin('b@example.com', T0 + 5 * 31_000)).toThrow(/Too many codes/);
    expect(() => s.startEmailLogin('b@example.com', T0 + 3_700_000)).not.toThrow();
  });
});
