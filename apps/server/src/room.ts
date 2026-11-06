import { randomBytes, randomInt } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  ENTRY_USDC,
  GAMES,
  distance,
  inBoundary,
  randomPointIn,
  boundaryCenter,
  offset,
  bearing,
  VEST_RE,
  type Boundary,
  type GameId,
  type LatLng,
  type Phase,
  type Role,
  type Status,
  type FeedItem,
  type GameResult,
  type RoomView,
  type PlayerSummary,
  type MapMarker,
  type ServerMsg,
  type ClientMsg,
  type HostCmd,
  type ActionDef,
  type EndReason,
  type Team,
  OUT_GRACE_SECS,
  isEndReason,
} from '@kalikkam/shared';
import type { GameModule } from './games/types.ts';
import { MODULES } from './games/index.ts';
import { vestQr } from './vestcode.ts';
import { EXPLORER, roundId } from './arc.ts';

export class GameError extends Error {}

export interface Fix extends LatLng {
  acc: number;
  at: number;
}

export interface BotBrain {
  target: LatLng | null;
  /** Stop at the target instead of wandering on once it is reached. */
  hold: boolean;
  speed: number;
  nextThinkAt: number;
  /** Bot-local scratch space for game modules. */
  mem: Record<string, unknown>;
}

export interface Player {
  id: string;
  secret: string;
  name: string;
  vest: string;
  isBot: boolean;
  isHost: boolean;
  /** Joined without a printed vest (number assigned by the app), so there's no QR on their back. */
  noVest: boolean;
  plays: boolean;
  profileId: string | null;
  /** Starting team, dealt at random when the game goes live (null in the lobby). It decides who won. */
  team: Team | null;
  /** Current role: a survivor who gets infected becomes a zombie. */
  role: Role | null;
  status: Status;
  stats: Record<string, number>;
  pos: Fix | null;
  /** Game clock: when this player last left the play area (null while inside). */
  outSince: number | null;
  /** Private 4-digit code, unique in the room. A survivor caught by this zombie types it to give the credit. */
  catchCode: string;
  /** How well this phone kept its location fresh during the round (for the game log). */
  gps: GpsHealth;
  sos: boolean;
  /** paid entry games: didn't pay before the start, so watching this round (plays again after a rematch). */
  sitOut: boolean;
  suspicious: boolean;
  sockets: Set<WebSocket>;
  lastSeen: number;
  cooldowns: Record<string, number>;
  joinedAt: number;
  /** Opaque radar key, so a dot on someone's radar can't be matched to a player id or name. */
  blip: string;
  bot: BotBrain | null;
}

export interface GpsHealth {
  fixes: number;
  /** Gaps longer than FIX_STALE_MS between fixes: the player dropped off radars. */
  gaps: number;
  longestGapMs: number;
  accSum: number;
  /** Wall clock of the last fix, or of the start of the round. */
  lastAt: number | null;
}
const freshGps = (at: number | null = null): GpsHealth => ({ fixes: 0, gaps: 0, longestGapMs: 0, accSum: 0, lastAt: at });

/** One line of the game log: what happened, when (seconds into the round), and who (player ids). */
export type JournalEntry = { t: number; kind: string } & Record<string, unknown>;
const JOURNAL_MAX = 5000;

const BOT_NAMES = [
  'Appu', 'Ammu', 'Kunju', 'Unni', 'Meenu', 'Chinnu', 'Achu', 'Manu', 'Anu', 'Tintu',
  'Kuttan', 'Pinky', 'Sachu', 'Ponnu', 'Jithu', 'Ammini', 'Kichu', 'Baby', 'Sona', 'Vava',
];

const COUNTDOWN_MS = 5000;
const FIX_STALE_MS = 20_000;
/** A fix fuzzier than this can't start the out-of-area timer: GPS error near the edge isn't a reason to eliminate. */
const OUT_MAX_ACC = 30;

export interface RoomHooks {
  onEnd?: (room: Room, result: GameResult) => void;
}

