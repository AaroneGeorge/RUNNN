import { beforeAll, describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { ENTRY_USDC, circleToPolygon, normalizeConfig } from '@kalikkam/shared';
import { newPlayerWallet, openKey, roundId, splitPot } from '../src/arc.ts';
import { Room } from '../src/room.ts';

const ONE = 10n ** 18n;
const row = (id: string, paid: boolean, survivor: number | null, zombie: number | null) => ({ id, paid, points: { survivor, zombie } });

beforeAll(() => {
  process.env.WALLET_SECRET = 'test-secret';
});

describe('splitting the pot', () => {
  it('gives half to the top survivor and half to the top zombie', () => {
    const plan = splitPot(4n * ONE, [row('s', true, 200, null), row('s2', true, 50, null), row('z', true, null, 75), row('x', true, 10, 0)]);
    expect(plan).toEqual({ kind: 'settle', splits: [{ id: 's', amount: 2n * ONE }, { id: 'z', amount: 2n * ONE }] });
  });

  it('ties share their half, exact to the wei', () => {
    const plan = splitPot(3n * ONE, [row('a', true, 200, null), row('b', true, 200, null), row('z', true, null, 25)]);
    if (plan.kind !== 'settle') throw new Error('expected a payout');
    const total = plan.splits.reduce((t, s) => t + s.amount, 0n);
    expect(total).toBe(3n * ONE);
    expect(plan.splits.find((s) => s.id === 'z')!.amount).toBe(3n * ONE - (3n * ONE) / 2n);
  });

  it("gives a board nobody scored on to the other board, and refunds when nobody scored", () => {
    expect(splitPot(2n * ONE, [row('a', true, 30, null), row('z', true, null, 0)])).toEqual({ kind: 'settle', splits: [{ id: 'a', amount: 2n * ONE }] });
    expect(splitPot(2n * ONE, [row('a', true, 0, null), row('z', true, null, 0)])).toEqual({ kind: 'refund' });
  });

  it("never pays someone who didn't pay in", () => {
    const plan = splitPot(1n * ONE, [row('free', false, 500, null), row('a', true, 10, null)]);
    expect(plan).toEqual({ kind: 'settle', splits: [{ id: 'a', amount: ONE }] });
  });
});

describe('Kalikkam wallets', () => {
  it('stores keys encrypted, and only the secret opens them', () => {
    const w = newPlayerWallet();
    expect(w.sealed).not.toMatch(/^0x/);
    expect(privateKeyToAccount(openKey(w.sealed)).address).toBe(w.address);
    process.env.WALLET_SECRET = 'other-secret';
    expect(() => openKey(w.sealed)).toThrow();
    process.env.WALLET_SECRET = 'test-secret';
  });
});

describe('a paid entry game', () => {
  function entryRoom() {
    const room = new Room('PAID', {
      game: 'zombies',
      title: 'paid',
      config: normalizeConfig('zombies', {}),
      boundary: { type: 'polygon', points: circleToPolygon({ lat: 9.98, lng: 76.27 }, 120, 12) },
      entryPool: '0x0000000000000000000000000000000000000001',
    });
    const ps = ['A', 'B', 'C'].map((name) => room.addPlayer({ name }));
    return { room, ps };
  }

  it('starts with whoever paid; players who did not sit the round out', () => {
    const { room, ps } = entryRoom();
    const d = room.addPlayer({ name: 'D' });
    room.markPaid(ps[0], '0xa', '0x1');
    room.markPaid(ps[1], '0xb', '0x2');
    expect(() => room.start()).toThrow(/at least 3 players who paid/);
    room.markPaid(ps[2], '0xc', '0x3');
    room.start();
    expect([d.plays, d.status, d.role]).toEqual([false, 'spectating', null]);
    expect(ps.every((p) => p.role !== null)).toBe(true);
    expect(room.viewFor(ps[0]).entry).toMatchObject({ pot: 3 * ENTRY_USDC, myPaid: true });
    // Joining after the start: entries are closed, so they watch too.
    const late = room.addPlayer({ name: 'Late' });
    expect([late.plays, late.sitOut]).toEqual([false, true]);
    // Back in for the rematch.
    room.finish('host');
    room.resetToLobby();
    expect([d.plays, d.sitOut]).toEqual([true, false]);
  });

  it('a rematch is a new round: a new pot id, and everyone pays again', () => {
    const { room, ps } = entryRoom();
    const first = room.entry!.id;
    expect(first).toBe(roundId('PAID', room.createdAt, 0));
    for (const p of ps) room.markPaid(p, '0x' + p.name, '0x1');
    room.start();
    room.finish('host');
    room.resetToLobby();
    expect(room.entry!.id).not.toBe(first);
    expect(room.entry!.paid.size).toBe(0);
  });
});
