import {
  BIB_RE,
  GAMES,
  OUT_GRACE_SECS,
  boundaryCenter,
  cleanName,
  distance,
  inBoundary,
  randomPointIn,
  type ActionDef,
  type Boundary,
  type EndReason,
  type FeedItem,
  type GameId,
  type GameResult,
  type GpsHealth,
  type HostCmd,
  type LatLng,
  type MapMarker,
  type MeView,
  type Phase,
  type PlayerSummary,
  type Role,
  type RoomView,
  type ServerMsg,
  type SoundCue,
  type Status,
  type Team,
  type ToastKind,
} from '@runnn/shared';
import { MODULES, type GameModule } from './games/index.ts';
import { GameError, botName, freshClaimCode, token } from './games/util.ts';

export const COUNTDOWN_MS = 5000;
export const FIX_STALE_MS = 20_000;
export const OUT_MAX_ACC = 30;
export const MAX_PLAYERS = 200;
export const MAX_BOTS = 60;
const FEED_MAX = 25;
const JOURNAL_MAX = 5000;
const IMPLAUSIBLE_MPS = 12;

/** The bits of a WebSocket the room needs; tests pass fakes. */
export interface Sock {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface BotBrain {
  target: LatLng | null;
  speed: number;
  nextThinkAt: number;
  lastMoveAt: number;
}

export interface Player {
  id: string;
  /** Reconnect credential, never shown to others. */
  secret: string;
  name: string;
  bib: string;
  isBot: boolean;
  isHost: boolean;
  noBib: boolean;
  plays: boolean;
  profileId: string | null;
  /** Dealt side: decides who won. */
  team: Team | null;
  /** Current side: a converted runner becomes a hunter. */
  role: Role | null;
  status: Status;
  stats: Record<string, number>;
  pos: { lat: number; lng: number; acc: number; at: number } | null;
  /** Game clock; null while inside the area. */
  outSince: number | null;
  /** Private 4 digits, unique in the room. */
  claimCode: string;
  gps: GpsHealth;
  sos: boolean;
  suspicious: boolean;
  /** A Set: the same player on phone and laptop. */
  sockets: Set<Sock>;
  cooldowns: Record<string, number>;
  /** Opaque radar key. */
  blip: string;
  bot: BotBrain | null;
  joinedAt: number;
  lastScanAt: number;
  /** Simulation spectating: which side the organiser looks through. */
  watching: Team | null;
  watchId: string | null;
}

export interface RoomOptions {
  game: GameId;
  title: string;
  boundary: Boundary;
  config: Record<string, number>;
  sim?: boolean;
  speed?: number;
  eventId?: string | null;
  organiserPlays?: boolean;
  organiserProfileId?: string | null;
}

export interface RoomHooks {
  /** Persist a finished round. Returns XP per player id. */
  onFinish?(room: Room, result: GameResult): Map<string, number> | void;
}

export interface JoinInput {
  name?: unknown;
  bib?: unknown;
  playerId?: unknown;
  secret?: unknown;
  organiserKey?: unknown;
  profileId?: string | null;
  spectate?: boolean;
}

export interface JournalEntry {
  t: number;
  kind: string;
  [k: string]: unknown;
}

export class Room {
  readonly game: GameId;
  readonly module: GameModule;
  readonly sim: boolean;
  readonly organiserKey = token(12);
  readonly createdAt: number;
  title: string;
  boundary: Boundary;
  config: Record<string, number>;
  eventId: string | null;
  organiserPlays: boolean;
  organiserProfileId: string | null;

  players = new Map<string, Player>();
  phase: Phase = 'lobby';
  /** Game clock instants. */
  startedAt: number | null = null;
  endsAt: number | null = null;
  countdownEndsAt: number | null = null;
  state: any = null;
  result: GameResult | null = null;
  journal: JournalEntry[] = [];
  feed: FeedItem[] = [];
  lastActivity: number;
  speed: number;

  private feedSeq = 0;
  private gameAnchor: number;
  private wallAnchor: number;
  private pausedAt: number | null = null;
  private pausedTotal = 0;
  private dirty = true;
  private lastBroadcast = 0;
  private botSeq = 0;