export class Room {
  readonly code: string;
  readonly hostKey = randomBytes(12).toString('hex');
  readonly createdAt = Date.now();
  readonly game: GameId;
  readonly module: GameModule;
  title: string;
  config: Record<string, number>;
  boundary: Boundary;
  eventId: string | null;
  /** Simulation rooms are bots-only showcases: fast-forwardable, not saved to profiles. */
  readonly sim: boolean;
  /** Game-clock speed multiplier (1 for real games). */
  readonly speed: number;
  phase: Phase = 'lobby';
  players = new Map<string, Player>();
  feed: FeedItem[] = [];
  result: GameResult | null = null;
  /** What happened this round, saved with the result so a test run can be diagnosed. No location paths. */
  journal: JournalEntry[] = [];
  /** Why the host ended the game early, if they did. */
  endReason: EndReason | null = null;
  /** paid entry games: this round's pot id and who paid (player id → their Kalikkam wallet and the tx). */
  entry: { round: number; id: string; pool: string; paid: Map<string, { address: string; tx: string }> } | null = null;
  /** Game-module state, (re)created on every start. */
  state: any = null;
  startedAt: number | null = null; // game clock
  endsAt: number | null = null; // game clock
  countdownEndsAt: number | null = null; // wall clock
  dirty = true;
  lastActivity = Date.now();
  private feedSeq = 0;
  private pausedAt: number | null = null;
  private pausedTotal = 0;
  private lastBroadcast = 0;
  /** Simulation host sockets watching through a bot's screen: the team asked for, and the bot being followed. */
  private watchers = new Map<WebSocket, { team: Team; id: string | null }>();
  private hooks: RoomHooks;
  private wallNow: () => number;
  private clockOrigin: number;

  constructor(
    code: string,
    opts: {
      game: GameId;
      title: string;
      config: Record<string, number>;
      boundary: Boundary;
      eventId?: string | null;
      sim?: boolean;
      speed?: number;
      /** The pot contract's address, for a paid entry game. */
      entryPool?: string;
    },
    hooks: RoomHooks = {},
    clock: () => number = Date.now,
  ) {
    this.code = code;
    this.game = opts.game;
    this.module = MODULES[opts.game];
    this.title = opts.title;
    this.config = opts.config;
    this.boundary = opts.boundary;
    this.eventId = opts.eventId ?? null;
    this.hooks = hooks;
    this.wallNow = clock;
    this.clockOrigin = clock();
    this.sim = !!opts.sim;
    this.speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
    if (opts.entryPool) this.entry = { round: 0, id: roundId(code, this.createdAt, 0), pool: opts.entryPool, paid: new Map() };
  }

  /** A player's paid entry is in the pot. */
  markPaid(p: Player, address: string, tx: string) {
    if (!this.entry || this.entry.paid.has(p.id)) return;
    this.entry.paid.set(p.id, { address, tx });
    this.record('entry', { p: p.id, tx });
    this.log(`💵 ${p.name} paid the ${ENTRY_USDC} USDC entry. Pot: ${this.entry.paid.size * ENTRY_USDC} USDC`, 'good');
    this.dirty = true;
  }

  // ---- clocks -------------------------------------------------------------

  /** Game clock: stands still while paused and runs `speed`× in simulations. All game timers use this. */
  now(): number {
    const t = (this.pausedAt ?? this.wallNow()) - this.pausedTotal;
    return this.clockOrigin + (t - this.clockOrigin) * this.speed;
  }
  /** Convert a game-clock timestamp to wall clock for clients. */
  wall(t: number | null): number | null {
    return t === null ? null : Math.round(this.clockOrigin + (t - this.clockOrigin) / this.speed + this.pausedTotal);
  }
  get meta() {
    return GAMES[this.game];
  }

  // ---- players ------------------------------------------------------------

  activePlayers(): Player[] {
    return [...this.players.values()].filter((p) => p.plays);
  }

  host(): Player | undefined {
    return [...this.players.values()].find((p) => p.isHost);
  }

  findByVest(vest: string): Player | undefined {
    return this.activePlayers().find((p) => p.vest === vest);
  }

  private freeVest(): string {
    const used = new Set([...this.players.values()].map((p) => p.vest));
    for (let i = 0; i < 2000; i++) {
      const v = String(randomInt(100, 1000));
      if (!used.has(v)) return v;
    }
    throw new GameError('No free vest numbers left');
  }

