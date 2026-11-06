import { CATCH_CODE_RE, END_REASONS, OUT_GRACE_SECS, POINTS, bearing, boundaryCenter, inBoundary, offset, survivorPoints, zombieCount, zombiePoints, type Blip, type MapMarker, type ResultRow, type TeamPoints } from '@kalikkam/shared';
import { GameError, type Player, type Room } from '../room.ts';
import { verifyVestQr, vestQr } from '../vestcode.ts';
import type { GameModule } from './types.ts';
import { fmtDuration, nearest } from './util.ts';

interface State {
  releaseAt: number;
  released: boolean;
  /** One live scan per zombie: who they're scanning, when it started, when the camera last saw the QR. */
  scans: Record<string, { targetId: string; start: number; last: number }>;
  /** Last rejected QR per zombie, so a camera staring at the wrong QR doesn't spam toasts. */
  rejects: Record<string, { qr: string; at: number }>;
}

/** A scan survives a blink: the camera can lose the QR this long before progress resets. */
const SCAN_GAP_MS = 1200;
const BOT_SCAN_RANGE = 4;
/** Wrong catch codes in a row before a short wait, so nobody can guess their way to a credit. */
const CODE_TRIES = 3;
const CODE_WAIT_SECS = 30;

const st = (room: Room) => room.state as State;
// Eliminated players are out of the round: not counted, not on radars, can't be scanned.
const inGame = (room: Room) => room.activePlayers().filter((p) => p.status !== 'eliminated');
const survivors = (room: Room) => inGame(room).filter((p) => p.role === 'survivor');
const zombies = (room: Room) => inGame(room).filter((p) => p.role === 'zombie');

/** How an infection was credited: a held scan, the catching zombie's code, or nobody ("I don't know"). */
type Credit = 'scan' | 'code' | 'unknown';

function infect(room: Room, zombie: Player | null, target: Player, how: Credit) {
  const s = st(room);
  target.role = 'zombie';
  target.status = 'active';
  target.stats.infected = 1;
  target.stats.survivedSecs = Math.round((room.now() - (room.startedAt ?? room.now())) / 1000);
  for (const [zid, sc] of Object.entries(s.scans)) if (sc.targetId === target.id) delete s.scans[zid];
  room.record('infect', { p: target.id, by: zombie?.id ?? null, how });
  if (zombie) {
    room.bump(zombie, 'infections');
    room.toast(zombie, `🧟 You infected ${target.name}! +${POINTS.perInfection} points`, 'good', [100, 50, 100]);
  }
  const left = survivors(room).length;
  room.log(`🧟 ${target.name} was infected${zombie ? ` by ${zombie.name}` : ''}. ${left} survivor${left === 1 ? '' : 's'} left`, 'bad');
  room.toast(target, '🧟 You are INFECTED! You are a zombie now. Go hunt.', 'bad', [800, 100, 800]);
}

/** Tell a zombie why a scan didn't count, at most once per QR per 3 s. */
function reject(room: Room, z: Player, qr: string, msg: string) {
  const s = st(room);
  const last = s.rejects[z.id];
  if (last && last.qr === qr && room.now() - last.at < 3000) return;
  s.rejects[z.id] = { qr, at: room.now() };
  room.record('reject', { p: z.id, why: msg });
  room.toast(z, msg, 'bad', [60]);
}

/** One camera frame that contains `qr`. Holds for scanSecs → infection. */
function scanFrame(room: Room, z: Player, qr: string) {
  const s = st(room);
  const now = room.now();
  if (z.role !== 'zombie') return;
  if (!s.released) return reject(room, z, qr, 'Zombies are not released yet. Wait…');
  const vest = verifyVestQr(qr);
  if (!vest) return reject(room, z, qr, "That's not a Zombie Run vest QR.");
  const target = room.findByVest(vest);
  if (!target || target.id === z.id) return reject(room, z, qr, `Nobody in this game wears vest ${vest}.`);
  // The camera usually lingers on someone just infected: not worth a message.
  if (target.role !== 'survivor') return;
  if (target.status === 'eliminated') return reject(room, z, qr, `${target.name} is out of this round.`);
  if (!room.tagPlausible(z, target, room.config.tagMaxDistance)) return reject(room, z, qr, `${target.name} is too far away by GPS. Scan their real back!`);
  const cur = s.scans[z.id];
  // The survivor's phone shows the full-screen alarm from the HUD, so no toast here.
  if (!cur || cur.targetId !== target.id || now - cur.last > SCAN_GAP_MS) {
    s.scans[z.id] = { targetId: target.id, start: now, last: now };
    room.record('scan', { p: z.id, target: target.id, outcome: 'started' });
  } else cur.last = now;
  if (now - s.scans[z.id].start >= room.config.scanSecs * 1000) infect(room, z, target, 'scan');
}

