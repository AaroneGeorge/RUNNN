import { describe, expect, it } from 'vitest';
import { bibQr } from '../src/bibcode.ts';
import { GameError } from '../src/games/util.ts';
import { AREA, CENTER, away, liveRoom, makeRoom } from './helpers.ts';

describe('lobby and dealing', () => {
  it('needs enough players to start', () => {
    const { room } = makeRoom();
    const host = room.join({ organiserKey: room.organiserKey, name: 'Org' }).player;
    room.join({ name: 'A' });
    room.join({ name: 'B' });
    expect(() => room.hostCmd(host, { cmd: 'start' })).toThrow(GameError);
  });

  it('only lets the organiser run host commands', () => {
    const { room } = makeRoom();
    const p = room.join({ name: 'A' }).player;
    expect(() => room.hostCmd(p, { cmd: 'start' })).toThrow(/organiser/);
  });

  it('rejects taken and malformed bibs', () => {
    const { room } = makeRoom();
    room.join({ name: 'A', bib: '101' });
    expect(() => room.join({ name: 'B', bib: '101' })).toThrow(/taken/);
    expect(() => room.join({ name: 'C', bib: '12' })).toThrow(/3 digits/);
  });

  it('resumes a player with id + secret', () => {
    const { room } = makeRoom();
    const a = room.join({ name: 'A' }).player;
    const again = room.join({ playerId: a.id, secret: a.secret, name: 'whatever' });
    expect(again.resumed).toBe(true);
    expect(again.player).toBe(a);
    expect(room.join({ playerId: a.id, secret: 'nope', name: 'Imposter' }).player).not.toBe(a);
  });

  it('deals sides and goes live after the countdown', () => {
    const { room, hunters, runners, players } = liveRoom(8);
    expect(room.phase).toBe('live');
    expect(hunters.length).toBeGreaterThanOrEqual(1);
    expect(hunters.length).toBeLessThan(runners.length);
    expect(hunters.length + runners.length).toBe(players.length);
  });
});

describe('scanning', () => {
  it('converts a runner after a held scan', () => {
    const { room, hunters, runners, advance, refresh } = liveRoom(4, { holdSecs: 5 });
    const h = hunters[0];
    const r = runners[0];
    const qr = bibQr(r.bib);
    for (let i = 0; i < 12; i++) {
      room.scan(h, qr);
      advance(500);
      refresh();
    }
    expect(r.role).toBe('hunter');
    expect(r.status).toBe('converted');
    expect(h.stats.conversions).toBe(1);
    expect(room.journal.some((e) => e.kind === 'convert')).toBe(true);
  });

  it('breaks the scan when the camera loses the bib', () => {
    const { room, hunters, runners, advance, socks } = liveRoom(4, { holdSecs: 5 });
    const h = hunters[0];
    const r = runners[0];
    room.scan(h, bibQr(r.bib));
    advance(2000);
    expect(room.state.scans[h.id]).toBeUndefined();
    expect(socks.get(r.id)!.toasts().some((t) => t.includes('got away'))).toBe(true);
    expect(r.role).toBe('runner');
  });

  it('ignores forged and unknown QRs', () => {
    const { room, hunters, runners, advance } = liveRoom(4);
    const h = hunters[0];
    const r = runners[0];
    for (let i = 0; i < 30; i++) {
      room.scan(h, `RN1:${r.bib}:AAAAAAAA`);
      room.scan(h, r.bib);
      advance(500);
    }
    expect(r.role).toBe('runner');
  });

  it('will not scan before the release', () => {
    const { room, hunters, runners, advance } = liveRoom(4, { releaseDelaySecs: 60 });
    for (let i = 0; i < 14; i++) {
      room.scan(hunters[0], bibQr(runners[0].bib));
      advance(500);
    }
    expect(runners[0].role).toBe('runner');
  });

  it('rejects a tag that is impossible by GPS', () => {
    const { room, hunters, runners, advance, clock } = liveRoom(4, { tagMaxDistance: 20 });
    const r = runners[0];
    const far = away(150, 90);
    clock.t += 10_000;
    room.updatePos(r, far.lat, far.lng, 5);
    room.updatePos(r, far.lat, far.lng, 5);
    room.updatePos(hunters[0], CENTER.lat, CENTER.lng, 5);
    for (let i = 0; i < 14; i++) {
      room.scan(hunters[0], bibQr(r.bib));
      advance(500);
    }
    expect(r.role).toBe('runner');
  });
});

describe('claim codes', () => {
  it('credits the hunter whose code the runner types', () => {
    const { room, hunters, runners } = liveRoom(4);
    room.act(runners[0], 'caught', hunters[0].claimCode);
    expect(runners[0].role).toBe('hunter');
    expect(hunters[0].stats.conversions).toBe(1);
  });

  it('locks out guessing after three wrong codes', () => {
    const { room, runners, hunters } = liveRoom(4);
    const wrong = hunters.some((h) => h.claimCode === '0000') ? '0001' : '0000';
    for (let i = 0; i < 2; i++) expect(() => room.act(runners[0], 'caught', wrong)).toThrow(/No hunter/);
    expect(() => room.act(runners[0], 'caught', wrong)).toThrow(/wait 30 s/);
    expect(() => room.act(runners[0], 'caught', hunters[0].claimCode)).toThrow(/Wait a moment/);
  });

  it('re-validates actions on the server', () => {
    const { room, hunters } = liveRoom(4);
    expect(() => room.act(hunters[0], 'caught')).toThrow(/cannot do that/);
  });
});