  addPlayer(opts: {
    name: string;
    vest?: string;
    isHost?: boolean;
    plays?: boolean;
    isBot?: boolean;
    profileId?: string | null;
  }): Player {
    const name = opts.name.trim().slice(0, 24) || 'Player';
    let vest = (opts.vest ?? '').trim();
    if (vest) {
      if (!VEST_RE.test(vest)) throw new GameError('Vest number must be 3 digits');
      if (this.findByVest(vest)) throw new GameError(`Vest ${vest} is already taken. Check your number.`);
    } else vest = this.freeVest();
    if (this.players.size >= 200) throw new GameError('Room is full (200 players)');
    const plays = opts.plays ?? true;
    const p: Player = {
      id: randomBytes(6).toString('hex'),
      secret: randomBytes(12).toString('hex'),
      name,
      vest,
      isBot: !!opts.isBot,
      isHost: !!opts.isHost,
      noVest: !opts.vest && !opts.isBot && plays,
      plays,
      profileId: opts.profileId ?? null,
      team: null,
      role: plays ? null : 'host',
      status: plays ? 'active' : 'spectating',
      stats: {},
      pos: null,
      outSince: null,
      catchCode: this.newCatchCode(),
      gps: freshGps(),
      sos: false,
      sitOut: false,
      suspicious: false,
      sockets: new Set(),
      lastSeen: this.wallNow(),
      cooldowns: {},
      joinedAt: this.wallNow(),
      blip: randomBytes(4).toString('hex'),
      bot: opts.isBot ? { target: null, hold: false, speed: 1.2 + Math.random() * 1.8, nextThinkAt: 0, mem: {} } : null,
    };
    this.players.set(p.id, p);
    if (plays && !p.isBot && this.entry && this.phase !== 'lobby' && this.phase !== 'ended') {
      // paid entry game already under way: entries are closed, so they watch this round.
      p.plays = false;
      p.sitOut = true;
      p.status = 'spectating';
      p.role = null;
    } else if (plays && (this.phase === 'countdown' || this.phase === 'live' || this.phase === 'paused')) {
      this.module.lateJoin(this, p);
      this.log(`${p.name} joined mid-game as ${p.role}`, 'info');
      this.record('join', { p: p.id, name: p.name, as: p.role });
    } else if (!p.isBot) {
      this.log(`${p.name} joined`, 'info');
    }
    this.dirty = true;
    return p;
  }

  addBots(n: number) {
    const bots = [...this.players.values()].filter((p) => p.isBot).length;
    const count = Math.max(0, Math.min(n, 60 - bots));
    if (count === 0) throw new GameError('Bot limit reached (60 per game)');
    const center = boundaryCenter(this.boundary);
    for (let i = 0; i < count; i++) {
      const k = this.players.size + i;
      const base = BOT_NAMES[k % BOT_NAMES.length];
      const round = Math.floor(k / BOT_NAMES.length);
      const p = this.addPlayer({ name: `${base}${round ? ` ${round + 1}` : ''} 🤖`, isBot: true });
      const start = this.phase === 'lobby' ? offset(center, Math.random() * 15, Math.random() * 360) : randomPointIn(this.boundary);
      p.pos = { ...start, acc: 8, at: this.wallNow() };
    }
    this.log(`${count} bot${count === 1 ? '' : 's'} added`, 'info');
  }

  /** A 4-digit code nobody else in this room has. */
  newCatchCode(): string {
    const taken = new Set([...this.players.values()].map((p) => p.catchCode));
    for (;;) {
      const c = String(randomInt(1000, 10000));
      if (!taken.has(c)) return c;
    }
  }

  /** Fresh catch codes for everyone, so last round's codes don't carry over. */
  rerollCatchCodes() {
    for (const p of this.players.values()) p.catchCode = '';
    for (const p of this.players.values()) p.catchCode = this.newCatchCode();
  }

  findByCatchCode(code: string): Player | undefined {
    return code ? this.activePlayers().find((p) => p.catchCode === code) : undefined;
  }

  /** Add a line to the game log. */
  record(kind: string, data: Record<string, unknown> = {}) {
    if (this.journal.length >= JOURNAL_MAX) return;
    const t = this.startedAt === null ? 0 : Math.round((this.now() - this.startedAt) / 100) / 10;
    this.journal.push({ t, kind, ...data });
  }

  removePlayer(id: string, reason = 'removed') {
    const p = this.players.get(id);
    if (!p) return;
    if (this.phase === 'live' || this.phase === 'paused') this.record('host', { action: 'kick', p: p.id });
    for (const ws of p.sockets) {
      this.send(ws, { t: 'error', msg: `You were ${reason} by the host`, fatal: true });
      ws.close();
    }
    this.players.delete(id);
    this.module.playerLeft?.(this, p);
    this.dirty = true;
  }

  // ---- messaging ----------------------------------------------------------

  log(text: string, kind: FeedItem['kind'] = 'info') {
    this.feed.push({ id: ++this.feedSeq, at: this.wallNow(), text, kind });
    if (this.feed.length > 60) this.feed.splice(0, this.feed.length - 60);
    this.dirty = true;
  }

  send(ws: WebSocket, msg: ServerMsg) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  toast(p: Player, text: string, kind: FeedItem['kind'] = 'info', vibrate?: number[]) {
    const msg: ServerMsg = { t: 'toast', text, kind, vibrate };
    for (const ws of p.sockets) this.send(ws, msg);
    for (const [ws, w] of this.watchers) if (w.id === p.id) this.send(ws, msg);
  }

  toastAll(text: string, kind: FeedItem['kind'] = 'info', vibrate?: number[], filter?: (p: Player) => boolean) {
    for (const p of this.players.values()) if (!filter || filter(p)) this.toast(p, text, kind, vibrate);
  }