  constructor(
    readonly code: string,
    opts: RoomOptions,
    private hooks: RoomHooks = {},
    readonly wallNow: () => number = Date.now,
  ) {
    this.game = opts.game;
    this.module = MODULES[opts.game];
    this.title = opts.title;
    this.boundary = opts.boundary;
    this.config = opts.config;
    this.sim = !!opts.sim;
    this.speed = this.sim ? clampSpeed(opts.speed ?? 1) : 1;
    this.eventId = opts.eventId ?? null;
    this.organiserPlays = !!opts.organiserPlays && !this.sim;
    this.organiserProfileId = opts.organiserProfileId ?? null;
    this.createdAt = this.lastActivity = this.gameAnchor = this.wallAnchor = wallNow();
  }

  // ───────────────────────────── clocks ─────────────────────────────

  private effWall(): number {
    return (this.pausedAt ?? this.wallNow()) - this.pausedTotal;
  }

  /** Game clock: stands still while paused, runs `speed`× in simulations. All game timers use this. */
  now(): number {
    return this.gameAnchor + (this.effWall() - this.wallAnchor) * this.speed;
  }

  /** Game-clock instant → wall clock, for clients. */
  wall(t: number): number;
  wall(t: number | null): number | null;
  wall(t: number | null): number | null {
    return t === null ? null : Math.round(this.wallAnchor + (t - this.gameAnchor) / this.speed + this.pausedTotal);
  }

  /** Server time as clients should see it: frozen while paused. */
  serverNow(): number {
    return this.pausedAt ?? this.wallNow();
  }

  setSpeed(speed: number) {
    if (!this.sim) throw new GameError('Speed only changes in simulations.');
    const g = this.now();
    this.wallAnchor = this.effWall();
    this.gameAnchor = g;
    this.speed = clampSpeed(speed);
    this.touch();
  }

  // ───────────────────────────── bookkeeping ─────────────────────────────

  touch() {
    this.dirty = true;
  }

  record(kind: string, data: Record<string, unknown> = {}) {
    if (this.journal.length >= JOURNAL_MAX) return;
    const t = this.startedAt === null ? 0 : Math.round((this.now() - this.startedAt) / 100) / 10;
    this.journal.push({ t, kind, ...data });
  }

  post(text: string, kind: ToastKind = 'info') {
    this.feed.push({ id: ++this.feedSeq, at: this.serverNow(), text, kind });
    if (this.feed.length > FEED_MAX) this.feed.splice(0, this.feed.length - FEED_MAX);
    this.touch();
  }

  send(p: Player, msg: ServerMsg) {
    if (!p.sockets.size) return;
    const s = JSON.stringify(msg);
    for (const ws of p.sockets) if (ws.readyState === 1) ws.send(s);
  }

  toast(p: Player, text: string, kind: ToastKind = 'info', vibrate?: number[], sound?: SoundCue) {
    this.send(p, { t: 'toast', text, kind, vibrate, sound });
  }

  toastAll(text: string, kind: ToastKind = 'info', vibrate?: number[], sound?: SoundCue, filter?: (p: Player) => boolean) {
    for (const p of this.players.values()) if (!filter || filter(p)) this.toast(p, text, kind, vibrate, sound);
  }

  setCooldown(p: Player, key: string, secs: number) {
    p.cooldowns[key] = this.now() + secs * 1000;
  }

  onCooldown(p: Player, key: string): boolean {
    return (p.cooldowns[key] ?? 0) > this.now();
  }

  // ───────────────────────────── players ─────────────────────────────

  host(): Player | null {
    for (const p of this.players.values()) if (p.isHost) return p;
    return null;
  }

  activePlayers(): Player[] {
    return [...this.players.values()].filter((p) => p.plays && p.status !== 'eliminated' && p.status !== 'spectating');
  }

  playing(): Player[] {
    return [...this.players.values()].filter((p) => p.plays);
  }

  findByBib(bib: string): Player | null {
    for (const p of this.players.values()) if (!p.noBib && p.bib === bib) return p;
    return null;
  }

  findByClaimCode(code: string): Player | null {
    for (const p of this.players.values()) if (p.claimCode === code) return p;
    return null;
  }

