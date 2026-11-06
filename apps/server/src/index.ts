import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  ENTRY_USDC,
  CODE_RE,
  GAMES,
  isBoard,
  isGameId,
  isValidBoundary,
  normalizeConfig,
  type ClientMsg,
  type CreateEventRequest,
  type CreateRoomRequest,
  type HostRoomRow,
  type HostSession,
  type RoomListing,
  type SignInResponse,
  SIM_SPEEDS,
  type ServerMsg,
} from '@kalikkam/shared';
import { GameError, Room, type Player } from './room.ts';
import { AuthError, Store } from './store.ts';
import { sendLoginCode } from './mail.ts';
import { vestQr } from './vestcode.ts';
import { WORLD_ACTION, WorldError, rpSignature, verifyWorldProof, worldConfig } from './world.ts';
import {
  ArcError,
  EXPLORER,
  ENTRY,
  MAX_TOP_UPS,
  arcEnabled,
  balanceOf,
  newPlayerWallet,
  payEntry,
  refund,
  settle,
  splitPot,
  topUp,
  usdc,
  withdrawAll,
} from './arc.ts';
import type { Address, Hex } from 'viem';

const PORT = Number(process.env.PORT ?? 2567);
const HOST = process.env.HOST ?? '0.0.0.0';
const here = fileURLToPath(new URL('.', import.meta.url));
const DB_PATH = process.env.DB_PATH ?? resolve(here, '../data/kalikkam.db');
const WEB_DIST = resolve(process.env.WEB_DIST ?? resolve(here, '../../web/dist'));

