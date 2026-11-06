import {
  CLAIM_CODE_RE,
  END_REASON_LABEL,
  bearing,
  hunterCount,
  hunterPoints,
  inBoundary,
  offset,
  randomPointIn,
  runnerPoints,
  shuffle,
  type ActionDef,
  type Blip,
  type ChaseHud,
  type EndReason,
  type GameResult,
  type MapMarker,
  type Radar,
  type ResultRow,
  type Stage,
  type Team,
} from '@runnn/shared';
import { bibQr, verifyBibQr } from '../bibcode.ts';
import type { Player, Room } from '../room.ts';
import type { GameModule } from './types.ts';
import { GameError, clock, listNames } from './util.ts';

/** A scan survives a blink. */
export const SCAN_GAP_MS = 1200;
const REJECT_QUIET_MS = 4000;
const BOT_SCAN_RANGE = 4;

interface Scan {
  targetId: string;
  start: number;
  last: number;
}

interface State {
  releaseAt: number;
  released: boolean;
  /** One live scan per hunter. */
  scans: Record<string, Scan>;
  /** Last rejected QR per hunter, so a camera on the wrong QR cannot spam toasts. */
  rejects: Record<string, { qr: string; at: number }>;
}

const COLORS = { hunter: '#7c3aed', runner: '#0f9d58', organiser: '#141414', out: '#9b968c' } as const;

const st = (room: Room) => room.state as State;
const isHunter = (p: Player) => p.role === 'hunter' && p.status !== 'eliminated';
const isRunner = (p: Player) => p.role === 'runner' && p.status !== 'eliminated';

/** Close the runner clock for this player (game clock). */
function stopRunnerClock(room: Room, p: Player) {
  if (p.stats.runnerSince !== undefined && p.stats.runnerSince >= 0) {
    p.stats.runnerMs = (p.stats.runnerMs ?? 0) + Math.max(0, room.now() - p.stats.runnerSince);
    p.stats.runnerSince = -1;
  }
}

function runnerMs(room: Room, p: Player): number {
  const open = p.stats.runnerSince !== undefined && p.stats.runnerSince >= 0 ? room.now() - p.stats.runnerSince : 0;
  return (p.stats.runnerMs ?? 0) + Math.max(0, open);
}

function reject(room: Room, h: Player, qr: string, text: string) {
  const s = st(room);
  const prev = s.rejects[h.id];
  const now = room.now();
  if (prev && prev.qr === qr && now - prev.at < REJECT_QUIET_MS) return;
  s.rejects[h.id] = { qr, at: now };
  room.toast(h, text, 'bad', [60]);
}

function convert(room: Room, h: Player | null, target: Player, how: 'scan' | 'code' | 'unknown') {
  const s = st(room);
  stopRunnerClock(room, target);
  target.role = 'hunter';
  target.status = 'converted';
  for (const [hid, sc] of Object.entries(s.scans)) if (sc.targetId === target.id) delete s.scans[hid];
  if (h) {
    h.stats.conversions = (h.stats.conversions ?? 0) + 1;
    delete s.scans[h.id];
    room.toast(h, `Caught ${target.name}! +25`, 'good', [100, 50, 100], 'caught');
    room.post(`${h.name} caught ${target.name}`, 'alert');
  } else {
    room.post(`${target.name} was caught`, 'alert');
  }
  room.toast(target, 'You were caught. You are a hunter now. Go get them!', 'alert', [500, 100, 500], 'converted');
  room.record('convert', { p: h?.id ?? null, target: target.id, how });
  room.touch();
}