  // ---- socket entry points -------------------------------------------------

  attach(ws: WebSocket, p: Player) {
    p.sockets.add(ws);
    p.lastSeen = this.wallNow();
    this.lastActivity = this.wallNow();
    this.dirty = true;
  }

  detach(ws: WebSocket, p: Player) {
    p.sockets.delete(ws);
    this.watchers.delete(ws);
    this.dirty = true;
  }

  handle(p: Player, msg: ClientMsg) {
    p.lastSeen = this.wallNow();
    this.lastActivity = this.wallNow();
    switch (msg.t) {
      case 'pos':
        return this.updatePos(p, msg.lat, msg.lng, msg.acc);
      case 'act':
        return this.act(p, msg.action, typeof msg.code === 'string' ? msg.code.trim().slice(0, 8) : undefined);
      case 'scan':
        if (this.phase !== 'live' || !p.plays) return;
        this.module.scan?.(this, p, String(msg.qr ?? '').slice(0, 64));
        this.dirty = true;
        this.checkEnd();
        return;
      case 'host':
        if (!p.isHost) throw new GameError('Only the host can do that');
        return this.hostCmd(msg);
      case 'sos':
        p.sos = !!msg.on;
        this.record('sos', { p: p.id, on: p.sos });
        if (p.sos) {
          this.log(`🆘 ${p.name} needs help!`, 'alert');
          for (const h of this.players.values()) if (h.isHost) this.toast(h, `🆘 SOS from ${p.name}. Check the map.`, 'alert', [500, 200, 500, 200, 500]);
        } else this.log(`${p.name} cancelled SOS`, 'info');
        this.dirty = true;
        return;
    }
  }