  private claimCodes(except?: Player): Set<string> {
    const s = new Set<string>();
    for (const p of this.players.values()) if (p !== except) s.add(p.claimCode);
    return s;
  }

  private newPlayer(fields: Partial<Player> & { name: string }): Player {
    const p: Player = {
      id: token(8),
      secret: token(16),
      bib: '',
      isBot: false,
      isHost: false,
      noBib: true,
      plays: true,
      profileId: null,
      team: null,
      role: null,
      status: 'active',
      stats: {},
      pos: null,
      outSince: null,
      claimCode: freshClaimCode(this.claimCodes()),
      gps: { fixes: 0, gaps: 0, bestAcc: null, worstAcc: null, lastAt: null },
      sos: false,
      suspicious: false,
      sockets: new Set(),
      cooldowns: {},
      blip: token(6),
      bot: null,
      joinedAt: this.wallNow(),
      lastScanAt: 0,
      watching: null,
      watchId: null,
      ...fields,
    };
    if (!p.plays) {
      p.role = 'organiser';
      p.status = 'spectating';
    }
    this.players.set(p.id, p);
    return p;
  }

  /** Join is also reconnect: resume with id + secret, claim the organiser seat, or create a new player. */
  join(input: JoinInput): { player: Player; resumed: boolean } {
    this.lastActivity = this.wallNow();
    if (typeof input.playerId === 'string' && typeof input.secret === 'string') {
      const p = this.players.get(input.playerId);
      if (p && p.secret === input.secret && !p.isBot) {
        if (input.profileId && !p.profileId) p.profileId = input.profileId;
        this.touch();
        return { player: p, resumed: true };
      }
    }

    if (typeof input.organiserKey === 'string' && input.organiserKey === this.organiserKey) {
      const existing = this.host();
      if (existing) return { player: existing, resumed: true };
      const name = cleanName(input.name) || 'Organiser';
      const plays = this.organiserPlays;
      const p = this.newPlayer({ name, isHost: true, plays, profileId: input.profileId ?? null });
      if (plays) this.assignBib(p, input.bib);
      this.post(`${name} opened the room`, 'info');
      this.record('join', { p: p.id, host: true });
      return { player: p, resumed: false };
    }

    if (this.players.size >= MAX_PLAYERS) throw new GameError('This game is full.');
    const name = cleanName(input.name);
    if (!name) throw new GameError('Pick a name first.');
    if (input.spectate) throw new GameError('Only the organiser can watch.');
    if (this.sim) throw new GameError('Simulations are bots only.');
    const p = this.newPlayer({ name, profileId: input.profileId ?? null });
    try {
      this.assignBib(p, input.bib);
    } catch (e) {
      this.players.delete(p.id);
      throw e;
    }
    this.post(`${name} joined`, 'info');
    this.record('join', { p: p.id, bib: p.bib || null, late: this.phase !== 'lobby' });
    if (this.phase === 'countdown' || this.phase === 'live' || this.phase === 'paused') this.module.lateJoin(this, p);
    this.touch();
    return { player: p, resumed: false };
  }

  private assignBib(p: Player, raw: unknown) {
    const bib = typeof raw === 'string' ? raw.trim() : '';
    if (!bib) {
      p.noBib = true;
      p.bib = '';
      return;
    }
    if (!BIB_RE.test(bib)) throw new GameError('A bib number is 3 digits, like 104.');
    const other = this.findByBib(bib);
    if (other && other !== p) throw new GameError(`Bib ${bib} is already taken by ${other.name}.`);
    p.bib = bib;
    p.noBib = false;
  }

  attach(p: Player, ws: Sock) {
    p.sockets.add(ws);
    this.touch();
  }

  detach(p: Player, ws: Sock) {
    p.sockets.delete(ws);
    if (!p.sockets.size) this.module.playerLeft?.(this, p);
    this.touch();
  }