/** Everyone within radarRange of `p`, as offsets in metres. No names or player ids. */
function radarFor(room: Room, p: Player): { range: number; blips: Blip[] } | null {
  if (!p.plays || p.status === 'eliminated' || !p.pos || !room.hasFreshFix(p)) return null;
  const range = room.config.radarRange;
  const half = (x: number) => Math.round(x * 2) / 2;
  const blips: Blip[] = [];
  for (const q of room.activePlayers()) {
    if (q.id === p.id || q.status === 'eliminated' || (q.role !== 'zombie' && q.role !== 'survivor')) continue;
    const d = room.dist(p, q);
    if (d === null || d > range) continue;
    const b = (bearing(p.pos, q.pos!) * Math.PI) / 180;
    blips.push({ key: q.blip, e: half(d * Math.sin(b)), n: half(d * Math.cos(b)), team: q.role });
  }
  return { range, blips };
}

function scanningHud(room: Room, p: Player) {
  const sc = st(room).scans[p.id];
  const t = sc && room.players.get(sc.targetId);
  if (!sc || !t) return null;
  const end = sc.start + room.config.scanSecs * 1000;
  return { name: t.name, endsAt: room.wall(end)!, totalMs: room.wall(end)! - room.wall(sc.start)! };
}

function beingScannedHud(room: Room, p: Player) {
  const mine = Object.values(st(room).scans).filter((x) => x.targetId === p.id);
  if (!mine.length) return null;
  const start = Math.min(...mine.map((x) => x.start));
  const end = start + room.config.scanSecs * 1000;
  return { endsAt: room.wall(end)!, totalMs: room.wall(end)! - room.wall(start)!, zombies: mine.length };
}

/** Points so far: survivor points for anyone dealt survivor, zombie points for anyone who is a zombie now. */
function pointsOf(room: Room, p: Player): TeamPoints {
  // Eliminated for leaving the play area: no points on either board.
  if (p.status === 'eliminated') return { survivor: null, zombie: null };
  const alive = Math.round((room.now() - (room.startedAt ?? room.now())) / 1000);
  return {
    survivor: p.team === 'survivor' ? survivorPoints(p.role === 'survivor' ? alive : (p.stats.survivedSecs ?? 0)) : null,
    zombie: p.role === 'zombie' ? zombiePoints(p.stats.infections ?? 0) : null,
  };
}