function radarFor(room: Room, p: Player): Radar | null {
  if (!p.plays || p.status === 'eliminated' || !room.hasFreshFix(p)) return null;
  const range = room.config.radarRange;
  // 0.5 m quantisation: the wire never carries a coordinate that could be turned back into a position.
  const half = (x: number) => Math.round(x * 2) / 2;
  const blips: Blip[] = [];
  for (const q of room.activePlayers()) {
    if (q.id === p.id || !q.role || q.role === 'organiser') continue;
    const d = room.dist(p, q);
    if (d === null || d > range) continue;
    const b = (bearing(p.pos!, q.pos!) * Math.PI) / 180;
    blips.push({ key: q.blip, e: half(d * Math.sin(b)), n: half(d * Math.cos(b)), team: q.role });
  }
  return { range, blips };
}

function scanFrame(room: Room, h: Player, qr: string) {
  const s = st(room);
  const now = room.now();
  if (h.role !== 'hunter' || h.status === 'eliminated') return;
  if (!s.released) return reject(room, h, qr, 'Not released yet. Wait…');

  const bib = verifyBibQr(qr);
  if (!bib) return reject(room, h, qr, 'That is not a game bib QR.');
  const target = room.findByBib(bib);
  if (!target || target.id === h.id) return reject(room, h, qr, `Nobody here wears bib ${bib}.`);
  if (target.role !== 'runner') return; // camera lingering on a fellow hunter: say nothing
  if (target.status === 'eliminated') return reject(room, h, qr, `${target.name} is out this round.`);
  if (!room.tagPlausible(h, target, room.config.tagMaxDistance))
    return reject(room, h, qr, `${target.name} is too far away by GPS. Scan their real back!`);

  const cur = s.scans[h.id];
  if (!cur || cur.targetId !== target.id || now - cur.last > SCAN_GAP_MS) {
    s.scans[h.id] = { targetId: target.id, start: now, last: now };
    room.record('scan', { p: h.id, target: target.id, outcome: 'started' });
    room.toast(target, 'Someone has a camera on your back! MOVE!', 'alert', [200, 80, 200, 80, 200], 'scan');
    room.touch();
  } else {
    cur.last = now;
  }
  if (now - s.scans[h.id].start >= room.config.holdSecs * 1000) convert(room, h, target, 'scan');
  else room.touch();
}

function winnerFor(room: Room, reason: EndReason): Team | null {
  if (reason === 'allCaught') return 'hunter';
  if (reason === 'time' || reason === 'noHunters') return 'runner';
  return null;
}

function headline(room: Room, reason: EndReason, winner: Team | null, survivors: Player[], ms: number): string {
  const dealtRunners = room.playing().filter((p) => p.team === 'runner').length;
  if (reason === 'allCaught') return `Hunters caught every runner in ${clock(ms)}.`;
  if (reason === 'time')
    return `Runners held out: ${survivors.length} of ${dealtRunners} never caught${
      survivors.length <= 3 && survivors.length ? ` (${listNames(survivors.map((p) => p.name))})` : ''
    }.`;
  if (reason === 'noHunters') return 'No hunters left. Runners win.';
  return `${END_REASON_LABEL[reason]} after ${clock(ms)}.${winner ? '' : ' No winner this time.'}`;
}

