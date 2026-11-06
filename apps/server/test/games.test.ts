import { describe, expect, it } from 'vitest';
import { circleToPolygon, normalizeConfig, offset, zombieCount, zombieRange, type Boundary, type GameId } from '@kalikkam/shared';
import { Room, type Player } from '../src/room.ts';
import { vestQr } from '../src/vestcode.ts';

const MARINE_DRIVE = { lat: 9.9822, lng: 76.2763 };
const boundary: Boundary = { type: 'polygon', points: circleToPolygon(MARINE_DRIVE, 120, 12) };

function makeRoom(game: GameId, config: Record<string, number> = {}, speed = 1) {
  let t = 1_700_000_000_000;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const ended: unknown[] = [];
  const room = new Room(
    'TEST',
    { game, title: 'test', config: normalizeConfig(game, config), boundary, sim: speed > 1, speed },
    { onEnd: (_r, res) => ended.push(res) },
    clock.now,
  );
  return { room, clock, ended };
}

/** Advance the room in 250 ms ticks, like the server loop. */
function run(room: Room, clock: { advance: (ms: number) => void }, secs: number) {
  for (let i = 0; i < secs * 4 && room.phase !== 'ended'; i++) {
    clock.advance(250);
    room.tick();
  }
}

/** Seeded random numbers (mulberry32), so a deal can be replayed. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The dealt teams, in join order. */
function teams(room: Room) {
  const players = room.activePlayers();
  return { zombies: players.filter((p) => p.role === 'zombie'), survivors: players.filter((p) => p.role === 'survivor') };
}

/** Put `p` `north` metres north of Marine Drive (no smoothing on a first fix). */
function place(room: Room, p: Player, north: number) {
  const at = offset(MARINE_DRIVE, Math.abs(north), north >= 0 ? 0 : 180);
  room.updatePos(p, at.lat, at.lng, 5);
}

describe('room lifecycle', () => {
  it('refuses to start without enough players', () => {
    const { room } = makeRoom('zombies');
    room.addPlayer({ name: 'Host', isHost: true, plays: true });
    expect(() => room.start()).toThrow(/at least/);
  });

  it('deals the teams when the countdown starts, not in the lobby', () => {
    const { room, clock } = makeRoom('zombies');
    const players = ['A', 'B', 'C'].map((name) => room.addPlayer({ name }));
    expect(players.map((p) => p.role)).toEqual([null, null, null]);
    room.start();
    // Dealt now, so every phone can show its team during the countdown.
    const { zombies, survivors } = teams(room);
    expect([zombies.length, survivors.length]).toEqual([1, 2]);
    for (const p of players) expect(p.team).toBe(p.role);
    // Someone joining during the countdown missed the deal: they start as a zombie.
    expect(room.addPlayer({ name: 'D' }).role).toBe('zombie');
    run(room, clock, 6);
    expect(room.phase).toBe('live');
    expect(teams(room).zombies.length).toBe(2);
  });

  it('rejects duplicate vest numbers', () => {
    const { room } = makeRoom('zombies');
    room.addPlayer({ name: 'A', vest: '123' });
    expect(() => room.addPlayer({ name: 'B', vest: '123' })).toThrow(/taken/);
  });

  it('pause freezes the game clock', () => {
    const { room, clock } = makeRoom('zombies', { durationSecs: 300 });
    const host = room.addPlayer({ name: 'Host', isHost: true, plays: false });
    room.addBots(6);
    room.start();
    run(room, clock, 6);
    expect(room.phase).toBe('live');
    const endsAt = room.endsAt!;
    const before = room.now();
    room.handle(host, { t: 'host', cmd: 'pause' });
    clock.advance(60_000);
    expect(room.now()).toBe(before);
    room.handle(host, { t: 'host', cmd: 'resume' });
    expect(room.endsAt).toBe(endsAt);
  });
});

describe('simulation fast-forward', () => {
  it('zombies: a bots-only round at 4x runs on the sped-up clock', () => {
    const { room, clock, ended } = makeRoom('zombies', { durationSecs: 300 }, 4);
    room.addPlayer({ name: 'Director', isHost: true, plays: false });
    room.addBots(20);
    room.start();
    run(room, clock, 6);
    expect(room.phase).toBe('live');
    // Wall-clock times sent to phones line up with the sped-up game clock.
    const left = room.wall(room.endsAt)! - clock.now();
    const gameLeft = room.endsAt! - room.now();
    expect(Math.abs(left * 4 - gameLeft)).toBeLessThan(10);
    // It ends by the time a quarter of the round has passed on the wall clock (sooner if everyone is infected).
    run(room, clock, 300 / 4 + 2);
    expect(room.phase).toBe('ended');
    expect(ended).toHaveLength(1);
  });
});