describe('boundary', () => {
  it('eliminates after the grace period only with a fresh fix', () => {
    const { room, runners, advance } = liveRoom(4);
    const r = runners[0];
    const out = away(260);
    room.updatePos(r, out.lat, out.lng, 8);
    room.updatePos(r, out.lat, out.lng, 8);
    expect(r.outSince).not.toBeNull();
    // Phone goes quiet outside: not proof they stayed out.
    advance(31_000);
    expect(r.status).toBe('active');
    room.updatePos(r, out.lat, out.lng, 8);
    advance(250);
    expect(r.status).toBe('eliminated');
  });

  it('does not start the timer on a fuzzy fix', () => {
    const { room, runners } = liveRoom(4);
    const r = runners[0];
    const out = away(230);
    r.pos = null;
    room.updatePos(r, out.lat, out.lng, 45);
    expect(r.outSince).toBeNull();
    expect(AREA.type).toBe('circle');
  });
});

describe('clocks and ending', () => {
  it('freezes timers while paused', () => {
    const { room, host, advance } = liveRoom(4);
    const left = room.endsAt! - room.now();
    room.hostCmd(host, { cmd: 'pause' });
    advance(60_000);
    expect(room.endsAt! - room.now()).toBe(left);
    room.hostCmd(host, { cmd: 'resume' });
    advance(1000);
    expect(room.endsAt! - room.now()).toBe(left - 1000);
  });

  it('ends when every runner is caught, and hunters win', () => {
    const { room, hunters, runners } = liveRoom(5);
    for (const r of runners) room.act(r, 'caught', hunters[0].claimCode);
    room.tick();
    expect(room.phase).toBe('ended');
    expect(room.result!.reason).toBe('allCaught');
    expect(room.result!.winner).toBe('hunter');
    const h = room.result!.rows.find((x) => x.playerId === hunters[0].id)!;
    expect(h.won).toBe(true);
    expect(h.points.hunter).toBe(25 * runners.length);
  });

  it('ends on time and runners score per minute', () => {
    const { room, advance, refresh } = liveRoom(4, { durationSecs: 300 });
    for (let i = 0; i < 31; i++) {
      advance(10_000, 1000);
      refresh();
    }
    expect(room.phase).toBe('ended');
    expect(room.result!.reason).toBe('time');
    expect(room.result!.top.runner!.points).toBe(50);
  });

  it('rematch resets everyone and re-rolls claim codes', () => {
    const { room, host, players, hunters, runners } = liveRoom(4);
    const before = players.map((p) => p.claimCode).join();
    for (const r of runners) room.act(r, 'caught', hunters[0].claimCode);
    room.tick();
    room.hostCmd(host, { cmd: 'rematch' });
    expect(room.phase).toBe('lobby');
    expect(players.every((p) => p.role === null && p.status === 'active')).toBe(true);
    expect(players.map((p) => p.claimCode).join()).not.toBe(before);
  });
});

describe('views', () => {
  it('hides other players during a live round', () => {
    const { room, runners, hunters } = liveRoom(6);
    const v = room.viewFor(runners[0]);
    expect(v.markers.every((m) => m.me)).toBe(true);
    for (const p of v.players.filter((x) => x.id !== runners[0].id)) {
      expect(p.claimCode).toBeUndefined();
      expect(p.bib).toBeUndefined();
      if (p.plays) expect(p.role).toBeNull();
    }
    const blips = v.hud.radar!.blips;
    expect(blips.length).toBeGreaterThan(0);
    for (const b of blips) {
      expect(Object.keys(b).sort()).toEqual(['e', 'key', 'n', 'team']);
      expect(room.players.has(b.key)).toBe(false);
    }
    expect(JSON.stringify(v)).not.toContain(hunters[0].claimCode);
  });

  it('shows the referee everything', () => {
    const { room, host, players } = liveRoom(4);
    const v = room.viewFor(host);
    expect(v.markers.length).toBe(players.length);
    expect(v.players.find((p) => p.id === players[0].id)!.claimCode).toBe(players[0].claimCode);
  });
});

describe('bots', () => {
  it('plays a full simulated round on its own', () => {
    const { room, advance } = makeRoom({ durationSecs: 300, radarRange: 30 }, { sim: true });
    const host = room.join({ organiserKey: room.organiserKey, name: 'Org' }).player;
    room.addBots(12);
    room.hostCmd(host, { cmd: 'speed', speed: 8 });
    room.hostCmd(host, { cmd: 'start' });
    advance(60_000, 250);
    expect(room.phase).toBe('ended');
    expect(room.result!.rows.length).toBe(12);
  });
});