export const chase: GameModule = {
  deal(room) {
    const players = shuffle(room.playing());
    const k = hunterCount(players.length);
    players.forEach((p, i) => {
      p.team = i < k ? 'hunter' : 'runner';
      p.role = p.team;
      p.status = 'active';
    });
    for (const p of room.players.values()) if (!p.plays) p.role = 'organiser';
  },

  init(room) {
    const now = room.now();
    for (const p of room.playing()) {
      p.stats = { conversions: 0, runnerMs: 0, runnerSince: p.role === 'runner' ? now : -1 };
    }
    const delay = (room.config.releaseDelaySecs ?? 0) * 1000;
    const state: State = { releaseAt: now + delay, released: delay === 0, scans: {}, rejects: {} };
    return state;
  },

  /** Late joiners cannot be dealt fairly, so they join the hunt. */
  lateJoin(room, p) {
    p.team = 'hunter';
    p.role = 'hunter';
    p.status = 'active';
    p.stats = { conversions: 0, runnerMs: 0, runnerSince: -1 };
    room.toast(p, 'You joined mid-round, so you are a hunter.', 'info');
  },

  roleIntro(room, p) {
    if (!p.plays) return 'You are the organiser. You see the full map and every claim code.';
    if (p.role === 'hunter')
      return `You are a HUNTER 🎯. Hold your camera on a runner’s bib for ${room.config.holdSecs} s to catch them.`;
    if (p.role === 'runner') return 'You are a RUNNER 🏃. Keep moving and do not let anyone scan your back.';
    return 'Waiting for the round to start.';
  },

  tick(room) {
    const s = st(room);
    const now = room.now();
    if (!s.released && now >= s.releaseAt) {
      s.released = true;
      room.record('release');
      room.post('Hunters released!', 'alert');
      room.toastAll('GO! You are released.', 'alert', [400], 'release', (p) => p.role === 'hunter');
      room.toastAll('Hunters are released. Run!', 'alert', [200, 100, 200], 'release', (p) => p.role === 'runner');
    }
    for (const [hid, sc] of Object.entries(s.scans)) {
      const h = room.players.get(hid);
      const t = room.players.get(sc.targetId);
      if (!h || !t || !isHunter(h) || !isRunner(t)) {
        delete s.scans[hid];
        continue;
      }
      if (now - sc.last > SCAN_GAP_MS) {
        delete s.scans[hid];
        room.record('scan', { p: hid, target: t.id, outcome: 'broken', held: Math.round((sc.last - sc.start) / 100) / 10 });
        room.toast(t, 'You got away! 💨', 'good', [80, 40, 80], 'broke');
        room.toast(h, `Lost ${t.name}. Keep the camera on the bib.`, 'bad', [60], 'broke');
        room.touch();
      }
    }
  },

  actions(room, p) {
    const out: ActionDef[] = [];
    if (p.plays && p.role === 'runner' && p.status === 'active') {
      out.push({
        id: 'caught',
        label: 'I got caught',
        needsCode: true,
        codeLabel: 'Hunter’s 4-digit claim code',
        confirm: 'I don’t know who caught me',
        danger: true,
      });
    }
    return out;
  },

  action(room, p, action, code) {
    if (action !== 'caught') throw new GameError('Unknown action.');
    if (!code) {
      room.record('code', { p: p.id, outcome: 'unknown' });
      return convert(room, null, p, 'unknown');
    }
    if (!CLAIM_CODE_RE.test(code)) throw new GameError('A claim code is 4 digits.');
    const h = room.findByClaimCode(code);
    if (!h || h.id === p.id || h.role !== 'hunter' || h.status === 'eliminated') {
      p.stats._wrongCodes = (p.stats._wrongCodes ?? 0) + 1;
      room.record('code', { p: p.id, outcome: 'wrong' });
      if (p.stats._wrongCodes >= 3) {
        p.stats._wrongCodes = 0;
        room.setCooldown(p, 'caught', 30);
        throw new GameError(`No hunter has code ${code}. Too many wrong codes: wait 30 s.`);
      }
      throw new GameError(`No hunter has code ${code}. Ask them to check their phone.`);
    }
    room.record('code', { p: p.id, hunter: h.id, outcome: 'ok' });
    convert(room, h, p, 'code');
  },

  scan(room, p, qr) {
    const t = room.now();
    if (t - p.lastScanAt < 150) return; // ~6 frames a second is plenty
    p.lastScanAt = t;
    scanFrame(room, p, qr);
  },

  checkEnd(room) {
    const players = room.playing();
    if (!players.length) return 'other';
    if (!players.some(isRunner)) return 'allCaught';
    if (!players.some(isHunter)) return 'noHunters';
    if (room.endsAt !== null && room.now() >= room.endsAt) return 'time';
    return null;
  },

  finish(room, reason) {
    for (const p of room.playing()) stopRunnerClock(room, p);
    if (st(room)) st(room).scans = {};
    const winner = winnerFor(room, reason);
    const ms = room.startedAt === null ? 0 : room.now() - room.startedAt;
    const rows: ResultRow[] = room.playing().map((p) => {
      const pts = this.points(room, p);
      return {
        playerId: p.id,
        profileId: p.profileId,
        name: p.name,
        isBot: p.isBot,
        team: p.team,
        role: p.role,
        status: p.status,
        points: pts,
        conversions: p.stats.conversions ?? 0,
        survivedSecs: Math.round(runnerMs(room, p) / 1000),
        won: winner !== null && p.team === winner,
      };
    });
    const top = (key: 'runner' | 'hunter') => {
      const scored = rows.filter((r) => r.points[key] !== null);
      if (!scored.length) return null;
      const best = Math.max(...scored.map((r) => r.points[key]!));
      return { names: scored.filter((r) => r.points[key] === best).map((r) => r.name), points: best };
    };
    const survivors = room.playing().filter(isRunner);
    const result: GameResult = {
      reason,
      winner,
      headline: headline(room, reason, winner, survivors, ms),
      endedAt: room.wallNow(),
      durationSecs: Math.round(ms / 1000),
      rows: rows.sort(
        (a, b) => +b.won - +a.won || (b.points.runner ?? 0) + (b.points.hunter ?? 0) - ((a.points.runner ?? 0) + (a.points.hunter ?? 0)),
      ),
      top: { runner: top('runner'), hunter: top('hunter') },
      eliminated: room.playing().filter((p) => p.status === 'eliminated').map((p) => p.name),
    };
    return result;
  },

  points(room, p) {
    if (!p.plays || !p.team) return { runner: null, hunter: null };
    const wasHunter = p.role === 'hunter' || p.team === 'hunter';
    return {
      runner: p.team === 'runner' ? runnerPoints(runnerMs(room, p) / 1000) : null,
      hunter: wasHunter ? hunterPoints(p.stats.conversions ?? 0) : null,
    };
  },

  hud(room, p): ChaseHud {
    const s = st(room);
    const players = room.playing();
    const counts = {
      hunters: players.filter(isHunter).length,
      runners: players.filter(isRunner).length,
      out: players.filter((q) => q.status === 'eliminated').length,
    };
    if (!s) return { game: 'chase', released: false, releaseAt: null, counts, radar: null, scanning: null, beingScanned: null };
    const live = room.phase === 'live' || room.phase === 'paused';
    const mine = s.scans?.[p.id];
    const target = mine ? room.players.get(mine.targetId) : undefined;
    const holdMs = room.config.holdSecs * 1000;
    let beingScanned: ChaseHud['beingScanned'] = null;
    if (p.role === 'runner' && s.scans) {
      const on = Object.values(s.scans).filter((sc) => sc.targetId === p.id);
      if (on.length) beingScanned = { startedAt: room.wall(Math.min(...on.map((x) => x.start))), holdMs: holdMs / room.speed };
    }
    return {
      game: 'chase',
      released: s.released,
      releaseAt: room.wall(s.releaseAt),
      counts,
      radar: live ? radarFor(room, p) : null,
      scanning: target ? { name: target.name, bib: target.bib, startedAt: room.wall(mine!.start), holdMs: holdMs / room.speed } : null,
      beingScanned,
    };
  },

  /** In a live round a player sees only themselves; everyone else is an anonymous radar blip. */
  markers(room, p) {
    const referee = p.isHost && !p.plays;
    const out: MapMarker[] = [];
    for (const q of room.players.values()) {
      if (!q.pos || !q.plays) continue;
      if (!referee && q !== p) continue;
      out.push({
        id: q.id,
        lat: q.pos.lat,
        lng: q.pos.lng,
        label: q === p ? 'You' : q.name,
        color: this.colorFor(room, q),
        emoji: this.emojiFor(room, q),
        me: q === p,
        acc: q === p ? q.pos.acc : undefined,
        sos: referee ? q.sos : undefined,
      });
    }
    return out;
  },

  stage(room, p): Stage | null {
    const s = st(room);
    if (!s) return null;
    if (!s.released)
      return { key: 'release', label: p.role === 'hunter' ? 'Frozen until release' : 'Head start', endsAt: room.wall(s.releaseAt) };
    return { key: 'round', label: 'Round ends', endsAt: room.wall(room.endsAt) };
  },

  hint(room, p) {
    const s = st(room);
    if (!p.plays) return 'Tap a player to see their claim code and GPS.';
    if (p.status === 'eliminated') return 'You are out for this round. Head to the meeting point.';
    if (p.role === 'hunter') {
      if (s && !s.released) return 'Stay put until the release. Runners are getting away…';
      return `Find a runner, get behind them and hold your camera on their bib for ${room.config.holdSecs} s.`;
    }
    if (p.outSince !== null) return 'You are outside the area. Get back in!';
    return 'Keep moving. The radar beeps faster when hunters are close.';
  },

  colorFor(room, p) {
    if (!p.plays) return COLORS.organiser;
    if (p.status === 'eliminated') return COLORS.out;
    if (p.role === 'hunter') return COLORS.hunter;
    if (p.role === 'runner') return COLORS.runner;
    return '#6b665c';
  },

  emojiFor(room, p) {
    if (p.isBot && room.phase === 'lobby') return '🤖';
    if (!p.plays) return '📋';
    if (p.status === 'eliminated') return '💤';
    if (p.role === 'hunter') return '🎯';
    if (p.role === 'runner') return '🏃';
    return '🙂';
  },

  botThink(room, bot) {
    const s = st(room);
    if (!bot.pos || !bot.bot || !s) return;
    const brain = bot.bot;
    const inside = (pt: { lat: number; lng: number }) => inBoundary(pt, room.boundary);

    if (bot.role === 'hunter') {
      if (!s.released) {
        brain.target = bot.pos;
        brain.speed = 0;
        return;
      }
      let best: Player | null = null;
      let bestD = 70;
      for (const q of room.activePlayers()) {
        if (q.role !== 'runner' || q.noBib) continue;
        const d = room.dist(bot, q);
        if (d !== null && d < bestD) {
          best = q;
          bestD = d;
        }
      }
      if (!best) {
        brain.speed = 1.6;
        return;
      }
      brain.target = { lat: best.pos!.lat, lng: best.pos!.lng };
      brain.speed = 3.1 + Math.random() * 0.6;
      if (bestD <= BOT_SCAN_RANGE) {
        scanFrame(room, bot, bibQr(best.bib));
        brain.nextThinkAt = room.wallNow() + 350 / room.speed;
      } else if (bestD < 15) {
        brain.nextThinkAt = room.wallNow() + 400 / room.speed;
      }
      return;
    }

    if (bot.role === 'runner') {
      let threat: Player | null = null;
      let threatD = 25;
      for (const q of room.activePlayers()) {
        if (q.role !== 'hunter') continue;
        const d = room.dist(bot, q);
        if (d !== null && d < threatD) {
          threat = q;
          threatD = d;
        }
      }
      if (!threat || !s.released) {
        if (brain.speed > 2) brain.speed = 1.3;
        return;
      }
      const away = bearing(threat.pos!, bot.pos) + (Math.random() - 0.5) * 70;
      let target = offset(bot.pos, 25, away);
      if (!inside(target)) target = randomPointIn(room.boundary, Math.random, 10);
      brain.target = target;
      brain.speed = 2.7 + Math.random() * 0.5;
    }
  },

  playerOut(room, p) {
    stopRunnerClock(room, p);
    const s = st(room);
    if (!s) return;
    delete s.scans[p.id];
    for (const [hid, sc] of Object.entries(s.scans)) if (sc.targetId === p.id) delete s.scans[hid];
  },
};