  private remove(p: Player, why: string) {
    for (const ws of p.sockets) {
      if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'error', msg: why, fatal: true } satisfies ServerMsg));
      ws.close(4000, 'removed');
    }
    p.sockets.clear();
    this.players.delete(p.id);
    this.touch();
  }

  // ───────────────────────────── host commands ─────────────────────────────

  hostCmd(by: Player, c: HostCmd) {
    if (!by.isHost) throw new GameError('Only the organiser can do that.');
    this.lastActivity = this.wallNow();
    switch (c.cmd) {
      case 'start':
        return this.start();
      case 'pause':
        return this.pause();
      case 'resume':
        return this.resume();
      case 'end':
        if (this.phase === 'lobby' || this.phase === 'ended') throw new GameError('No round is running.');
        return this.finish(isEndReason(c.reason) ? c.reason : 'organiser');
      case 'rematch':
        return this.rematch();
      case 'kick': {
        const t = this.players.get(c.target);
        if (!t || t.isHost) throw new GameError('Cannot remove that player.');
        this.record('host', { action: 'kick', target: t.id });
        this.post(`${t.name} was removed`, 'bad');
        this.module.playerLeft?.(this, t);
        return this.remove(t, 'The organiser removed you from this game.');
      }
      case 'addBots':
        return this.addBots(Math.max(1, Math.min(20, Math.round(Number(c.n) || 1))));
      case 'removeBots': {
        if (this.phase !== 'lobby' && this.phase !== 'ended') throw new GameError('Remove bots between rounds.');
        for (const p of [...this.players.values()]) if (p.isBot) this.players.delete(p.id);
        return this.touch();
      }
      case 'clearSos': {
        const t = this.players.get(c.target);
        if (t?.sos) {
          t.sos = false;
          this.record('sos', { p: t.id, outcome: 'cleared' });
          this.toast(t, 'The organiser has seen your SOS.', 'good', [100]);
          this.touch();
        }
        return;
      }
      case 'speed':
        return this.setSpeed(Number(c.speed));
    }
  }

  start() {
    if (this.phase !== 'lobby') throw new GameError('The round already started.');
    const meta = GAMES[this.game];
    const players = this.playing();
    if (players.length < meta.minPlayers) throw new GameError(`${meta.name} needs at least ${meta.minPlayers} players.`);
    for (const p of players) {
      p.status = 'active';
      p.stats = {};
      p.outSince = null;
      p.cooldowns = {};
    }
    this.module.deal?.(this);
    this.phase = 'countdown';
    this.countdownEndsAt = this.now() + COUNTDOWN_MS;
    for (const p of this.players.values()) this.toast(p, this.module.roleIntro(this, p), 'alert', [200, 100, 200], 'start');
    this.touch();
  }

  private goLive() {
    this.phase = 'live';
    this.startedAt = this.now();
    this.endsAt = this.startedAt + (this.config.durationSecs ?? 1200) * 1000;
    this.countdownEndsAt = null;
    this.state = this.module.init(this);
    this.record('start', {
      config: this.config,
      roster: this.playing().map((p) => ({ p: p.id, name: p.name, team: p.team, bib: p.bib || null, bot: p.isBot })),
    });
    this.post('The round is live', 'alert');
    this.touch();
  }

  pause() {
    if (this.phase !== 'live') throw new GameError('Only a live round can be paused.');
    this.pausedAt = this.wallNow();
    this.phase = 'paused';
    this.record('host', { action: 'pause' });
    this.post('Paused by the organiser', 'alert');
    this.toastAll('Game paused. Stay where you are.', 'alert', [300]);
  }

  resume() {
    if (this.phase !== 'paused' || this.pausedAt === null) throw new GameError('The round is not paused.');
    this.pausedTotal += this.wallNow() - this.pausedAt;
    this.pausedAt = null;
    this.phase = 'live';
    this.record('host', { action: 'resume' });
    this.post('Resumed', 'alert');
    this.toastAll('Game on!', 'alert', [150, 80, 150]);
  }

  rematch() {
    if (this.phase !== 'ended') throw new GameError('Finish this round first.');
    this.phase = 'lobby';
    this.result = null;
    this.state = null;
    this.startedAt = this.endsAt = null;
    this.journal = [];
    const taken = new Set<string>();
    for (const p of this.players.values()) {
      p.team = null;
      p.role = p.plays ? null : 'organiser';
      p.status = p.plays ? 'active' : 'spectating';
      p.stats = {};
      p.outSince = null;
      p.sos = false;
      p.suspicious = false;
      p.cooldowns = {};
      p.gps = { fixes: 0, gaps: 0, bestAcc: null, worstAcc: null, lastAt: p.gps.lastAt };
      p.claimCode = freshClaimCode(taken);
      taken.add(p.claimCode);
      p.blip = token(6);
    }
    this.post('Back in the lobby for another round', 'info');
  }

  addBots(n: number) {
    if (this.phase !== 'lobby') throw new GameError('Add bots in the lobby.');
    const have = [...this.players.values()].filter((p) => p.isBot).length;
    const add = Math.min(n, MAX_BOTS - have, MAX_PLAYERS - this.players.size);
    if (add <= 0) throw new GameError('That is as many bots as this room can take.');
    for (let i = 0; i < add; i++) {
      let bib = '';
      for (let b = 999; b >= 100; b--) {
        const s = String(b);
        if (!this.findByBib(s)) {
          bib = s;
          break;
        }
      }
      const p = this.newPlayer({ name: botName(this.botSeq++), isBot: true, noBib: !bib, bib });
      const start = randomPointIn(this.boundary, Math.random, 10);
      p.bot = { target: null, speed: 1.3, nextThinkAt: 0, lastMoveAt: this.wallNow() };
      this.updatePos(p, start.lat, start.lng, 8);
    }
    this.post(`${add} bot${add === 1 ? '' : 's'} joined`, 'info');
  }

  // ───────────────────────────── player inputs ─────────────────────────────

  act(p: Player, action: string, code?: string) {
    if (this.phase !== 'live') throw new GameError(this.phase === 'paused' ? 'The game is paused.' : 'The round is not live.');
    const allowed = this.module.actions(this, p).find((a) => a.id === action);
    if (!allowed) throw new GameError('You cannot do that right now.');
    if (this.onCooldown(p, action)) throw new GameError('Wait a moment before trying again.');
    this.module.action(this, p, action, typeof code === 'string' ? code.trim() : undefined);
    this.touch();
  }

  scan(p: Player, qr: string) {
    if (this.phase !== 'live' || typeof qr !== 'string' || qr.length > 64) return;
    this.module.scan?.(this, p, qr);
  }

  setSos(p: Player, on: boolean) {
    if (p.sos === on) return;
    p.sos = on;
    this.record('sos', { p: p.id, outcome: on ? 'on' : 'off' });
    if (on) {
      const host = this.host();
      if (host && host !== p) this.toast(host, `SOS from ${p.name}!`, 'alert', [500, 200, 500, 200, 500], 'sos');
      this.toast(p, 'SOS sent to the organiser. Stay where you are.', 'alert', [300]);
    } else {
      this.toast(p, 'SOS cancelled.', 'info');
    }
    this.touch();
  }

  watch(p: Player, team: Team | null) {
    if (!p.isHost || p.plays) throw new GameError('Only the organiser can watch.');
    p.watching = team === 'hunter' || team === 'runner' ? team : null;
    p.watchId = null;
    this.touch();
  }

  // ───────────────────────────── positions ─────────────────────────────

  hasFreshFix(p: Player): boolean {
    return !!p.pos && this.wallNow() - p.pos.at < FIX_STALE_MS;
  }

  dist(a: Player, b: Player): number | null {
    if (!a.pos || !b.pos || !this.hasFreshFix(a) || !this.hasFreshFix(b)) return null;
    return distance(a.pos, b.pos);
  }

  /** The only thing GPS may veto, and it defaults to trust. */
  tagPlausible(a: Player, b: Player, max: number): boolean {
    const d = this.dist(a, b);
    if (d === null) return true;
    if (a.pos!.acc > 35 || b.pos!.acc > 35) return true;
    return d - (a.pos!.acc + b.pos!.acc) / 2 <= max;
  }

  updatePos(p: Player, lat: number, lng: number, acc: number, at = this.wallNow()) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
    acc = Number.isFinite(acc) ? Math.max(1, Math.min(5000, acc)) : 50;

    const g = p.gps;
    if (g.lastAt !== null && at - g.lastAt > FIX_STALE_MS) g.gaps++;
    g.fixes++;
    g.lastAt = at;
    g.bestAcc = g.bestAcc === null ? acc : Math.min(g.bestAcc, acc);
    g.worstAcc = g.worstAcc === null ? acc : Math.max(g.worstAcc, acc);

    // A bad fix only replaces a stale one; otherwise keep the last good fix.
    if (acc > 50 && p.pos && at - p.pos.at < FIX_STALE_MS) return;

    if (p.pos) {
      const dt = (at - p.pos.at) / 1000;
      const moved = distance(p.pos, { lat, lng });
      if (!p.isBot && dt >= 2 && acc <= 20 && p.pos.acc <= 20 && moved / dt > IMPLAUSIBLE_MPS && !p.suspicious) {
        p.suspicious = true;
        this.record('gps', { p: p.id, outcome: 'implausible', mps: Math.round(moved / dt) });
      }
      // Light smoothing weighted by relative accuracy; raw fixes make dots teleport.
      if (dt < 5 && !p.isBot) {
        const w = Math.min(1, Math.max(0.3, p.pos.acc / (p.pos.acc + acc)));
        lat = p.pos.lat + (lat - p.pos.lat) * w;
        lng = p.pos.lng + (lng - p.pos.lng) * w;
      }
    }
    p.pos = { lat, lng, acc, at };
    this.touch();

    if (this.phase !== 'live' || !p.plays || p.status === 'eliminated' || p.status === 'spectating') return;
    const inside = inBoundary(p.pos, this.boundary);
    if (inside) {
      if (p.outSince !== null) {
        p.outSince = null;
        this.record('out', { p: p.id, outcome: 'back' });
        this.toast(p, 'Back inside. Phew.', 'good', [80]);
      }
    } else if (p.outSince === null && acc <= OUT_MAX_ACC) {
      // Only a decent fix may start the timer: GPS error near the edge is no reason to eliminate anyone.
      p.outSince = this.now();
      this.record('out', { p: p.id, outcome: 'warned' });
      this.toast(p, `You are outside the area! Get back in within ${OUT_GRACE_SECS} s.`, 'alert', [400, 150, 400], 'out');
    }
  }

  eliminate(p: Player, why: string) {
    if (p.status === 'eliminated') return;
    p.status = 'eliminated';
    p.outSince = null;
    this.module.playerOut?.(this, p);
    this.record('out', { p: p.id, outcome: 'eliminated', why });
    this.post(`${p.name} is out: ${why}`, 'bad');
    this.toast(p, `You are out for this round: ${why}.`, 'bad', [600], 'out');
    this.touch();
  }

  // ───────────────────────────── loop ─────────────────────────────

  tick() {
    const wall = this.wallNow();
    this.moveBots(wall);
    if (this.phase === 'countdown' && this.countdownEndsAt !== null && this.now() >= this.countdownEndsAt) this.goLive();
    if (this.phase !== 'live') return;

    this.module.tick(this);
    for (const p of this.players.values()) {
      if (p.outSince === null || p.status === 'eliminated') continue;
      // Only with a fresh fix: a quiet phone outside is not proof the person stayed out.
      if (this.now() - p.outSince >= OUT_GRACE_SECS * 1000 && this.hasFreshFix(p)) this.eliminate(p, 'left the area');
    }
    const end = this.module.checkEnd(this);
    if (end) this.finish(end);
  }

  finish(reason: EndReason) {
    if (this.phase === 'ended') return;
    if (this.phase === 'paused' && this.pausedAt !== null) {
      this.pausedTotal += this.wallNow() - this.pausedAt;
      this.pausedAt = null;
    }
    if (this.startedAt === null) {
      // Ended during the countdown: nothing was played.
      this.phase = 'lobby';
      this.countdownEndsAt = null;
      for (const p of this.players.values()) {
        p.team = null;
        p.role = p.plays ? null : 'organiser';
      }
      this.post('Countdown cancelled', 'info');
      return;
    }
    const result = this.module.finish(this, reason);
    this.record('gps', {
      health: this.playing()
        .filter((p) => !p.isBot)
        .map((p) => ({ p: p.id, ...p.gps })),
    });
    this.record('end', { reason, winner: result.winner });
    this.phase = 'ended';
    this.endsAt = this.now();
    this.result = result;
    if (!this.sim) {
      try {
        const xp = this.hooks.onFinish?.(this, result);
        if (xp) for (const r of result.rows) if (xp.has(r.playerId)) r.xp = xp.get(r.playerId);
      } catch (e) {
        console.error(`room ${this.code}: saving result failed`, e);
      }
    }
    this.post(result.headline, 'alert');
    for (const p of this.players.values()) {
      const row = result.rows.find((r) => r.playerId === p.id);
      const text = row ? (row.won ? 'You won! 🎉' : 'Round over.') : 'Round over.';
      this.toast(p, `${text} ${result.headline}`, row?.won ? 'good' : 'info', [300, 100, 300], 'end');
    }
  }

  private moveBots(wall: number) {
    for (const b of this.players.values()) {
      if (!b.bot || !b.pos) continue;
      const brain = b.bot;
      const dt = Math.min(2, (wall - brain.lastMoveAt) / 1000) * (this.phase === 'paused' ? 0 : this.speed);
      brain.lastMoveAt = wall;
      if (this.phase === 'live' && b.status !== 'eliminated' && wall >= brain.nextThinkAt) {
        brain.nextThinkAt = wall + (800 + Math.random() * 700) / this.speed;
        this.module.botThink?.(this, b);
      }
      if (dt <= 0) continue;
      if (!brain.target || distance(b.pos, brain.target) < 2) {
        brain.target = randomPointIn(this.boundary, Math.random, 8);
        brain.speed = 0.8 + Math.random() * 0.8;
      }
      const d = distance(b.pos, brain.target);
      const step = Math.min(d, brain.speed * dt);
      const k = d === 0 ? 0 : step / d;
      const lat = b.pos.lat + (brain.target.lat - b.pos.lat) * k;
      const lng = b.pos.lng + (brain.target.lng - b.pos.lng) * k;
      this.updatePos(b, lat, lng, 6 + Math.random() * 6, wall);
    }
  }

  // ───────────────────────────── views ─────────────────────────────

  shouldBroadcast(): boolean {
    const wall = this.wallNow();
    if (this.dirty || wall - this.lastBroadcast >= 1000) {
      this.dirty = false;
      this.lastBroadcast = wall;
      return true;
    }
    return false;
  }

  /** Serialise once per player, not once per socket. */
  broadcast() {
    for (const p of this.players.values()) {
      if (!p.sockets.size) continue;
      let msg: string | null = null;
      for (const ws of p.sockets) {
        if (ws.readyState !== 1) continue;
        msg ??= JSON.stringify({ t: 'view', view: this.viewFor(p) } satisfies ServerMsg);
        ws.send(msg);
      }
    }
  }

  private isReferee(p: Player) {
    return p.isHost && (!p.plays || this.phase === 'lobby' || this.phase === 'ended');
  }

  private meFor(p: Player): MeView {
    const live = this.phase === 'live' || this.phase === 'paused';
    const showRole = this.phase !== 'lobby';
    return {
      id: p.id,
      name: p.name,
      bib: p.bib,
      isHost: p.isHost,
      isBot: p.isBot,
      plays: p.plays,
      noBib: p.noBib,
      team: showRole ? p.team : null,
      role: showRole ? p.role : p.plays ? null : 'organiser',
      status: p.status,
      points: this.module.points(this, p),
      stats: Object.fromEntries(Object.entries(p.stats).filter(([k]) => !k.startsWith('_'))),
      claimCode: p.claimCode,
      pos: p.pos,
      outDeadline: p.outSince === null ? null : this.wall(p.outSince + OUT_GRACE_SECS * 1000),
      sos: p.sos,
      actions: this.phase === 'live' ? this.module.actions(this, p).map((a) => this.withCooldown(p, a)) : [],
      hint: live ? this.module.hint(this, p) : '',
      roleIntro: showRole ? this.module.roleIntro(this, p) : '',
      color: this.module.colorFor(this, p),
      emoji: this.module.emojiFor(this, p),
      profileId: p.profileId,
    };
  }

  private withCooldown(p: Player, a: ActionDef): ActionDef {
    const until = p.cooldowns[a.id];
    return until && until > this.now() ? { ...a, cooldownUntil: this.wall(until) } : a;
  }

  viewFor(viewer: Player): RoomView {
    // Simulation spectating: look through a bot's eyes, exactly as a player would.
    if (this.sim && viewer.isHost && viewer.watching) {
      let target = viewer.watchId ? this.players.get(viewer.watchId) : undefined;
      if (!target || target.role !== viewer.watching || target.status === 'eliminated') {
        target = this.activePlayers().find((q) => q.isBot && q.role === viewer.watching);
        viewer.watchId = target?.id ?? null;
      }
      if (target) {
        const v = this.viewFor(target);
        v.sim = { speed: this.speed, watching: viewer.watching };
        v.organiserKey = this.organiserKey;
        return v;
      }
    }

    const live = this.phase === 'live' || this.phase === 'paused';
    const referee = this.isReferee(viewer);
    const now = this.wallNow();

    const players: PlayerSummary[] = [...this.players.values()].map((q) => {
      const self = q === viewer;
      const revealRole = this.phase === 'ended' || referee || self;
      const s: PlayerSummary = {
        id: q.id,
        name: q.name,
        isBot: q.isBot,
        isHost: q.isHost,
        plays: q.plays,
        connected: q.isBot || q.sockets.size > 0,
        status: q.status,
        role: !q.plays ? 'organiser' : revealRole && this.phase !== 'lobby' ? q.role : null,
        points: this.phase === 'ended' || referee || self ? this.module.points(this, q) : { runner: null, hunter: null },
        emoji: revealRole || !live ? this.module.emojiFor(this, q) : '🙂',
        color: revealRole || !live ? this.module.colorFor(this, q) : '#6b665c',
      };
      if (referee || self) {
        s.bib = q.bib;
        s.gpsAge = q.pos ? Math.round((now - q.pos.at) / 1000) : null;
        s.gpsAcc = q.pos ? Math.round(q.pos.acc) : null;
      }
      if (referee) {
        s.claimCode = q.claimCode;
        s.sos = q.sos;
        s.suspicious = q.suspicious;
      }
      return s;
    });

    let markers: MapMarker[];
    if (live) markers = this.module.markers(this, viewer);
    else
      markers = [...this.players.values()]
        .filter((q) => q.pos && q.plays)
        .map((q) => ({
          id: q.id,
          lat: q.pos!.lat,
          lng: q.pos!.lng,
          label: q.name,
          color: this.module.colorFor(this, q),
          emoji: this.module.emojiFor(this, q),
          me: q === viewer,
          acc: q === viewer ? q.pos!.acc : undefined,
        }));

    const stage =
      this.phase === 'countdown'
        ? { key: 'countdown', label: 'Starting', endsAt: this.wall(this.countdownEndsAt) }
        : live
          ? this.module.stage(this, viewer)
          : null;

    return {
      code: this.code,
      game: this.game,
      title: this.title,
      phase: this.phase,
      config: this.config,
      boundary: this.boundary,
      serverNow: this.serverNow(),
      startedAt: this.wall(this.startedAt),
      endsAt: this.wall(this.endsAt),
      stage,
      me: this.meFor(viewer),
      players,
      markers,
      hud: this.module.hud(this, viewer),
      feed: this.feed,
      result: this.result,
      sim: this.sim ? { speed: this.speed, watching: viewer.watching } : null,
      organiserKey: viewer.isHost ? this.organiserKey : undefined,
    };
  }

  // ───────────────────────────── listings ─────────────────────────────

  listing() {
    return {
      code: this.code,
      title: this.title,
      game: this.game,
      phase: this.phase,
      players: [...this.players.values()].filter((p) => p.plays).length,
      center: boundaryCenter(this.boundary),
      createdAt: this.createdAt,
    };
  }

  preview() {
    return { ...this.listing(), boundary: this.boundary, config: this.config, sim: this.sim };
  }
}

const SPEEDS = [1, 2, 4, 8];
function clampSpeed(s: number): number {
  return SPEEDS.includes(s) ? s : 1;
}

const END_REASONS: EndReason[] = ['time', 'allCaught', 'noHunters', 'organiser', 'weather', 'safety', 'other'];
const isEndReason = (x: unknown): x is EndReason => END_REASONS.includes(x as EndReason);
