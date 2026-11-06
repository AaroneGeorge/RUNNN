import { normalizeConfig, offset, type Boundary, type ServerMsg } from '@runnn/shared';
import { Room, type Player, type Sock } from '../src/room.ts';

export const CENTER = { lat: 51.5, lng: -0.12 };
export const AREA: Boundary = { type: 'circle', center: CENTER, radius: 200 };

export class FakeSock implements Sock {
  readyState = 1;
  msgs: ServerMsg[] = [];
  send(s: string) {
    this.msgs.push(JSON.parse(s));
  }
  close() {
    this.readyState = 3;
  }
  toasts() {
    return this.msgs.filter((m): m is Extract<ServerMsg, { t: 'toast' }> => m.t === 'toast').map((m) => m.text);
  }
}

export function makeRoom(cfg: Record<string, number> = {}, opts: { sim?: boolean } = {}) {
  const clock = { t: 1_700_000_000_000 };
  const room = new Room(
    'TEST',
    { game: 'chase', title: 'Test', boundary: AREA, config: normalizeConfig('chase', { releaseDelaySecs: 0, ...cfg }), sim: opts.sim },
    {},
    () => clock.t,
  );
  const advance = (ms: number, step = 250) => {
    for (let left = ms; left > 0; left -= step) {
      clock.t += Math.min(step, left);
      room.tick();
    }
  };
  return { room, clock, advance };
}

/** A room with a non-playing organiser and `n` players standing together, already live. */
export function liveRoom(n = 4, cfg: Record<string, number> = {}) {
  const env = makeRoom(cfg);
  const { room, advance } = env;
  const host = room.join({ organiserKey: room.organiserKey, name: 'Org' }).player;
  const socks = new Map<string, FakeSock>();
  const players: Player[] = [];
  for (let i = 0; i < n; i++) {
    const p = room.join({ name: `P${i}`, bib: String(100 + i) }).player;
    const s = new FakeSock();
    room.attach(p, s);
    socks.set(p.id, s);
    players.push(p);
    room.updatePos(p, CENTER.lat, CENTER.lng, 5);
  }
  room.hostCmd(host, { cmd: 'start' });
  advance(5000);
  const hunters = players.filter((p) => p.role === 'hunter');
  const runners = players.filter((p) => p.role === 'runner');
  /** Keep everybody's GPS fresh at their current spot. */
  const refresh = () => {
    for (const p of players) if (p.pos) room.updatePos(p, p.pos.lat, p.pos.lng, p.pos.acc);
  };
  return { ...env, host, players, hunters, runners, socks, refresh };
}

export const away = (m: number, deg = 0) => offset(CENTER, m, deg);