describe('random teams', () => {
  it('deals about 40 zombies in 100, never the same split every time', () => {
    const rand = seeded(7);
    const deals = Array.from({ length: 2000 }, () => zombieCount(100, rand));
    expect(Math.min(...deals)).toBeGreaterThanOrEqual(35);
    expect(Math.max(...deals)).toBeLessThanOrEqual(45);
    const mean = deals.reduce((a, b) => a + b, 0) / deals.length;
    expect(mean).toBeGreaterThan(39);
    expect(mean).toBeLessThan(41);
    expect(new Set(deals).size).toBeGreaterThanOrEqual(10);
  });

  it('always deals at least 1 zombie and fewer zombies than survivors', () => {
    const rand = seeded(42);
    for (let n = 3; n <= 200; n++) {
      const [lo, hi] = zombieRange(n);
      for (let i = 0; i < 50; i++) {
        const k = zombieCount(n, rand);
        expect(k).toBeGreaterThanOrEqual(Math.max(1, lo));
        expect(k).toBeLessThanOrEqual(hi);
        expect(k).toBeLessThan(n - k);
      }
    }
    expect(zombieRange(10)).toEqual([3, 4]);
    expect(zombieRange(100)).toEqual([35, 45]);
  });

  it('small games vary too', () => {
    const rand = seeded(3);
    expect(new Set(Array.from({ length: 200 }, () => zombieCount(10, rand)))).toEqual(new Set([3, 4]));
  });
});