export const store = new Store(DB_PATH);
store.requireHuman = worldConfig().enabled;
// A host account from the environment (e.g. the deploy's secrets). Left alone if the password already matches,
// so a restart doesn't sign hosts out.
if (process.env.HOST_USERNAME && process.env.HOST_PASSWORD) {
  if (!store.checkHostPassword(process.env.HOST_USERNAME, process.env.HOST_PASSWORD)) store.setHostPassword(process.env.HOST_USERNAME, process.env.HOST_PASSWORD);
}
export const rooms = new Map<string, Room>();
/** Host setup captured at room creation, applied when the host's socket joins. */
const hostSetup = new Map<string, { name: string; plays: boolean; profileId: string | null }>();

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function newCode(): string {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

/** A paid entry game's pot contract, when the host asked for one (Arc Testnet; never for bot simulations). */
function entryPool(req: CreateRoomRequest, sim: boolean): string | undefined {
  if (!req.entry || sim) return undefined;
  if (!arcEnabled()) throw new GameError("Paid entry isn't set up on this server (ARC_POOL_ADDRESS).");
  return process.env.ARC_POOL_ADDRESS;
}

/** After a paid entry game: pay the pot to the winners on Arc (or refund), and show it on the results. */
function payOut(room: Room, result: import('@kalikkam/shared').GameResult) {
  const entry = room.entry;
  if (!entry || entry.paid.size === 0) return;
  const pot = BigInt(entry.paid.size) * ENTRY;
  const plan = splitPot(
    pot,
    result.rows.map((r) => ({ id: r.id, paid: entry.paid.has(r.id) && r.status !== 'eliminated', points: r.points })),
  );
  const name = (id: string) => result.rows.find((r) => r.id === id)?.name ?? 'Player';
  const splits =
    plan.kind === 'settle'
      ? plan.splits.map((s) => ({ id: s.id, name: name(s.id), amount: usdc(s.amount) }))
      : [...entry.paid.keys()].map((id) => ({ id, name: name(id), amount: ENTRY_USDC }));
  result.payout = { status: 'pending', splits, explorer: EXPLORER };
  room.dirty = true;
  const round = entry.id as Hex;
  const tx =
    plan.kind === 'settle'
      ? settle(round, plan.splits.map((s) => entry.paid.get(s.id)!.address as Address), plan.splits.map((s) => s.amount))
      : refund(round, [...entry.paid.values()].map((v) => v.address as Address));
  tx.then(
    (hash) => {
      result.payout = { ...result.payout!, status: plan.kind === 'settle' ? 'paid' : 'refunded', txHash: hash };
      room.record('payout', { kind: plan.kind, tx: hash });
      room.log(plan.kind === 'settle' ? `🏆 Prize paid on Arc: ${splits.map((s) => `${s.name} +${s.amount} USDC`).join(', ')}` : `💵 Nobody scored: everyone got their ${ENTRY_USDC} USDC back`, 'good');
      room.dirty = true;
    },
    (e) => {
      console.error('[arc] payout failed', e);
      result.payout = { ...result.payout!, status: 'failed', error: String((e as Error).message ?? e).slice(0, 200) };
      room.dirty = true;
    },
  );
}

/** Only signed-in hosts reach this: any host may link a game to any event. */
export function createRoom(req: CreateRoomRequest, profileId: string | null): Room {
  if (!isGameId(req.game)) throw new GameError('Unknown game');
  // Public link, no login: keep one person from filling the server with rooms.
  if (rooms.size >= 100) throw new GameError('Too many games running right now. Try again in a bit.');
  if (!isValidBoundary(req.boundary)) throw new GameError('Draw a play area first (at least 3 points, or a circle of 20 m+)');
  const sim = req.sim
    ? {
        bots: Math.max(4, Math.min(60, Math.round(Number(req.sim.bots) || 0))),
        speed: (SIM_SPEEDS as readonly number[]).includes(Number(req.sim.speed)) ? Number(req.sim.speed) : 1,
      }
    : null;
  const code = newCode();
  const room = new Room(
    code,
    {
      game: req.game,
      title: (req.title ?? '').trim().slice(0, 60) || `${GAMES[req.game].name} night`,
      config: normalizeConfig(req.game, req.config),
      boundary: req.boundary,
      eventId: sim ? null : (req.eventId ?? null),
      sim: !!sim,
      speed: sim?.speed,
      entryPool: entryPool(req, !!sim),
    },
    { onEnd: onRoomEnd },
  );
  rooms.set(code, room);
  const plays = sim ? false : !!req.hostPlays;
  hostSetup.set(code, { name: req.hostName || 'Host', plays, profileId });
  if (sim) {
    // Teams are dealt at the start, as in a real game. The countdown starts when the watcher's socket joins.
    room.addBots(sim.bots);
    return room;
  }
  if (req.eventId && store.event(req.eventId, null)) store.linkRoom(req.eventId, code);
  return room;
}

function onRoomEnd(room: Room, result: import('@kalikkam/shared').GameResult) {
  if (room.sim) return; // bots-only showcase: nothing to save
  payOut(room, result);
  const byPlayer = new Map([...room.players.values()].map((p) => [p.id, p]));
  const awarded = store.saveResult(room, result, (pid) => byPlayer.get(pid)?.profileId ?? null, room.journal);
  for (const [pid, a] of awarded) {
    const p = byPlayer.get(pid);
    if (!p) continue;
    const badges = a.badges.map((b) => `${b.emoji} ${b.name}`).join(', ');
    room.toast(p, `⭐ +${a.xp} XP${badges ? ` · New badge: ${badges}` : ''}`, 'good');
  }
}

// ---- HTTP ---------------------------------------------------------------------

class HttpError extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
  }
}

async function body<T>(req: IncomingMessage): Promise<T> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 256 * 1024) throw new HttpError(413, 'Body too large');
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || '{}');
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