  updatePos(p: Player, lat: number, lng: number, acc: number, at = this.wallNow()) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
    acc = Number.isFinite(acc) ? Math.max(1, acc) : 50;
    if (!p.isBot && this.phase === 'live') {
      const g = p.gps;
      if (g.lastAt !== null) {
        const gap = at - g.lastAt;
        if (gap > FIX_STALE_MS) g.gaps++;
        g.longestGapMs = Math.max(g.longestGapMs, gap);
      }
      g.fixes++;
      g.accSum += acc;
      g.lastAt = at;
    }
    // A bad fix (> 50 m) only replaces a stale one; otherwise keep the last good fix.
    if (acc > 50 && p.pos && at - p.pos.at < FIX_STALE_MS) return;
    if (p.pos && !p.isBot) {
      const dt = (at - p.pos.at) / 1000;
      const d = distance(p.pos, { lat, lng });
      // Sustained > 12 m/s (43 km/h) with a decent fix = vehicle or spoofing.
      if (dt > 1 && d / dt > 12 && acc < 30 && d > 60) {
        if (!p.suspicious) this.log(`⚠️ ${p.name} is moving suspiciously fast`, 'alert');
        p.suspicious = true;
      }
      // Light smoothing: weight new fix by its accuracy relative to the old one.
      const w = Math.min(1, Math.max(0.3, p.pos.acc / (p.pos.acc + acc)));
      if (dt < 5) {
        lat = p.pos.lat + (lat - p.pos.lat) * w;
        lng = p.pos.lng + (lng - p.pos.lng) * w;
      }
    }
    p.pos = { lat, lng, acc, at };
    const inside = inBoundary(p.pos, this.boundary);
    const playing = this.phase === 'live' && p.plays && p.status !== 'eliminated';
    if (inside) {
      if (p.outSince !== null && playing) {
        this.record('out', { p: p.id, outcome: 'back', secs: Math.round((this.now() - p.outSince) / 1000) });
        this.toast(p, '✅ Back inside the play area. Keep going!', 'good', [80]);
      }
      p.outSince = null;
    } else if (p.outSince === null && acc <= OUT_MAX_ACC) {
      p.outSince = this.now();
      if (playing) this.warnOut(p);
    }
    this.dirty = true;
  }

  hasFreshFix(p: Player): boolean {
    return !!p.pos && this.wallNow() - p.pos.at < FIX_STALE_MS;
  }

  /** Distance between two players, or null if either has no fresh fix. */
  dist(a: Player, b: Player): number | null {
    if (!this.hasFreshFix(a) || !this.hasFreshFix(b)) return null;
    return distance(a.pos!, b.pos!);
  }

  /**
   * Anti-cheat for tags: reject only when both phones have a good fix and are
   * clearly too far apart. A poor or missing fix gets the benefit of the doubt.
   */
  tagPlausible(a: Player, b: Player, max: number): boolean {
    const d = this.dist(a, b);
    if (d === null) return true;
    if (a.pos!.acc > 35 || b.pos!.acc > 35) return true;
    return d - (a.pos!.acc + b.pos!.acc) / 2 <= max;
  }

  isOut(p: Player): boolean {
    return p.outSince !== null;
  }

  private warnOut(p: Player) {
    this.record('out', { p: p.id, outcome: 'warned' });
    this.toast(p, `⚠️ You're outside the play area! Get back inside within ${OUT_GRACE_SECS} s or you're out.`, 'alert', [300, 100, 300, 100, 300]);
  }

  /** Outside the play area past the grace time: out of the round, no points. */
  private eliminate(p: Player) {
    p.status = 'eliminated';
    p.outSince = null;
    this.module.playerOut?.(this, p);
    this.record('out', { p: p.id, outcome: 'eliminated' });
    this.log(`🚫 ${p.name} stayed outside the play area and is out`, 'alert');
    this.toast(p, `🚫 You were outside the play area for ${OUT_GRACE_SECS} s. You're out of this round.`, 'bad', [600, 200, 600]);
    this.dirty = true;
  }

  cooldown(p: Player, key: string): number {
    return Math.max(0, (p.cooldowns[key] ?? 0) - this.now());
  }

  setCooldown(p: Player, key: string, secs: number) {
    p.cooldowns[key] = this.now() + secs * 1000;
  }

  bump(p: Player, stat: string, by = 1) {
    p.stats[stat] = (p.stats[stat] ?? 0) + by;
  }

  private act(p: Player, action: string, code?: string) {
    if (this.phase !== 'live') throw new GameError(this.phase === 'paused' ? 'Game is paused' : 'Game is not running');
    if (!p.plays) throw new GameError('Hosts who are not playing cannot do that');
    if (p.status === 'eliminated') throw new GameError("You're out of this round");
    const def = this.module.actions(this, p).find((a) => a.id === action);
    if (!def || def.disabled) throw new GameError('You cannot do that right now');
    if (def.cooldownUntil && def.cooldownUntil > this.now()) {
      throw new GameError(`Wait ${Math.ceil((def.cooldownUntil - this.now()) / 1000)} s`);
    }
    this.module.action(this, p, action, code);
    this.dirty = true;
    this.checkEnd();
  }

  /** Seconds left on the round clock, for the log. */
  private secsLeft() {
    return this.endsAt === null ? null : Math.max(0, Math.round((this.endsAt - this.now()) / 1000));
  }

  private hostCmd(c: HostCmd) {
    switch (c.cmd) {
      case 'start':
        return this.start();
      case 'pause':
        if (this.phase !== 'live') return;
        this.pausedAt = this.wallNow();
        this.phase = 'paused';
        this.record('host', { action: 'pause', left: this.secsLeft() });
        this.log('⏸️ Game paused by host', 'alert');
        this.toastAll('⏸️ Game paused. Stay where you are.', 'alert', [200, 100, 200]);
        return;
      case 'resume':
        if (this.phase !== 'paused' || this.pausedAt === null) return;
        this.pausedTotal += this.wallNow() - this.pausedAt;
        this.pausedAt = null;
        this.phase = 'live';
        this.record('host', { action: 'resume' });
        this.log('▶️ Game resumed', 'good');
        this.toastAll('▶️ Game on!', 'good', [200]);
        return;
      case 'end':
        if (this.phase === 'live' || this.phase === 'paused' || this.phase === 'countdown') {
          this.endReason = isEndReason(c.reason) ? c.reason : null;
          this.record('host', { action: 'end', reason: this.endReason, left: this.secsLeft() });
          this.finish('host');
        }
        return;
      case 'rematch':
        return this.resetToLobby();
      case 'kick':
        return this.removePlayer(c.target, 'removed');
      case 'addBots':
        return this.addBots(c.n);
      case 'removeBots':
        for (const p of [...this.players.values()]) if (p.isBot) this.removePlayer(p.id);
        this.log('Bots removed', 'info');
        return;
      case 'clearSos': {
        const p = this.players.get(c.target);
        if (p) p.sos = false;
        this.dirty = true;
        return;
      }
    }
  }

  // ---- lifecycle ----------------------------------------------------------

  start() {
    if (this.phase !== 'lobby') throw new GameError('Game already started');
    const n = this.activePlayers().length;
    if (n < this.meta.minPlayers) throw new GameError(`Need at least ${this.meta.minPlayers} players (have ${n}). Add bots to test.`);
    if (this.entry) {
      // Players who haven't paid by the start sit this round out and watch. Bots play for free (and can't win).
      const unpaid = this.activePlayers().filter((p) => !p.isBot && !this.entry!.paid.has(p.id));
      const playing = this.activePlayers().length - unpaid.length;
      if (playing < this.meta.minPlayers) throw new GameError(`Need at least ${this.meta.minPlayers} players who paid the entry (have ${playing}).`);
      for (const p of unpaid) {
        p.plays = false;
        p.sitOut = true;
        p.status = 'spectating';
        p.role = null;
        this.toast(p, "💵 You didn't pay the entry, so you're watching this round.", 'info');
      }
      if (unpaid.length) this.log(`💵 Sitting out (not paid): ${unpaid.map((p) => p.name).join(', ')}`, 'info');
    }
    this.module.deal?.(this);
    this.phase = 'countdown';
    this.countdownEndsAt = this.wallNow() + COUNTDOWN_MS;
    this.result = null;
    this.log('Get ready…', 'info');
    this.toastAll('Game starting in 5…', 'alert', [100, 100, 100]);
    this.dirty = true;
  }

  private goLive() {
    this.phase = 'live';
    this.countdownEndsAt = null;
    this.startedAt = this.now();
    for (const p of this.players.values()) {
      p.stats = {};
      p.cooldowns = {};
      if (p.plays) p.status = 'active';
    }
    this.state = this.module.init(this);
    this.journal = [];
    this.endReason = null;
    const wall = this.wallNow();
    for (const p of this.activePlayers()) {
      p.gps = freshGps(wall);
      // Outside when the round starts: the grace time starts now, not when they wandered out in the lobby.
      if (p.outSince !== null) {
        p.outSince = this.now();
        this.warnOut(p);
      }
    }
    this.record('start', {
      config: this.config,
      players: this.activePlayers().map((p) => ({ id: p.id, name: p.name, team: p.team, vest: p.vest, noVest: p.noVest, bot: p.isBot, profile: p.profileId })),
    });
    this.log(`${this.meta.emoji} ${this.meta.name} has started!`, 'good');
    for (const p of this.players.values()) {
      if (!p.plays) continue;
      this.toast(p, this.module.roleIntro(this, p), 'good', [400]);
    }
    this.dirty = true;
  }

  checkEnd() {
    if (this.phase !== 'live') return;
    const why = this.module.checkEnd(this);
    if (why) this.finish(why);
  }

  finish(reason: string) {
    if (this.phase === 'ended') return;
    if (this.pausedAt !== null) {
      this.pausedTotal += this.wallNow() - this.pausedAt;
      this.pausedAt = null;
    }
    this.phase = 'ended';
    const wall = this.wallNow();
    for (const p of this.activePlayers()) {
      if (p.isBot) continue;
      const g = p.gps;
      // A phone that went quiet before the end: count the trailing gap too.
      const tail = g.lastAt === null ? 0 : wall - g.lastAt;
      this.record('gps', {
        p: p.id,
        fixes: g.fixes,
        gaps: g.gaps + (tail > FIX_STALE_MS ? 1 : 0),
        longestGap: Math.round(Math.max(g.longestGapMs, tail) / 1000),
        avgAcc: g.fixes ? Math.round(g.accSum / g.fixes) : null,
      });
    }
    this.record('end', { reason, hostReason: this.endReason });
    const result = this.module.finish(this, reason);
    result.endedAt = this.wallNow();
    this.result = result;
    this.log(`🏁 ${result.headline}`, 'good');
    this.toastAll(`🏁 ${result.headline}`, 'good', [300, 100, 300, 100, 600]);
    this.dirty = true;
    try {
      this.hooks.onEnd?.(this, result);
    } catch (e) {
      console.error('onEnd hook failed', e);
    }
  }

  resetToLobby() {
    if (this.phase !== 'ended' && this.phase !== 'lobby') throw new GameError('End the game first');
    this.phase = 'lobby';
    this.state = null;
    this.result = null;
    this.startedAt = this.endsAt = null;
    this.pausedTotal = 0;
    for (const p of this.players.values()) {
      // Back in for the rematch: they can pay this time.
      if (p.sitOut) {
        p.sitOut = false;
        p.plays = true;
      }
      if (!p.plays) continue;
      // Teams are dealt again when the rematch starts.
      p.team = p.role = null;
      p.status = 'active';
      p.stats = {};
      p.sos = false;
    }
    this.endReason = null;
    // New teams: watchers pick a new bot of their team once they're dealt.
    for (const w of this.watchers.values()) w.id = null;
    // A rematch is a new round with its own pot: everyone pays again.
    if (this.entry) {
      const round = this.entry.round + 1;
      this.entry = { ...this.entry, round, id: roundId(this.code, this.createdAt, round), paid: new Map() };
    }
    this.log('🔁 Back to the lobby for a rematch', 'info');
  }

  tick() {
    const wall = this.wallNow();
    if (this.phase === 'countdown' && this.countdownEndsAt !== null && wall >= this.countdownEndsAt) this.goLive();
    if (this.phase === 'live') {
      for (const p of this.players.values()) {
        if (!p.plays || p.status === 'eliminated' || p.outSince === null) continue;
        // Only on a fresh fix: a phone that went quiet outside isn't proof they stayed out.
        if (this.now() - p.outSince >= OUT_GRACE_SECS * 1000 && this.hasFreshFix(p)) this.eliminate(p);
      }
      this.moveBots(wall);
      this.module.tick(this);
      this.checkEnd();
    } else if (this.phase === 'lobby') {
      this.moveBots(wall);
    }
  }

  private moveBots(wall: number) {
    for (const b of this.players.values()) {
      if (!b.bot || !b.pos) continue;
      const brain = b.bot;
      if (this.phase === 'live' && wall >= brain.nextThinkAt) {
        brain.nextThinkAt = wall + (800 + Math.random() * 700) / this.speed;
        this.module.botThink?.(this, b);
      }
      if (brain.target && brain.hold && distance(b.pos, brain.target) < 4) {
        this.updatePos(b, b.pos.lat, b.pos.lng, b.pos.acc, wall);
        continue;
      }
      if (!brain.target || distance(b.pos, brain.target) < 4) {
        brain.hold = false;
        brain.target = this.phase === 'lobby' ? offset(boundaryCenter(this.boundary), Math.random() * 20, Math.random() * 360) : randomPointIn(this.boundary, Math.random, 10);
      }
      const dt = Math.min(2, (wall - b.pos.at) / 1000);
      const speed = this.phase === 'lobby' ? 0.6 : brain.speed * this.speed;
      const d = distance(b.pos, brain.target);
      const step = Math.min(d, speed * dt);
      const next = step > 0 ? offset(b.pos, step, bearing(b.pos, brain.target)) : b.pos;
      // Bots stay inside the boundary unless the game sends them elsewhere.
      const pos = inBoundary(next, this.boundary) || !inBoundary(b.pos, this.boundary) ? next : b.pos;
      if (pos === b.pos) brain.target = null;
      this.updatePos(b, pos.lat, pos.lng, 6 + Math.random() * 6, wall);
    }
  }

  /** Called by the server loop; returns true if a broadcast is due. */
  shouldBroadcast(): boolean {
    const wall = this.wallNow();
    if (this.dirty || wall - this.lastBroadcast >= 1000) {
      this.dirty = false;
      this.lastBroadcast = wall;
      return true;
    }
    return false;
  }

  broadcast() {
    for (const p of this.players.values()) {
      if (!p.sockets.size) continue;
      let msg: string | null = null;
      for (const ws of p.sockets) {
        if (ws.readyState !== 1) continue;
        if (this.watchers.has(ws)) this.send(ws, { t: 'view', view: this.viewForSocket(ws, p) });
        else ws.send((msg ??= JSON.stringify({ t: 'view', view: this.viewFor(p) } satisfies ServerMsg)));
      }
    }
  }

  // ---- watching a simulation through a bot's eyes ---------------------------

  /** See the game through a bot of `team` (a different one if already on that team), or null for the referee map. */
  watch(ws: WebSocket, p: Player, team: Team | null) {
    if (!p.isHost || !this.sim) throw new GameError('Only the host of a simulation can watch through a bot');
    if (team !== 'zombie' && team !== 'survivor') this.watchers.delete(ws);
    else {
      const cur = this.watchers.get(ws);
      this.watchers.set(ws, { team, id: this.pickWatched(team, cur?.team === team ? cur.id : null) });
    }
    this.send(ws, { t: 'view', view: this.viewForSocket(ws, p) });
  }

  private pickWatched(team: Team, not: string | null): string | null {
    const pool = this.activePlayers().filter((q) => q.isBot && q.role === team && q.status !== 'eliminated');
    const others = pool.filter((q) => q.id !== not);
    const from = others.length ? others : pool;
    return from.length ? from[Math.floor(Math.random() * from.length)].id : null;
  }

  /** The view for one socket: the bot it watches (and keeps following, even after an infection), else its own. */
  private viewForSocket(ws: WebSocket, p: Player): RoomView {
    const w = this.watchers.get(ws);
    if (!w) return this.viewFor(p);
    if (!w.id || !this.players.has(w.id)) w.id = this.pickWatched(w.team, null);
    const bot = w.id ? this.players.get(w.id) : undefined;
    // No bot on that team yet (teams are dealt when the countdown starts): the host's own view until then.
    if (!bot) return this.viewFor(p);
    return { ...this.viewFor(bot), watching: { id: bot.id, name: bot.name } };
  }

  // ---- views ----------------------------------------------------------------

  summary(p: Player, viewer: Player): PlayerSummary {
    const s: PlayerSummary = {
      id: p.id,
      name: p.name,
      isBot: p.isBot,
      isHost: p.isHost,
      connected: p.isBot || p.sockets.size > 0,
      role: p.role,
      status: p.status,
      sos: p.sos,
    };
    if (viewer.isHost || viewer.id === p.id) {
      s.vest = p.vest;
      s.noVest = p.noVest;
      s.gpsAgeSec = p.pos ? Math.round((this.wallNow() - p.pos.at) / 1000) : undefined;
      s.gpsAcc = p.pos ? Math.round(p.pos.acc) : undefined;
      s.suspicious = p.suspicious;
    }
    if (viewer.isHost && p.plays) s.catchCode = p.catchCode;
    if (this.entry) s.paid = this.entry.paid.has(p.id);
    return s;
  }

  /** Map marker for player `p` as seen by `viewer`. */
  playerMarker(p: Player, viewer: Player, extra: Partial<MapMarker> = {}): MapMarker | null {
    if (!p.pos) return null;
    const self = p.id === viewer.id;
    return {
      id: `p:${p.id}`,
      kind: 'player',
      lat: p.pos.lat,
      lng: p.pos.lng,
      label: self ? 'You' : p.name,
      self,
      color: this.module.colorFor(this, p),
      emoji: this.module.emojiFor(this, p),
      faded: !this.hasFreshFix(p),
      ...extra,
    };
  }

  viewFor(p: Player): RoomView {
    const wall = this.wallNow();
    const live = this.phase === 'live' || this.phase === 'paused';
    const ended = this.phase === 'ended';
    let markers: MapMarker[] = [];
    if (live) markers = this.module.markers(this, p);
    else {
      // Lobby / countdown / ended: everyone sees everyone (it's a meet-up).
      for (const q of this.players.values()) {
        const m = this.playerMarker(q, p);
        if (m && (q.plays || q.id === p.id)) markers.push(m);
      }
    }
    if (!markers.some((m) => m.self) && p.pos) {
      const m = this.playerMarker(p, p);
      if (m) markers.push(m);
    }
    for (const q of this.players.values()) {
      if (q.sos && q.pos && (p.isHost || q.id === p.id)) {
        markers.push({ id: `sos:${q.id}`, kind: 'sos', lat: q.pos.lat, lng: q.pos.lng, radius: 20, color: '#e8452c', emoji: '🆘', label: `SOS ${q.name}` });
      }
    }
    const actions: ActionDef[] = this.phase === 'live' && p.plays ? this.module.actions(this, p) : [];
    for (const a of actions) if (a.cooldownUntil) a.cooldownUntil = this.wall(a.cooldownUntil)!;
    const players = [...this.players.values()]
      .filter((q) => q.plays || q.isHost)
      .map((q) => this.summary(q, p));
    return {
      code: this.code,
      game: this.game,
      title: this.title,
      phase: this.phase,
      config: this.config,
      boundary: this.boundary,
      serverNow: this.phase === 'paused' && this.pausedAt ? this.pausedAt : wall,
      startedAt: this.wall(this.startedAt),
      endsAt: this.phase === 'countdown' ? this.countdownEndsAt : live || ended ? this.wall(this.endsAt) : null,
      stage:
        this.phase === 'countdown'
          ? { key: 'countdown', label: 'Starting in', endsAt: this.countdownEndsAt }
          : live
            ? this.module.stage(this, p)
            : null,
      me: {
        id: p.id,
        name: p.name,
        vest: p.vest,
        role: p.role,
        status: p.status,
        isHost: p.isHost,
        plays: p.plays,
        outOfBounds: p.outSince !== null,
        outDeadline: live && p.outSince !== null && p.status !== 'eliminated' ? this.wall(p.outSince + OUT_GRACE_SECS * 1000) : null,
        catchCode: p.role === 'zombie' && p.status !== 'eliminated' && (live || this.phase === 'countdown') ? p.catchCode : null,
        gpsOk: this.hasFreshFix(p) && p.pos!.acc <= 50,
        actions,
        hint: live && p.plays ? this.module.hint(this, p) : '',
        vestQr: p.plays ? vestQr(p.vest) : null,
        noVest: p.noVest,
      },
      players,
      markers,
      hud: live || ended ? this.module.hud(this, p) : { kind: 'none' },
      feed: this.feed.slice(-25),
      result: this.result,
      entry: this.entry
        ? {
            fee: ENTRY_USDC,
            pot: this.entry.paid.size * ENTRY_USDC,
            paid: this.entry.paid.size,
            myPaid: this.entry.paid.has(p.id),
            round: this.entry.id,
            pool: this.entry.pool,
            explorer: EXPLORER,
          }
        : null,
      sim: this.sim ? { speed: this.speed } : null,
    };
  }
}