describe('zombies', () => {
  /** A zombie's camera sees `vest`'s QR for `secs`, one frame per 250 ms tick. */
  function holdScan(room: Room, clock: { advance: (ms: number) => void }, z: Player, vest: string, secs: number) {
    for (let i = 0; i < secs * 4 && room.phase === 'live'; i++) {
      room.handle(z, { t: 'scan', qr: vestQr(vest) });
      clock.advance(250);
      room.tick();
    }
  }

  function setup(config: Record<string, number> = {}) {
    const r = makeRoom('zombies', { zombieDelaySecs: 0, scanSecs: 5, ...config });
    const host = r.room.addPlayer({ name: 'Host', isHost: true, plays: false });
    for (const [name, vest] of [['Zed', '111'], ['Anu', '222'], ['Bobby', '333']]) r.room.addPlayer({ name, vest });
    r.room.start();
    run(r.room, r.clock, 6);
    // 3 players always deal 1 zombie and 2 survivors; who gets which is random.
    const {
      zombies: [z],
      survivors: [a, b],
    } = teams(r.room);
    for (const p of [z, a, b]) r.room.updatePos(p, MARINE_DRIVE.lat, MARINE_DRIVE.lng, 5);
    return { ...r, host, z, a, b };
  }

  it('the host can neither infect nor cure anyone', () => {
    const { room, host, z, a } = setup();
    // The old host command, sent by hand: it no longer exists, so nothing changes.
    room.handle(host, { t: 'host', cmd: 'setRole', target: a.id, role: 'zombie' } as never);
    room.handle(host, { t: 'host', cmd: 'setRole', target: z.id, role: 'survivor' } as never);
    expect([z.role, a.role]).toEqual(['zombie', 'survivor']);
  });

  it('late joiners start as zombies', () => {
    const { room } = setup();
    const late = room.addPlayer({ name: 'Late Leela' });
    expect([late.team, late.role]).toEqual(['zombie', 'zombie']);
  });

  it('infects only after the QR is held for the full scan time', () => {
    const { room, clock, z, a } = setup();
    holdScan(room, clock, z, a.vest, 3);
    expect(a.role).toBe('survivor');
    expect(room.viewFor(a).hud).toMatchObject({ beingScanned: { zombies: 1 } });
    expect(room.viewFor(z).hud).toMatchObject({ scanning: { name: a.name } });
    holdScan(room, clock, z, a.vest, 2.5);
    expect(a.role).toBe('zombie');
    expect(z.stats.infections).toBe(1);
  });

  it('resets the scan when the survivor gets away', () => {
    const { room, clock, z, a } = setup();
    holdScan(room, clock, z, a.vest, 4);
    clock.advance(2000); // QR out of the camera for 2 s
    room.tick();
    expect(room.viewFor(a).hud).toMatchObject({ beingScanned: null });
    holdScan(room, clock, z, a.vest, 4);
    expect(a.role).toBe('survivor');
  });

  it('rejects fake QRs, typed numbers and far-away scans', () => {
    const { room, clock, z, a, b } = setup();
    holdScan(room, clock, z, '999', 6); // genuine-looking QR, nobody wears 999
    for (let i = 0; i < 24; i++) {
      room.handle(z, { t: 'scan', qr: `KLK1:${a.vest}:AAAAAAAA` }); // forged signature
      room.handle(z, { t: 'scan', qr: a.vest }); // just the number
      clock.advance(250);
      room.tick();
    }
    expect(a.role).toBe('survivor');
    clock.advance(6000); // past GPS smoothing, then fresh fixes far apart
    room.updatePos(z, MARINE_DRIVE.lat, MARINE_DRIVE.lng, 5);
    room.updatePos(b, MARINE_DRIVE.lat + 0.0015, MARINE_DRIVE.lng, 5); // ~165 m away: scanning a photo of their QR
    holdScan(room, clock, z, b.vest, 6);
    expect(b.role).toBe('survivor');
  });

  it('survivors win when time runs out: only the ones still standing', () => {
    const { room, clock, z, a, b } = setup({ durationSecs: 300 });
    holdScan(room, clock, z, a.vest, 5.5);
    expect(a.role).toBe('zombie');
    run(room, clock, 300);
    expect(room.phase).toBe('ended');
    const res = room.result!;
    expect(res.headline).toMatch(/survivors win/i);
    const won = Object.fromEntries(res.rows.map((r) => [r.id, r.won]));
    expect(won).toEqual({ [z.id]: false, [a.id]: false, [b.id]: true });
    expect(res.rows.find((r) => r.id === a.id)).toMatchObject({ role: 'survivor', status: 'infected' });
    expect(res.rows[0].id).toBe(b.id);
  });

  it('zombies win when everyone is infected: the players who started as zombies', () => {
    const { room, clock, z, a, b } = setup();
    holdScan(room, clock, z, a.vest, 5.5);
    // The last survivor is caught without a scan and types the zombie's catch code.
    room.handle(b, { t: 'act', action: 'gotTagged', code: z.catchCode });
    expect(room.phase).toBe('ended');
    const res = room.result!;
    expect(res.headline).toMatch(/zombies win/i);
    expect(res.rows.filter((r) => r.won).map((r) => r.id)).toEqual([z.id]);
    // The catch code credits that zombie, so the second survivor counts for them too.
    expect(res.lines).toContain(`🧟 Top zombie: ${z.name}, 50 points.`);
    expect(res.rows.find((r) => r.id === a.id)).toMatchObject({ status: 'infected', won: false });
  });

  it('a rematch clears the teams and deals them again', () => {
    const { room, clock, host, z, a, b } = setup();
    holdScan(room, clock, z, a.vest, 5.5);
    room.handle(host, { t: 'host', cmd: 'end' });
    room.handle(host, { t: 'host', cmd: 'rematch' });
    expect(room.phase).toBe('lobby');
    expect([z.role, a.role, b.role]).toEqual([null, null, null]);
    room.start();
    run(room, clock, 6);
    const { zombies, survivors } = teams(room);
    expect([zombies.length, survivors.length]).toEqual([1, 2]);
  });

  it('scores survivors 10 a minute and zombies 25 per infection, on separate boards', () => {
    const { room, clock, z, a, b } = setup({ durationSecs: 300 });
    run(room, clock, 54); // 55 s into the round
    holdScan(room, clock, z, a.vest, 5.5); // infected at exactly 60 s
    expect(a.role).toBe('zombie');
    // Live points on the HUD.
    const bHud = room.viewFor(b).hud;
    expect(bHud.kind === 'zombies' && bHud.points).toEqual({ survivor: 10, zombie: null });
    const zHud = room.viewFor(z).hud;
    expect(zHud.kind === 'zombies' && zHud.points).toEqual({ survivor: null, zombie: 25 });
    run(room, clock, 300);
    const res = room.result!;
    const pts = Object.fromEntries(res.rows.map((r) => [r.id, r.points]));
    expect(pts[z.id]).toEqual({ survivor: null, zombie: 25 });
    // Keeps the 10 survivor points from the minute alive, and scores as a zombie from then on.
    expect(pts[a.id]).toEqual({ survivor: 10, zombie: 0 });
    expect(pts[b.id]).toEqual({ survivor: 50, zombie: null });
    expect(res.lines).toContain(`🏃 Top survivor: ${b.name}, 50 points.`);
    expect(res.lines).toContain(`🧟 Top zombie: ${z.name}, 25 points.`);
  });

  it('"I got infected" credits the zombie whose catch code you type', () => {
    const { room, clock, z, a, b } = setup();
    holdScan(room, clock, z, a.vest, 5.5); // a is a zombie now, with a code of their own
    expect(room.viewFor(a).me.catchCode).toBe(a.catchCode);
    expect(room.viewFor(b).me.catchCode).toBeNull(); // survivors have no code to give
    // Codes are private: no other player's view carries them (only the host's roster does).
    expect(JSON.stringify(room.viewFor(b))).not.toContain(`"${z.catchCode}"`);
    room.handle(b, { t: 'act', action: 'gotTagged', code: a.catchCode });
    expect(b.role).toBe('zombie');
    expect([z.stats.infections, a.stats.infections]).toEqual([1, 1]);
    expect(room.journal.filter((e) => e.kind === 'infect').map((e) => [e.by, e.how])).toEqual([
      [z.id, 'scan'],
      [a.id, 'code'],
    ]);
  });

  it('a wrong code is refused, and too many wrong codes make you wait', () => {
    const { room, z, a } = setup();
    const wrong = z.catchCode === '1234' ? '4321' : '1234';
    expect(() => room.handle(a, { t: 'act', action: 'gotTagged', code: wrong })).toThrow(/No zombie has code/);
    expect(() => room.handle(a, { t: 'act', action: 'gotTagged', code: '12' })).toThrow(/4 digits/);
    expect(() => room.handle(a, { t: 'act', action: 'gotTagged', code: wrong })).toThrow(/No zombie has code/);
    expect(() => room.handle(a, { t: 'act', action: 'gotTagged', code: wrong })).toThrow(/wait 30 s/);
    // Even the right code has to wait now.
    expect(() => room.handle(a, { t: 'act', action: 'gotTagged', code: z.catchCode })).toThrow(/Wait/);
    expect(a.role).toBe('survivor');
  });

  it("\"I don't know the code\" still turns you, with no credit", () => {
    const { room, z, a } = setup();
    room.handle(a, { t: 'act', action: 'gotTagged', code: '' });
    expect(a.role).toBe('zombie');
    expect(z.stats.infections ?? 0).toBe(0);
    expect(room.journal.find((e) => e.kind === 'infect')).toMatchObject({ p: a.id, by: null, how: 'unknown' });
  });

  it('every player has a unique code, dealt again each round', () => {
    const { room } = makeRoom('zombies');
    const ps = Array.from({ length: 150 }, (_, i) => room.addPlayer({ name: `P${i}` }));
    expect(new Set(ps.map((p) => p.catchCode)).size).toBe(150);
    for (const p of ps) expect(p.catchCode).toMatch(/^\d{4}$/);
    const before = ps.map((p) => p.catchCode).join();
    room.start();
    expect(ps.map((p) => p.catchCode).join()).not.toBe(before);
    expect(new Set(ps.map((p) => p.catchCode)).size).toBe(150);
  });

  it('a tie shares the high score', () => {
    const { room, clock, a, b } = setup({ durationSecs: 300 });
    run(room, clock, 300); // nobody gets infected: both survivors last the full 5 minutes
    // Names come in join order, and the survivors were picked from the players in join order.
    expect(room.result!.lines).toContain(`🏃 Top survivors: ${a.name} and ${b.name}, 50 points.`);
    // Nobody infected anyone, so there's no top zombie.
    expect(room.result!.lines.join(' ')).not.toMatch(/Top zombie/);
  });

  it('plays to completion with bots, including infections by scanning', () => {
    const { room, clock, ended } = makeRoom('zombies', { durationSecs: 600, zombieDelaySecs: 30 });
    room.addPlayer({ name: 'Host', isHost: true, plays: false });
    room.addBots(15);
    room.start();
    run(room, clock, 700);
    expect(room.phase).toBe('ended');
    expect(ended).toHaveLength(1);
    const res = room.result!;
    expect(res.rows.length).toBe(15);
    expect(res.rows.some((r) => (r.stats.infections ?? 0) > 0)).toBe(true);
  });
});

