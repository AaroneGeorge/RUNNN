import { describe, expect, it } from 'vitest';
import type { GameResult } from '@kalikkam/shared';
import { AuthError, Store } from '../src/store.ts';

const T0 = 1_700_000_000_000;

describe('host accounts', () => {
  it('signs in with the right password only, case-insensitive username', () => {
    const s = new Store(':memory:');
    s.setHostPassword('Nikhil', 'correct horse');
    expect(s.hostNames()).toEqual(['nikhil']);
    expect(() => s.hostLogin('nikhil', 'wrong horse', T0)).toThrow(/Wrong username or password/);
    expect(() => s.hostLogin('nobody', 'correct horse', T0)).toThrow(/Wrong username or password/);
    const ok = s.hostLogin(' NIKHIL ', 'correct horse', T0);
    expect(ok.username).toBe('nikhil');
    expect(s.hostForToken(ok.token, T0 + 1000)).toEqual({ username: 'nikhil', pid: ok.pid });
    // The host is signed in to their own player profile too.
    expect(s.profileIdForToken(ok.profileToken)).toBe(ok.pid);
  });

  it('refuses weak passwords and odd usernames', () => {
    const s = new Store(':memory:');
    expect(() => s.setHostPassword('nikhil', 'short')).toThrow(AuthError);
    expect(() => s.setHostPassword('no spaces please', 'long enough')).toThrow(AuthError);
    expect(() => s.setHostPassword('ab', 'long enough')).toThrow(AuthError);
  });

  it('keeps one profile per host, and sessions expire after 30 days', () => {
    const s = new Store(':memory:');
    s.setHostPassword('anu', 'correct horse');
    const a = s.hostLogin('anu', 'correct horse', T0);
    const b = s.hostLogin('anu', 'correct horse', T0 + 1000);
    expect(b.pid).toBe(a.pid);
    expect(s.hostForToken(a.token, T0 + 29 * 86400_000)).not.toBeNull();
    expect(s.hostForToken(a.token, T0 + 31 * 86400_000)).toBeNull();
  });

  it('a new password, sign-out and removal all end sessions', () => {
    const s = new Store(':memory:');
    s.setHostPassword('anu', 'correct horse');
    const a = s.hostLogin('anu', 'correct horse', T0);
    s.setHostPassword('anu', 'battery staple');
    expect(s.hostForToken(a.token, T0)).toBeNull();
    expect(() => s.hostLogin('anu', 'correct horse', T0)).toThrow(/Wrong/);
    const b = s.hostLogin('anu', 'battery staple', T0);
    s.hostLogout(b.token);
    expect(s.hostForToken(b.token, T0)).toBeNull();
    const c = s.hostLogin('anu', 'battery staple', T0);
    expect(s.removeHost('anu')).toBe(true);
    expect(s.hostForToken(c.token, T0)).toBeNull();
  });
});

describe('host dashboard', () => {
  it('summarises each finished game from its log', () => {
    const s = new Store(':memory:');
    const result: GameResult = { headline: 'Survivors win!', lines: [], rows: [], endedAt: T0 };
    const log = [
      { t: 0, kind: 'start', players: [] },
      { t: 30, kind: 'infect', p: 'a', by: 'z', how: 'scan' },
      { t: 60, kind: 'infect', p: 'b', by: 'z', how: 'code' },
      { t: 90, kind: 'infect', p: 'c', by: null, how: 'unknown' },
      { t: 95, kind: 'out', p: 'd', outcome: 'eliminated' },
      { t: 120, kind: 'host', action: 'end', reason: 'broken', left: 480 },
      { t: 120, kind: 'gps', p: 'a', gaps: 2 },
      { t: 120, kind: 'gps', p: 'b', gaps: 0 },
      { t: 120, kind: 'end', reason: 'host', hostReason: 'broken' },
    ];
    s.saveResult({ code: 'ABCD', game: 'zombies', title: 'Test night', eventId: null }, result, () => null, log);
    const [g] = s.recentGames();
    expect(g).toMatchObject({
      code: 'ABCD',
      title: 'Test night',
      endReason: 'broken',
      infections: { scan: 1, code: 1, unknown: 1 },
      eliminated: 1,
      gpsDropouts: 1,
      hasLog: true,
    });
    expect(s.gameLog(g.id)!.log).toHaveLength(log.length);
    expect(s.gameLog(9999)).toBeNull();
  });
});
