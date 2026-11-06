import { describe, expect, it } from 'vitest';
import type { GameResult, ResultRow } from '@runnn/shared';
import { Store } from '../src/store.ts';

const row = (over: Partial<ResultRow>): ResultRow => ({
  playerId: Math.random().toString(36),
  profileId: null,
  name: 'x',
  isBot: false,
  team: 'runner',
  role: 'runner',
  status: 'active',
  points: { runner: 0, hunter: null },
  conversions: 0,
  survivedSecs: 0,
  won: false,
  ...over,
});

const result = (rows: ResultRow[], endedAt = Date.now()): GameResult => ({
  reason: 'time',
  winner: 'runner',
  headline: 'Runners held out.',
  endedAt,
  durationSecs: 600,
  rows,
  top: { runner: null, hunter: null },
  eliminated: [],
});

describe('results and XP', () => {
  it('awards XP, wins and badges per profile', () => {
    const s = new Store();
    const a = s.createProfile('A').profile;
    const b = s.createProfile('B').profile;
    const saved = s.saveResult({
      roomCode: 'ABCD',
      game: 'chase',
      title: 'Park run',
      eventId: null,
      organiserProfileId: null,
      log: [{ t: 0, kind: 'start' }],
      result: result([
        row({ profileId: a.id, won: true, points: { runner: 100, hunter: null } }),
        row({ profileId: b.id, team: 'hunter', role: 'hunter', conversions: 4, points: { runner: null, hunter: 100 } }),
        row({ isBot: true, profileId: null }),
      ]),
    });
    expect(saved.rows).toHaveLength(2);
    const pa = s.profile(a.id)!;
    const pb = s.profile(b.id)!;
    expect(pa.xp).toBe(10 + 25);
    expect(pa.wins).toBe(1);
    expect(pa.badges.map((x) => x.id)).toEqual(expect.arrayContaining(['first_game', 'first_win', 'survivor']));
    expect(pb.xp).toBe(10 + 20);
    expect(pb.badges.map((x) => x.id)).toContain('pack_leader');
    expect(pb.best.hunter).toBe(100);
    expect(s.history(a.id)[0].title).toBe('Park run');
  });

  it('keeps the round log and summarises it', () => {
    const s = new Store();
    const { resultId } = s.saveResult({
      roomCode: 'ABCD',
      game: 'chase',
      title: 'T',
      eventId: null,
      organiserProfileId: null,
      log: [
        { t: 1, kind: 'scan', outcome: 'started' },
        { t: 2, kind: 'convert' },
        { t: 3, kind: 'out', outcome: 'eliminated' },
      ],
      result: result([]),
    });
    expect(s.round(resultId)!.log).toHaveLength(3);
    expect(s.rounds()[0].summary).toEqual({ scans: 1, conversions: 1, codeAttempts: 0, eliminated: 1, sos: 0 });
  });

  it('ranks leaderboards with shared places on ties', () => {
    const s = new Store();
    const ids = ['A', 'B', 'C'].map((n) => s.createProfile(n).profile.id);
    s.saveResult({
      roomCode: 'X',
      game: 'chase',
      title: 'T',
      eventId: null,
      organiserProfileId: null,
      log: [],
      result: result([
        row({ profileId: ids[0], points: { runner: 80, hunter: null } }),
        row({ profileId: ids[1], points: { runner: 80, hunter: null } }),
        row({ profileId: ids[2], points: { runner: 30, hunter: null } }),
      ]),
    });
    const board = s.leaderboard('runner', 'all');
    expect(board.map((r) => r.rank)).toEqual([1, 1, 3]);
    expect(s.leaderboard('xp', 'week').length).toBe(3);
    expect(s.leaderboard('runner', 'week', Date.now() + 30 * 86400_000)).toEqual([]);
  });
});

describe('events', () => {
  it('fills seats then waitlists, and promotes on leave', () => {
    const s = new Store();
    const host = s.createProfile('Host').profile.id;
    const e = s.createEvent(host, { title: 'Sunday run', game: 'chase', startsAt: Date.now() + 86400_000, place: 'Park gate', capacity: 3 });
    expect(e.going).toBe(1);
    const [a, b, c] = ['A', 'B', 'C'].map((n) => s.createProfile(n).profile.id);
    expect(s.rsvp(e.id, a)).toBe('going');
    expect(s.rsvp(e.id, b)).toBe('going');
    expect(s.rsvp(e.id, c)).toBe('waitlist');
    s.unrsvp(e.id, a);
    expect(s.event(e.id, c)!.mine).toBe('going');
  });

  it('validates new events and lets only the host cancel', () => {
    const s = new Store();
    const host = s.createProfile('Host').profile.id;
    const other = s.createProfile('Other').profile.id;
    expect(() => s.createEvent(host, { title: '', place: 'x', startsAt: Date.now() + 1000, capacity: 10 })).toThrow();
    const e = s.createEvent(host, { title: 'Run', game: 'chase', startsAt: Date.now() + 3600_000, place: 'Gate', capacity: 10 });
    expect(() => s.cancelEvent(e.id, other, false)).toThrow(/host/);
    s.cancelEvent(e.id, host, false);
    expect(() => s.rsvp(e.id, other)).toThrow(/cancelled/);
  });
});