describe('play area', () => {
  function outRoom() {
    const r = makeRoom('zombies', { zombieDelaySecs: 0, durationSecs: 600 });
    const host = r.room.addPlayer({ name: 'Host', isHost: true, plays: false });
    for (const name of ['Zed', 'Anu', 'Bobby']) r.room.addPlayer({ name });
    r.room.start();
    run(r.room, r.clock, 6);
    const {
      zombies: [z],
      survivors: [a, b],
    } = teams(r.room);
    for (const p of [z, a, b]) place(r.room, p, 0);
    // Every second, every phone sends a fix (like the app does): `outside` players 200 m north, past the 120 m ring.
    const tick = (secs: number, outside: Player[] = []) => {
      for (let i = 0; i < secs; i++) {
        r.clock.advance(1000);
        for (const p of [z, a, b]) if (p.status !== 'eliminated') place(r.room, p, outside.includes(p) ? 200 : 0);
        r.room.tick();
      }
    };
    return { ...r, host, z, a, b, tick };
  }

  it('warns you with a countdown, then eliminates you after 30 s outside', () => {
    const { room, a, tick } = outRoom();
    // Fixes are smoothed, so the jump outside registers on the second fix (the clock starts there).
    tick(4, [a]);
    expect(room.viewFor(a).me.outOfBounds).toBe(true);
    expect(room.viewFor(a).me.outDeadline).not.toBeNull();
    tick(27, [a]); // 29 s since the clock started
    expect(a.status).toBe('active');
    tick(3, [a]);
    expect(a.status).toBe('eliminated');
    expect(room.viewFor(a).me.actions).toEqual([]);
    const hud = room.viewFor(a).hud;
    expect(hud.kind === 'zombies' && [hud.survivors, hud.radar]).toEqual([1, null]);
  });

  it('coming back in time resets the clock', () => {
    const { room, a, tick } = outRoom();
    tick(20, [a]);
    tick(1);
    expect(room.viewFor(a).me.outOfBounds).toBe(false);
    tick(20, [a]);
    expect(a.status).toBe('active');
    expect(room.journal.filter((e) => e.kind === 'out' && e.p === a.id).map((e) => e.outcome)).toEqual(['warned', 'back', 'warned']);
  });

  it("a fuzzy GPS fix outside doesn't start the clock", () => {
    const { room, clock, a } = outRoom();
    const far = offset(MARINE_DRIVE, 200, 0);
    for (let i = 0; i < 40; i++) {
      clock.advance(1000);
      room.updatePos(a, far.lat, far.lng, 45); // ±45 m: could really be inside
      room.tick();
    }
    expect([a.status, room.viewFor(a).me.outOfBounds]).toEqual(['active', false]);
  });

  it('a pause stops the out-of-area clock', () => {
    const { room, clock, host, a, tick } = outRoom();
    tick(20, [a]);
    room.handle(host, { t: 'host', cmd: 'pause' });
    clock.advance(120_000);
    room.handle(host, { t: 'host', cmd: 'resume' });
    tick(5, [a]);
    expect(a.status).toBe('active');
  });

  it('an eliminated player scores nothing and is listed as out', () => {
    const { room, host, a, b, tick } = outRoom();
    tick(35, [a]);
    expect(a.status).toBe('eliminated');
    room.handle(host, { t: 'host', cmd: 'end', reason: 'testing' });
    const res = room.result!;
    expect(res.rows.find((r) => r.id === a.id)).toMatchObject({ status: 'eliminated', won: false, points: { survivor: null, zombie: null } });
    expect(res.rows.find((r) => r.id === b.id)!.points.survivor).toBeGreaterThan(0);
    expect(res.lines).toContain(`🚫 Out for leaving the play area: ${a.name}.`);
    expect(res.lines).toContain('Game ended early by the host (we were testing).');
  });

  it('the round ends when every zombie has left the play area', () => {
    const { room, z, tick } = outRoom();
    tick(35, [z]);
    expect(room.phase).toBe('ended');
    expect(room.result!.headline).toMatch(/survivors win/i);
    expect(room.result!.lines).toContain('Every zombie left the play area.');
  });
});

