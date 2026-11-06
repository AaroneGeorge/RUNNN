import { describe, expect, it } from 'vitest';
import type { GameResult, ResultRow } from '@kalikkam/shared';
import { Store } from '../src/store.ts';

const ROOM = { code: 'TEST', game: 'zombies' as const, title: 'test', eventId: null };

function row(id: string, role: 'zombie' | 'survivor', survivor: number | null, zombie: number | null): ResultRow {
  return { id, name: id, role, status: 'active', won: false, points: { survivor, zombie }, stats: {} };
}

function save(s: Store, endedAt: number, rows: ResultRow[], pids: Record<string, string>) {
  const result: GameResult = { headline: 'test', lines: [], rows, endedAt };
  s.saveResult(ROOM, result, (playerId) => pids[playerId] ?? null);
}

describe('high scores', () => {
  it('keeps each player’s best score on each board', () => {
    const s = new Store(':memory:');
    const anu = s.createProfile('Anu').profile.id;
    expect(s.profile(anu)!.best).toEqual({ survivor: null, zombie: null });
    save(s, 1000, [row('p1', 'survivor', 120, 25)], { p1: anu }); // survived 12 min, then infected once
    save(s, 2000, [row('p1', 'zombie', null, 75)], { p1: anu });
    save(s, 3000, [row('p1', 'survivor', 40, null)], { p1: anu });
    expect(s.profile(anu)!.best).toEqual({ survivor: 120, zombie: 75 });
    expect(s.history(anu).map((h) => h.points)).toEqual([
      { survivor: 40, zombie: null },
      { survivor: null, zombie: 75 },
      { survivor: 120, zombie: 25 },
    ]);
  });

  it('ranks the zombie and survivor boards separately, by best single game', () => {
    const s = new Store(':memory:');
    const anu = s.createProfile('Anu').profile.id;
    const zed = s.createProfile('Zed').profile.id;
    const bob = s.createProfile('Bob').profile.id;
    save(s, 1000, [row('a', 'survivor', 200, null), row('z', 'zombie', null, 50), row('b', 'survivor', 30, 100)], { a: anu, z: zed, b: bob });
    save(s, 5000, [row('z', 'zombie', null, 25)], { z: zed });
    expect(s.highScores('zombie', null).map((r) => [r.name, r.best])).toEqual([
      ['Bob', 100],
      ['Zed', 50],
    ]);
    expect(s.highScores('survivor', null).map((r) => [r.name, r.best])).toEqual([
      ['Anu', 200],
      ['Bob', 30],
    ]);
    // A period only counts games that ended in it.
    expect(s.highScores('zombie', 4000).map((r) => [r.name, r.best, r.games])).toEqual([['Zed', 25, 1]]);
  });
});