/** "Anu", "Anu and Zed", "Anu, Zed and Bob", "Anu, Zed and 3 more". */
function listNames(names: string[]) {
  if (names.length > 3) return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Deal the teams at random: shuffle, then the first zombieCount(n) are zombies. */
export function dealTeams(players: Player[], rand: () => number = Math.random) {
  const order = [...players];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const k = zombieCount(order.length, rand);
  order.forEach((p, i) => (p.team = p.role = i < k ? 'zombie' : 'survivor'));
}

export const zombies_: GameModule = {
  deal(room) {
    dealTeams(room.activePlayers());
    room.rerollCatchCodes();
  },

  init(room) {
    const now = room.now();
    room.endsAt = now + room.config.durationSecs * 1000;
    const s: State = {
      releaseAt: now + room.config.zombieDelaySecs * 1000,
      released: room.config.zombieDelaySecs === 0,
      scans: {},
      rejects: {},
    };
    room.state = s;
    return s;
  },

  lateJoin(room, p) {
    // Too late for the deal: late joiners start as zombies, so nobody slips in as a fresh survivor near the end.
    p.team = p.role = 'zombie';
    p.status = 'active';
  },

  roleIntro(room, p) {
    return p.role === 'zombie'
      ? `🧟 You are a ZOMBIE. ${room.config.zombieDelaySecs ? `Wait ${fmtDuration(room.config.zombieDelaySecs)}, then hunt` : 'Hunt'} the survivors on your radar: ${POINTS.perInfection} points per infection!`
      : `🏃 You are a SURVIVOR. Keep your back QR away from zombies: ${POINTS.survivorPerMinute} points for every minute you last!`;
  },

  tick(room) {
    const s = st(room);
    const now = room.now();
    if (!s.released && now >= s.releaseAt) {
      s.released = true;
      room.log('🧟 The zombies are loose!', 'alert');
      room.toastAll('🧟 HUNT! Find survivors on your radar.', 'alert', [500, 200, 500], (p) => p.role === 'zombie');
      room.toastAll('🧟 The zombies are loose! Watch your radar.', 'alert', [500, 200, 500], (p) => p.role === 'survivor');
    }
    // Bot zombies "scan" any survivor they're right behind.
    if (s.released) {
      for (const z of zombies(room)) {
        if (!z.isBot || !z.pos) continue;
        const prey = nearest(room, z, survivors(room));
        if (!prey || prey.d > 25) continue;
        // Close in: chase where they are now, not where they were at the last think.
        z.bot!.target = prey.player.pos;
        z.bot!.hold = false;
        if (prey.d <= BOT_SCAN_RANGE) scanFrame(room, z, vestQr(prey.player.vest));
      }
    }
    // A scan whose QR left the camera for too long breaks.
    for (const [zid, sc] of Object.entries(s.scans)) {
      if (now - sc.last <= SCAN_GAP_MS) continue;
      delete s.scans[zid];
      room.record('scan', { p: zid, target: sc.targetId, outcome: 'broken', secs: Math.round((sc.last - sc.start) / 100) / 10 });
      const t = room.players.get(sc.targetId);
      if (t && t.role === 'survivor' && !Object.values(s.scans).some((x) => x.targetId === t.id)) {
        room.toast(t, '😮‍💨 Scan broken. Keep moving!', 'good', [80]);
      }
      room.dirty = true;
    }
  },

  actions(room, p) {
    const s = st(room);
    if (p.status === 'eliminated') return [];
    if (p.role === 'zombie') {
      return [
        {
          id: 'scan',
          label: s.released ? 'Scan a survivor' : 'Wait for release…',
          input: 'scan',
          style: 'primary',
          disabled: !s.released,
        },
      ];
    }
    if (p.role === 'survivor') {
      // The caught survivor types the zombie's private catch code, so the right zombie gets the credit.
      return [{ id: 'gotTagged', label: 'I got infected', style: 'danger', input: 'code', cooldownUntil: p.cooldowns.code ?? undefined }];
    }
    return [];
  },

  action(room, p, action, code = '') {
    if (action === 'gotTagged') {
      if (p.role !== 'survivor') throw new GameError('You are not a survivor');
      // No code: "I don't know who caught me". They still turn, but nobody gets the credit.
      if (!code) return infect(room, null, p, 'unknown');
      if (!CATCH_CODE_RE.test(code)) throw new GameError('A catch code is 4 digits. Ask the zombie for the code on their phone.');
      const z = room.findByCatchCode(code);
      if (!z || z.id === p.id || z.role !== 'zombie' || z.status === 'eliminated') {
        p.stats._wrongCodes = (p.stats._wrongCodes ?? 0) + 1;
        room.record('code', { p: p.id, ok: false });
        if (p.stats._wrongCodes >= CODE_TRIES) {
          p.stats._wrongCodes = 0;
          room.setCooldown(p, 'code', CODE_WAIT_SECS);
          throw new GameError(`No zombie has code ${code}. Too many wrong codes: wait ${CODE_WAIT_SECS} s.`);
        }
        throw new GameError(`No zombie has code ${code}. Ask them to check the code on their phone.`);
      }
      delete p.stats._wrongCodes;
      room.record('code', { p: p.id, ok: true });
      return infect(room, z, p, 'code');
    }
    throw new GameError('Unknown action');
  },

  playerOut(room, p) {
    const s = st(room);
    if (!s) return;
    for (const [zid, sc] of Object.entries(s.scans)) if (zid === p.id || sc.targetId === p.id) delete s.scans[zid];
  },

  scan(room, p, qr) {
    scanFrame(room, p, qr);
  },

  checkEnd(room) {
    if (survivors(room).length === 0) return 'allInfected';
    if (zombies(room).length === 0) return 'noZombies';
    if (room.endsAt !== null && room.now() >= room.endsAt) return 'time';
    return null;
  },

  finish(room, reason) {
    const players = room.activePlayers();
    const alive = survivors(room);
    const survivorsWin = alive.length > 0;
    const full = Math.round((room.now() - (room.startedAt ?? room.now())) / 1000);
    for (const p of alive) p.stats.survivedSecs = full;
    // Points are the main thing, on two boards. The team result stays: survivors win if anyone is still
    // standing (the ones still standing); zombies win otherwise (the players who started as zombies).
    const rows: ResultRow[] = players.map((p) => ({
      id: p.id,
      name: p.name,
      role: p.team ?? p.role,
      status: p.stats.infected ? 'infected' : p.status,
      won: p.status !== 'eliminated' && (survivorsWin ? p.role === 'survivor' : p.team === 'zombie'),
      points: pointsOf(room, p),
      stats: Object.fromEntries(Object.entries(p.stats).filter(([k]) => !k.startsWith('_'))),
    }));
    const total = (r: ResultRow) => (r.points.survivor ?? 0) + (r.points.zombie ?? 0);
    rows.sort((a, b) => Number(b.won) - Number(a.won) || total(b) - total(a));
    // The high score on each board, shared by everyone tied for it.
    const top = (side: keyof TeamPoints) => {
      const on = rows.filter((r) => r.points[side] !== null);
      const pts = Math.max(0, ...on.map((r) => r.points[side]!));
      const names = on.filter((r) => r.points[side] === pts).map((r) => r.name);
      return { pts, names, label: names.length > 1 ? 's' : '' };
    };
    const topS = top('survivor');
    const topZ = top('zombie');
    const out = players.filter((p) => p.status === 'eliminated');
    const hostReason = END_REASONS.find((r) => r.id === room.endReason)?.label;
    return {
      headline: survivorsWin
        ? `Survivors win! ${alive.length} still standing 🏃`
        : alive.length === 0 && players.some((p) => p.role === 'survivor' && p.status === 'eliminated')
          ? 'Zombies win! No survivors left 🧟'
          : 'Zombies win! Everyone was infected 🧟',
      lines: [
        topS.names.length ? `🏃 Top survivor${topS.label}: ${listNames(topS.names)}, ${topS.pts} points.` : '',
        topZ.pts ? `🧟 Top zombie${topZ.label}: ${listNames(topZ.names)}, ${topZ.pts} points.` : '',
        out.length ? `🚫 Out for leaving the play area: ${listNames(out.map((p) => p.name))}.` : '',
        reason === 'noZombies' ? 'Every zombie left the play area.' : '',
        reason === 'host' ? `Game ended early by the host${hostReason ? ` (${hostReason.toLowerCase()})` : ''}.` : '',
      ].filter(Boolean),
      rows,
      endedAt: 0,
    };
  },

  hud(room, p) {
    const s = st(room);
    if (!s) return { kind: 'none' };
    return {
      kind: 'zombies',
      survivors: survivors(room).length,
      zombies: zombies(room).length,
      radar: radarFor(room, p),
      zombieReleaseAt: s.released ? null : room.wall(s.releaseAt),
      scanning: scanningHud(room, p),
      beingScanned: beingScannedHud(room, p),
      points: p.plays ? pointsOf(room, p) : null,
    };
  },

  markers(room, viewer) {
    // Players only see themselves on the map (to stay in bounds); everyone else is on the radar.
    // A referee who isn't playing sees everyone.
    const referee = viewer.isHost && !viewer.plays;
    const out: MapMarker[] = [];
    for (const p of room.activePlayers()) {
      if (!referee && p.id !== viewer.id) continue;
      const m = room.playerMarker(p, viewer);
      if (m) out.push(m);
    }
    return out;
  },

  stage(room) {
    const s = st(room);
    if (!s.released) return { key: 'release', label: 'Zombies released in', endsAt: room.wall(s.releaseAt) };
    return { key: 'live', label: 'Time left', endsAt: room.wall(room.endsAt) };
  },

  hint(room, p) {
    const s = st(room);
    if (p.status === 'eliminated') return `You stayed outside the play area for ${OUT_GRACE_SECS} s, so you're out of this round.`;
    // The banner above shows the seconds left; this says where to go.
    if (room.isOut(p)) return '🚧 Head back inside the dashed line. Tap Play area to see it.';
    if (p.role === 'zombie') {
      if (!s.released) return 'Wait. Let the survivors scatter…';
      return `Find survivors on your radar. Get behind one and hold your camera on their back QR for ${room.config.scanSecs} s.`;
    }
    return 'Watch your radar. Keep your back away from zombies until the timer runs out.';
  },

  colorFor(room, p) {
    if (!p.plays || p.status === 'eliminated') return '#e2ded4';
    return p.role === 'zombie' ? '#ffc21a' : '#ffffff';
  },

  emojiFor(room, p) {
    if (!p.plays) return '🎙️';
    if (p.status === 'eliminated') return '🚫';
    return p.role === 'zombie' ? '🧟' : '🏃';
  },

  botThink(room, bot) {
    const s = st(room);
    const brain = bot.bot!;
    brain.hold = false;
    if (bot.role === 'zombie') {
      if (!s.released) {
        brain.target = bot.pos;
        brain.hold = true;
        return;
      }
      const prey = nearest(room, bot, survivors(room));
      // Zombies sprint a little when they're close; scanning happens in tick() once they're right behind.
      const base = (brain.mem.baseSpeed as number | undefined) ?? (brain.mem.baseSpeed = brain.speed);
      brain.speed = prey && prey.d < 60 ? base * 1.25 : base;
      if (prey && prey.d < 150) brain.target = prey.player.pos;
      return;
    }
    const threat = nearest(room, bot, zombies(room));
    if (threat && threat.d < 50 && s.released && (threat.d < 15 || Math.random() < 0.6)) {
      const away = offset(bot.pos!, 40, (bearing(threat.player.pos!, bot.pos!) + Math.random() * 50 - 25 + 360) % 360);
      // Bots play by the rules too: fleeing never takes them out of the play area.
      brain.target = inBoundary(away, room.boundary) ? away : boundaryCenter(room.boundary);
    }
  },

};

export { zombies_ as zombies };