describe('game log', () => {
  it('records the start, scans, credits, host actions and GPS health, but no locations', () => {
    const r = makeRoom('zombies', { zombieDelaySecs: 0, scanSecs: 5 });
    const host = r.room.addPlayer({ name: 'Host', isHost: true, plays: false });
    for (const [name, vest] of [['Zed', '111'], ['Anu', '222'], ['Bobby', '333']]) r.room.addPlayer({ name, vest });
    r.room.start();
    run(r.room, r.clock, 6);
    const {
      zombies: [z],
      survivors: [a],
    } = teams(r.room);
    for (const p of r.room.activePlayers()) place(r.room, p, 0);
    const scanFor = (secs: number) => {
      for (let i = 0; i < secs * 4; i++) {
        r.room.handle(z, { t: 'scan', qr: vestQr(a.vest) });
        r.clock.advance(250);
        r.room.tick();
      }
    };
    scanFor(2); // a scan that breaks…
    r.clock.advance(2000);
    r.room.tick();
    scanFor(5.5); // …then one that holds
    r.room.handle(host, { t: 'host', cmd: 'pause' });
    r.room.handle(host, { t: 'host', cmd: 'resume' });
    r.clock.advance(30_000); // nobody sends a fix for 30 s
    r.room.handle(host, { t: 'host', cmd: 'end', reason: 'broken' });
    const log = r.room.journal;
    expect(log[0]).toMatchObject({ kind: 'start' });
    expect(log[0].players).toHaveLength(3);
    expect(log.filter((e) => e.kind === 'scan').map((e) => e.outcome)).toEqual(['started', 'broken', 'started']);
    expect(log.find((e) => e.kind === 'infect')).toMatchObject({ p: a.id, by: z.id, how: 'scan' });
    expect(log.filter((e) => e.kind === 'host').map((e) => e.action)).toEqual(['pause', 'resume', 'end']);
    expect(log.find((e) => e.kind === 'host' && e.action === 'end')).toMatchObject({ reason: 'broken' });
    const gps = log.filter((e) => e.kind === 'gps');
    expect(gps).toHaveLength(3);
    for (const g of gps) expect(g).toMatchObject({ gaps: 1, avgAcc: 5 });
    expect(log.at(-1)).toMatchObject({ kind: 'end', reason: 'host', hostReason: 'broken' });
    // No coordinates anywhere in the log.
    expect(JSON.stringify(log)).not.toMatch(/lat|lng|9\.98|76\.27/);
  });
});