/** A small per-IP budget for asking for sign-in codes, on top of the per-address limits in the store. */
const codeAsks = new Map<string, number[]>();
function allowCodeAsk(req: IncomingMessage): boolean {
  const ip = req.socket.remoteAddress ?? '?';
  const now = Date.now();
  const recent = (codeAsks.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (recent.length >= 20) return false;
  recent.push(now);
  codeAsks.set(ip, recent);
  return true;
}

/** Sign-in attempts per IP and per username: 10 in 15 minutes, so passwords can't be guessed. */
const loginTries = new Map<string, number[]>();
function allowLogin(key: string): boolean {
  const now = Date.now();
  const recent = (loginTries.get(key) ?? []).filter((t) => now - t < 15 * 60_000);
  if (recent.length >= 10) return false;
  recent.push(now);
  loginTries.set(key, recent);
  return true;
}

function hostOf(req: IncomingMessage) {
  const t = req.headers['x-host-token'];
  return store.hostForToken(typeof t === 'string' ? t : null);
}

function mustHost(req: IncomingMessage) {
  const h = hostOf(req);
  if (!h) throw new HttpError(403, 'Only hosts can do that. Sign in as host first.');
  return h;
}

function authed(req: IncomingMessage): string | null {
  const h = req.headers.authorization ?? '';
  return store.profileIdForToken(h.startsWith('Bearer ') ? h.slice(7) : null);
}

function mustAuth(req: IncomingMessage): string {
  const pid = authed(req);
  if (!pid) throw new HttpError(401, 'Create a profile first');
  return pid;
}

async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
  const path = url.pathname.replace(/\/+$/, '');
  const m = (re: RegExp) => path.match(re);
  const method = req.method ?? 'GET';
  let mm: RegExpMatchArray | null;

  if (path === '/api/health') return json(res, 200, { ok: true, rooms: rooms.size, now: Date.now() });

  // Signed QR codes for printing vests (Kit). Any vest printed from here works in every game.
  if (path === '/api/vests' && method === 'GET') {
    const from = Math.max(100, Math.min(999, Math.floor(Number(url.searchParams.get('from')) || 100)));
    const count = Math.max(1, Math.min(200, Math.floor(Number(url.searchParams.get('count')) || 20), 1000 - from));
    return json(res, 200, Array.from({ length: count }, (_, i) => ({ vest: String(from + i), qr: vestQr(String(from + i)) })));
  }

  // Host accounts: a username and password set by the organisers (scripts/hosts.ts, or HOST_USERNAME/HOST_PASSWORD).
  if (path === '/api/host/login' && method === 'POST') {
    const b = await body<{ username: string; password: string }>(req);
    const user = String(b.username ?? '').trim().toLowerCase();
    if (!allowLogin(`ip:${req.socket.remoteAddress ?? '?'}`) || !allowLogin(`user:${user}`)) throw new HttpError(429, 'Too many sign-in attempts. Try again in 15 minutes.');
    const s = store.hostLogin(user, String(b.password ?? ''));
    const out: HostSession = { username: s.username, token: s.token, profile: store.profile(s.pid)!, profileToken: s.profileToken };
    return json(res, 200, out);
  }
  if (path === '/api/host/logout' && method === 'POST') {
    const t = req.headers['x-host-token'];
    if (typeof t === 'string') store.hostLogout(t);
    return json(res, 200, { ok: true });
  }
  if (path === '/api/host/me' && method === 'GET') return json(res, 200, { username: mustHost(req).username });
  if (path === '/api/host/rooms' && method === 'GET') {
    mustHost(req);
    const list: HostRoomRow[] = [...rooms.values()]
      .filter((r) => r.phase !== 'ended')
      .map((r) => ({ code: r.code, title: r.title, phase: r.phase, players: r.activePlayers().length, createdAt: r.createdAt, hostKey: r.hostKey, sim: r.sim }))
      .sort((a, b) => b.createdAt - a.createdAt);
    return json(res, 200, list);
  }
  if (path === '/api/host/games' && method === 'GET') {
    mustHost(req);
    return json(res, 200, store.recentGames(Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 30))));
  }
  if ((mm = m(/^\/api\/host\/games\/(\d+)$/)) && method === 'GET') {
    mustHost(req);
    const g = store.gameLog(Number(mm[1]));
    if (!g) throw new HttpError(404, 'No such game');
    return json(res, 200, g);
  }

  // Rooms: only hosts create games (and simulations).
  if (path === '/api/rooms' && method === 'POST') {
    const host = mustHost(req);
    const r = await body<CreateRoomRequest>(req);
    const room = createRoom(r, host.pid ?? authed(req));
    return json(res, 200, { code: room.code, hostKey: room.hostKey });
  }
  if (path === '/api/rooms' && method === 'GET') {
    const list: RoomListing[] = [...rooms.values()]
      .filter((r) => r.phase !== 'ended' && !r.sim)
      .map((r) => ({ code: r.code, game: r.game, title: r.title, phase: r.phase, players: r.activePlayers().length, createdAt: r.createdAt }))
      .sort((a, b) => b.createdAt - a.createdAt);
    return json(res, 200, list);
  }
  if ((mm = m(/^\/api\/rooms\/([A-Za-z]{4})$/)) && method === 'GET') {
    const room = rooms.get(mm[1].toUpperCase());
    if (!room) throw new HttpError(404, 'No game with that code');
    return json(res, 200, {
      code: room.code,
      game: room.game,
      title: room.title,
      phase: room.phase,
      players: room.activePlayers().length,
      boundary: room.boundary,
      config: room.config,
    });
  }

  // Profiles
  if (path === '/api/profile' && method === 'POST') {
    const b = await body<{ name: string }>(req);
    return json(res, 200, store.createProfile(b.name));
  }
  if (path === '/api/me' && method === 'GET') {
    const pid = mustAuth(req);
    return json(res, 200, { profile: store.profile(pid), history: store.history(pid), email: store.emailOf(pid) });
  }

  // Email sign-in: ask for a 6-digit code, then trade it for the profile's token.
  if (path === '/api/auth/email/start' && method === 'POST') {
    if (!allowCodeAsk(req)) throw new HttpError(429, 'Too many codes from here. Try again later.');
    const b = await body<{ email: string }>(req);
    const { email, code } = store.startEmailLogin(b.email);
    const delivery = await sendLoginCode(email, code);
    return json(res, 200, { ok: true, delivery });
  }
  if (path === '/api/auth/email/verify' && method === 'POST') {
    const b = await body<{ email: string; code: string }>(req);
    const r = store.verifyEmailLogin(b.email, b.code, authed(req));
    const out: SignInResponse = { profile: store.profile(r.pid)!, token: r.token, email: r.email, created: r.created };
    return json(res, 200, out);
  }
  if (path === '/api/me' && method === 'PATCH') {
    const pid = mustAuth(req);
    const b = await body<{ name: string }>(req);
    store.renameProfile(pid, b.name);
    return json(res, 200, { profile: store.profile(pid) });
  }
  if ((mm = m(/^\/api\/profiles\/([a-f0-9]+)$/))) {
    const p = store.profile(mm[1]);
    if (!p) throw new HttpError(404, 'Profile not found');
    return json(res, 200, { profile: p, history: store.history(mm[1], 15) });
  }
  if (path === '/api/leaderboard') {
    const period = url.searchParams.get('period');
    const since = period === 'week' ? Date.now() - 7 * 86400_000 : period === 'month' ? Date.now() - 30 * 86400_000 : null;
    const board = url.searchParams.get('board') ?? 'xp';
    if (!isBoard(board)) throw new HttpError(400, 'Unknown board');
    return json(res, 200, board === 'xp' ? store.leaderboard(since) : store.highScores(board, since));
  }

  // World ID: one profile per human, required to claim a spot at an event.
  if (path === '/api/world/config' && method === 'GET') return json(res, 200, worldConfig());
  if (path === '/api/world/rp-signature' && method === 'POST') {
    mustAuth(req);
    if (!worldConfig().enabled) throw new HttpError(404, 'World ID is not set up on this server');
    if (!allowLogin(`world:${req.socket.remoteAddress ?? '?'}`)) throw new HttpError(429, 'Too many checks from here. Try again in a few minutes.');
    return json(res, 200, rpSignature());
  }
  if (path === '/api/world/verify' && method === 'POST') {
    const pid = mustAuth(req);
    const b = await body<{ result: unknown }>(req);
    const v = await verifyWorldProof(b.result, pid);
    store.recordHuman(pid, WORLD_ACTION, v.nullifier, v.credential, v.sybilScore);
    console.log(`[world] verified profile ${pid} (${v.credential}${v.sybilScore === null ? '' : `, sybil ${v.sybilScore}`})`);
    return json(res, 200, { profile: store.profile(pid) });
  }

  // Kalikkam wallet (Arc Testnet, test USDC): made after the World ID check; players never connect a wallet.
  if (path.startsWith('/api/wallet')) {
    const pid = mustAuth(req);
    if (!arcEnabled()) throw new HttpError(404, "Wallets aren't set up on this server");
    if (worldConfig().enabled && !store.isVerifiedHuman(pid)) throw new HttpError(403, 'Verify with World ID first: one wallet per person.');
    let w = store.wallet(pid);
    if (!w) {
      const fresh = newPlayerWallet();
      store.saveWallet(pid, fresh.address, fresh.sealed);
      w = store.wallet(pid)!;
    }
    const view = async () => ({ address: w!.address, balance: usdc(await balanceOf(w!.address as Address)), topUpsLeft: MAX_TOP_UPS - store.wallet(pid)!.topUps, explorer: EXPLORER });
    if (path === '/api/wallet' && method === 'GET') return json(res, 200, await view());
    if (path === '/api/wallet/topup' && method === 'POST') {
      if (w.topUps >= MAX_TOP_UPS) throw new HttpError(429, 'No more test top-ups for this wallet.');
      store.countTopUp(pid);
      const tx = await topUp(w.address as Address);
      return json(res, 200, { ...(await view()), tx });
    }
    if (path === '/api/wallet/withdraw' && method === 'POST') {
      const b = await body<{ to: string }>(req);
      const { hash, amount } = await withdrawAll(w.sealed, String(b.to ?? '').trim());
      return json(res, 200, { ...(await view()), tx: hash, amount: usdc(amount) });
    }
  }
  if ((mm = m(/^\/api\/rooms\/([A-Za-z]{4})\/entry$/)) && method === 'POST') {
    const pid = mustAuth(req);
    const room = rooms.get(mm[1].toUpperCase());
    if (!room?.entry) throw new HttpError(404, 'This game has no entry fee');
    if (room.phase !== 'lobby') throw new HttpError(400, 'The game has started: entries are closed.');
    const p = [...room.players.values()].find((x) => x.profileId === pid && x.plays);
    if (!p) throw new HttpError(400, 'Join the game first.');
    if (worldConfig().enabled && !store.isVerifiedHuman(pid)) throw new HttpError(403, 'Verify with World ID first: one wallet per person.');
    const w = store.wallet(pid);
    if (!w) throw new HttpError(400, 'Open your Kalikkam wallet first.');
    if (!room.entry.paid.has(p.id)) {
      const round = room.entry.id as Hex;
      const tx = await payEntry(w.sealed, round);
      room.markPaid(p, w.address, tx);
    }
    return json(res, 200, { ok: true, tx: room.entry.paid.get(p.id)!.tx });
  }

  // Events
  if (path === '/api/events' && method === 'GET') return json(res, 200, store.events(authed(req)));
  if (path === '/api/events' && method === 'POST') {
    // Hosts plan events; everyone can see, share and RSVP to them.
    const host = mustHost(req);
    const pid = host.pid ?? mustAuth(req);
    const b = await body<CreateEventRequest>(req);
    if (!isGameId(b.game)) throw new HttpError(400, 'Pick a game');
    if (!b.title?.trim() || !b.place?.trim()) throw new HttpError(400, 'Title and place are required');
    if (!Number.isFinite(b.startsAt) || b.startsAt < Date.now() - 3600_000) throw new HttpError(400, 'Pick a start time in the future');
    return json(res, 200, store.createEvent(pid, b));
  }
  if ((mm = m(/^\/api\/events\/([a-f0-9]+)$/))) {
    if (method === 'GET') {
      const e = store.event(mm[1], authed(req));
      if (!e) throw new HttpError(404, 'Event not found');
      return json(res, 200, e);
    }
    if (method === 'DELETE') {
      mustHost(req);
      store.cancelEvent(mm[1]);
      return json(res, 200, { ok: true });
    }
  }
  if ((mm = m(/^\/api\/events\/([a-f0-9]+)\/rsvp$/))) {
    const pid = mustAuth(req);
    if (method === 'POST') {
      // One spot per person: with World ID set up, claiming a spot needs a verified profile.
      if (worldConfig().enabled && !store.isVerifiedHuman(pid)) throw new HttpError(403, 'Verify with World ID first: one spot per person.');
      try {
        store.rsvp(mm[1], pid);
      } catch (e) {
        throw new HttpError(404, (e as Error).message);
      }
    } else if (method === 'DELETE') store.unrsvp(mm[1], pid);
    return json(res, 200, store.event(mm[1], pid));
  }

  throw new HttpError(404, 'Not found');
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
};