describe('views', () => {
  function radarRoom(config: Record<string, number> = {}) {
    const r = makeRoom('zombies', { zombieDelaySecs: 0, ...config });
    const host = r.room.addPlayer({ name: 'Host', isHost: true, plays: false });
    for (const [name, vest] of [['Zed', '100'], ['Nearby Neha', '200'], ['Faraway Fazil', '300']]) r.room.addPlayer({ name, vest });
    r.room.start();
    run(r.room, r.clock, 6);
    const {
      zombies: [z],
      survivors: [near, far],
    } = teams(r.room);
    place(r.room, z, 0);
    place(r.room, near, 6); // 6 m north of the zombie
    place(r.room, far, 30); // 30 m north: off a 10 m radar
    return { ...r, host, z, near, far };
  }

  it('radar shows only players within range, by team, with no names or ids', () => {
    const { room, z, near, far } = radarRoom();
    const hud = room.viewFor(z).hud;
    if (hud.kind !== 'zombies' || !hud.radar) throw new Error('no radar');
    expect(hud.radar.range).toBe(10);
    expect(hud.radar.blips).toHaveLength(1);
    expect(hud.radar.blips[0]).toMatchObject({ team: 'survivor', e: 0, n: 6 });
    const radarJson = JSON.stringify(hud.radar);
    for (const p of [near, far]) {
      expect(radarJson).not.toContain(p.id);
      expect(radarJson).not.toContain(p.name);
    }
    // Survivors see the zombie on their radar too, coloured by team.
    const sHud = room.viewFor(near).hud;
    expect(sHud.kind === 'zombies' && sHud.radar?.blips.map((b) => b.team)).toEqual(['zombie']);
  });

  it('respects a wider radar range set by the host', () => {
    const { room, z } = radarRoom({ radarRange: 40 });
    const hud = room.viewFor(z).hud;
    expect(hud.kind === 'zombies' && hud.radar?.blips).toHaveLength(2);
  });

  it('players only see themselves on the map; the referee sees everyone', () => {
    const { room, host, z, near } = radarRoom();
    const zv = room.viewFor(z);
    expect(zv.markers.filter((m) => m.kind === 'player').map((m) => m.id)).toEqual([`p:${z.id}`]);
    expect(zv.players.find((p) => p.id === near.id)!.vest).toBeUndefined();
    expect(JSON.stringify(zv)).not.toContain(`"${near.vest}"`);
    expect(room.viewFor(host).markers.filter((m) => m.kind === 'player')).toHaveLength(3);
  });
});