async function serveStatic(res: ServerResponse, pathname: string) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(WEB_DIST, rel);
  if (!file.startsWith(WEB_DIST)) file = join(WEB_DIST, 'index.html');
  try {
    const s = await stat(file);
    if (s.isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(WEB_DIST, 'index.html'); // SPA fallback
  }
  try {
    const data = await readFile(file);
    const ext = extname(file);
    const immutable = file.includes(`${WEB_DIST}/assets/`);
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Web app not built. Run `pnpm --filter @kalikkam/web build`, or use the Vite dev server.');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else await serveStatic(res, url.pathname);
  } catch (e) {
    if (e instanceof Error && (e instanceof WorldError || url.pathname.startsWith('/api/world/')))
      console.warn(`[world] ${req.method} ${url.pathname} failed: ${e.message}`);
    if (e instanceof HttpError) return json(res, e.status, { error: e.message });
    if (e instanceof GameError || e instanceof AuthError || e instanceof WorldError || e instanceof ArcError) return json(res, 400, { error: e.message });
    console.error(e);
    json(res, 500, { error: 'Server error' });
  }
});

// ---- WebSocket ----------------------------------------------------------------

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

server.on('upgrade', (req, socket, head) => {
  if (!req.url?.startsWith('/ws')) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

wss.on('connection', (ws: WebSocket) => {
  let room: Room | null = null;
  let player: Player | null = null;
  let budget = 30;
  const refill = setInterval(() => (budget = Math.min(30, budget + 10)), 1000);
  let alive = true;
  ws.on('pong', () => (alive = true));
  // A bad frame (e.g. over maxPayload) emits 'error'; unhandled, that would crash the whole server.
  ws.on('error', () => ws.terminate());
  const hb = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 20_000);

  ws.on('message', (raw) => {
    if (--budget < 0) return; // flood guard
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    try {
      if (msg.t === 'ping') return send(ws, { t: 'pong', serverNow: Date.now() });
      if (msg.t === 'join') {
        const code = String(msg.code ?? '').toUpperCase();
        if (!CODE_RE.test(code)) throw new GameError('Game codes are 4 letters');
        const r = rooms.get(code);
        if (!r) return send(ws, { t: 'error', msg: 'That game does not exist (any more).', fatal: true });
        if (player && room) room.detach(ws, player);
        const profileId = store.profileIdForToken(msg.profileToken);
        let p = msg.playerId ? r.players.get(msg.playerId) : undefined;
        if (p && p.secret !== msg.secret) p = undefined;
        if (!p && msg.hostKey) {
          if (msg.hostKey !== r.hostKey) throw new GameError('Invalid host key');
          p = r.host();
          if (!p) {
            const setup = hostSetup.get(code) ?? { name: msg.name, plays: false, profileId };
            p = r.addPlayer({ name: setup.name || msg.name, vest: msg.vest, isHost: true, plays: setup.plays, profileId: setup.profileId ?? profileId });
            if (r.sim && r.phase === 'lobby') r.start();
          }
        }
        if (!p) p = r.addPlayer({ name: msg.name, vest: msg.vest, profileId });
        if (profileId && !p.profileId) p.profileId = profileId;
        room = r;
        player = p;
        r.attach(ws, p);
        send(ws, { t: 'joined', playerId: p.id, secret: p.secret, code, isHost: p.isHost });
        send(ws, { t: 'view', view: r.viewFor(p) });
        return;
      }
      if (!room || !player) throw new GameError('Join a game first');
      if (!room.players.has(player.id)) throw new GameError('You are no longer in this game');
      if (msg.t === 'watch') return room.watch(ws, player, msg.team);
      room.handle(player, msg);
    } catch (e) {
      if (e instanceof GameError) send(ws, { t: 'error', msg: e.message });
      else {
        console.error(e);
        send(ws, { t: 'error', msg: 'Something went wrong' });
      }
    }
  });

  ws.on('close', () => {
    clearInterval(refill);
    clearInterval(hb);
    if (room && player) room.detach(ws, player);
  });
});

// ---- loops ----------------------------------------------------------------------

setInterval(() => {
  for (const room of rooms.values()) {
    try {
      room.tick();
      if (room.shouldBroadcast()) room.broadcast();
    } catch (e) {
      console.error(`room ${room.code} tick failed`, e);
    }
  }
}, 250);

setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    const humans = [...r.players.values()].some((p) => !p.isBot && p.sockets.size > 0);
    const idle = now - r.lastActivity;
    const limit = r.sim ? 15 * 60_000 : 3 * 3600_000;
    if ((!humans && idle > limit) || (r.phase === 'ended' && idle > 6 * 3600_000)) {
      rooms.delete(code);
      hostSetup.delete(code);
    }
  }
}, 60_000);

server.listen(PORT, HOST, () => console.log(`🎮 Zombie Run game server on http://${HOST}:${PORT}`));
