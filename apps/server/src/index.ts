import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  GAMES,
  ROOM_CODE_RE,
  cleanBoundary,
  cleanName,
  isGameId,
  isValidBoundary,
  normalizeConfig,
  type ClientMsg,
  type CreateRoomBody,
  type GameResult,
  type HostCmd,
  type LeaderboardBoard,
  type LeaderboardPeriod,
  type ServerMsg,
} from '@runnn/shared';
import { bibRange } from './bibcode.ts';
import { GameError, roomCode } from './games/util.ts';
import { sendSignInCode } from './mail.ts';
import { Room, type Player } from './room.ts';
import { Store, StoreError } from './store.ts';
import { WorldError, WorldId, worldConfigFromEnv } from './worldid.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT ?? 2567);
const HOST = process.env.HOST ?? '0.0.0.0';
const DB_PATH = process.env.DB_PATH ?? resolve(here, '../data/runnn.db');
const WEB_DIST = resolve(process.env.WEB_DIST ?? resolve(here, '../../web/dist'));
const MAX_BODY = 256 * 1024;
const MAX_ROOMS = 100;

export const store = new Store(DB_PATH);
const worldCfg = worldConfigFromEnv();
export const world = worldCfg ? new WorldId(worldCfg) : null;
if (world) console.log(`World ID Selfie Check sign-in on (${world.cfg.environment}, action "${world.cfg.action}")`);
export const rooms = new Map<string, Room>();

if (process.env.ORGANISER_USERNAME && process.env.ORGANISER_PASSWORD) {
  const u = process.env.ORGANISER_USERNAME;
  if (!store.hasOrganiser(u)) {
    store.addOrganiser(u, process.env.ORGANISER_PASSWORD);
    console.log(`seeded organiser ${u}`);
  }
}

// ───────────────────────────── rate limits ─────────────────────────────

class Budget {
  private hits = new Map<string, number[]>();
  constructor(
    private max: number,
    private windowMs: number,
  ) {}
  take(key: string): boolean {
    const now = Date.now();
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length >= this.max) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    return true;
  }
  sweep() {
    const now = Date.now();
    for (const [k, v] of this.hits) if (v.every((t) => now - t >= this.windowMs)) this.hits.delete(k);
  }
}

const codeAsks = new Budget(20, 3600_000);
const loginIp = new Budget(10, 15 * 60_000);
const loginUser = new Budget(10, 15 * 60_000);
const creates = new Budget(30, 3600_000);
const worldAsks = new Budget(30, 3600_000);

// ───────────────────────────── http helpers ─────────────────────────────

class HttpError extends Error {
  constructor(
    public status: number,
    msg: string,
  ) {
    super(msg);
  }
}

function json(res: ServerResponse, status: number, body: unknown) {
  const s = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(s),
  });
  res.end(s);
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        fail(new HttpError(413, 'Request too large.'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!size) return ok({});
      try {
        ok(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        fail(new HttpError(400, 'Bad JSON.'));
      }
    });
    req.on('error', fail);
  });
}

const ip = (req: IncomingMessage) =>
  (process.env.TRUST_PROXY ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '') ||
  req.socket.remoteAddress ||
  '?';

function bearer(req: IncomingMessage, header: string): string | null {
  const v = req.headers[header];
  return typeof v === 'string' && v ? v : null;
}

const profileOf = (req: IncomingMessage) => store.profileIdByToken(bearer(req, 'x-profile-token'));
const organiserOf = (req: IncomingMessage) => store.organiser(bearer(req, 'x-organiser-token'));

function requireOrganiser(req: IncomingMessage) {
  const o = organiserOf(req);
  if (!o) throw new HttpError(401, 'Organiser sign-in needed.');
  return o;
}

function requireProfile(req: IncomingMessage) {
  const p = profileOf(req);
  if (!p) throw new HttpError(401, 'Make a profile first.');
  return p;
}

// ───────────────────────────── rooms ─────────────────────────────

function createRoom(body: Partial<CreateRoomBody>, organiserProfileId: string | null) {
  if (rooms.size >= MAX_ROOMS) throw new HttpError(503, 'Too many games running. Try again later.');
  if (!isGameId(body.game)) throw new HttpError(400, 'Unknown game.');
  if (!isValidBoundary(body.boundary)) throw new HttpError(400, 'Draw a play area first (3–64 corners, or a circle of 20 m–3 km).');
  const title = cleanName(body.title) || `${GAMES[body.game].name} game`;
  let code = roomCode();
  while (rooms.has(code)) code = roomCode();
  const room = new Room(
    code,
    {
      game: body.game,
      title,
      boundary: cleanBoundary(body.boundary),
      config: normalizeConfig(body.game, body.config),
      sim: !!body.sim,
      speed: Number(body.speed) || 1,
      eventId: typeof body.eventId === 'string' ? body.eventId : null,
      organiserPlays: !!body.organiserPlays,
      organiserProfileId,
    },
    { onFinish: saveFinished },
  );
  if (room.sim) room.addBots(Math.max(3, Math.min(60, Math.round(Number(body.bots) || 12))));
  if (room.eventId) store.setEventRoom(room.eventId, code);
  rooms.set(code, room);
  return room;
}

function saveFinished(room: Room, result: GameResult) {
  const saved = store.saveResult({
    roomCode: room.code,
    game: room.game,
    title: room.title,
    eventId: room.eventId,
    organiserProfileId: room.organiserProfileId,
    result,
    log: room.journal,
  });
  const xp = new Map<string, number>();
  for (const r of saved.rows) {
    xp.set(r.playerId, r.xp);
    const p = room.players.get(r.playerId);
    if (p && r.newBadges.length) room.toast(p, `New badge${r.newBadges.length > 1 ? 's' : ''}! Check your profile.`, 'good');
  }
  return xp;
}

// ───────────────────────────── routes ─────────────────────────────

async function api(req: IncomingMessage, res: ServerResponse, url: URL) {
  const path = url.pathname;
  const m = req.method ?? 'GET';
  const seg = path.split('/').filter(Boolean).slice(1); // drop "api"
  const body = m === 'POST' || m === 'PATCH' ? await readBody(req) : {};

  // health
  if (path === '/api/health') return json(res, 200, { ok: true, rooms: rooms.size, now: Date.now() });

  // signed bibs for the print pack
  if (path === '/api/bibs' && m === 'GET') {
    requireOrganiser(req);
    const from = Math.max(100, Math.min(999, Number(url.searchParams.get('from')) || 100));
    const count = Math.max(1, Math.min(200, Number(url.searchParams.get('count')) || 20));
    return json(res, 200, { bibs: bibRange(from, count) });
  }

  // organisers
  if (seg[0] === 'organiser') {
    if (seg[1] === 'login' && m === 'POST') {
      const user = String(body.username ?? '').toLowerCase();
      if (!loginIp.take(ip(req)) || !loginUser.take(user)) throw new HttpError(429, 'Too many attempts. Wait 15 minutes.');
      const r = store.login(body.username, body.password, bearer(req, 'x-profile-token'));
      if (!r) throw new HttpError(401, 'Wrong username or password.');
      return json(res, 200, r);
    }
    if (seg[1] === 'logout' && m === 'POST') {
      store.logout(bearer(req, 'x-organiser-token'));
      return json(res, 200, { ok: true });
    }
    const o = requireOrganiser(req);
    if (seg[1] === 'me') return json(res, 200, o);
    if (seg[1] === 'rooms' && m === 'GET') {
      return json(res, 200, {
        rooms: [...rooms.values()]
          .sort((a, b) => b.createdAt - a.createdAt)
          .map((r) => ({ ...r.listing(), sim: r.sim, organiserKey: r.organiserKey })),
      });
    }
    if (seg[1] === 'games' && !seg[2]) return json(res, 200, { games: store.rounds() });
    if (seg[1] === 'games' && seg[2]) {
      const r = store.round(Number(seg[2]));
      if (!r) throw new HttpError(404, 'No such round.');
      return json(res, 200, r);
    }
  }

  // rooms
  if (seg[0] === 'rooms') {
    if (!seg[1] && m === 'POST') {
      const o = requireOrganiser(req);
      if (!creates.take(o.username)) throw new HttpError(429, 'Slow down: too many games created.');
      const room = createRoom(body, o.profileId);
      return json(res, 200, { code: room.code, organiserKey: room.organiserKey });
    }
    if (!seg[1] && m === 'GET') {
      return json(res, 200, {
        rooms: [...rooms.values()].filter((r) => !r.sim && r.phase !== 'ended').map((r) => r.listing()),
      });
    }
    if (seg[1] && m === 'GET') {
      const room = rooms.get(seg[1].toUpperCase());
      if (!room) throw new HttpError(404, 'No game with that code. Check it with the organiser.');
      return json(res, 200, room.preview());
    }
  }

  // profiles
  if (path === '/api/profile' && m === 'POST') {
    const r = store.createProfile(body.name);
    return json(res, 200, r);
  }
  if (path === '/api/me') {
    const pid = requireProfile(req);
    if (m === 'PATCH') {
      store.rename(pid, body.name);
      return json(res, 200, store.me(pid));
    }
    const me = store.me(pid);
    if (!me) throw new HttpError(404, 'Profile not found.');
    return json(res, 200, me);
  }
  if (seg[0] === 'profiles' && seg[1] && m === 'GET') {
    const p = store.profile(seg[1]);
    if (!p) throw new HttpError(404, 'No such player.');
    return json(res, 200, { profile: p, history: store.history(p.id, 10) });
  }

  // email sign-in
  if (path === '/api/auth/email/start' && m === 'POST') {
    if (!codeAsks.take(ip(req))) throw new HttpError(429, 'Too many code requests from here. Try later.');
    const { email, code } = store.startEmail(body.email);
    await sendSignInCode(email, code);
    return json(res, 200, { ok: true });
  }
  if (path === '/api/auth/email/verify' && m === 'POST') {
    const r = store.verifyEmail(body.email, body.code, bearer(req, 'x-profile-token'));
    return json(res, 200, r);
  }

  // World ID Selfie Check sign-in
  if (seg[0] === 'auth' && seg[1] === 'world') {
    if (seg[2] === 'config' && m === 'GET') return json(res, 200, world ? world.publicConfig() : { enabled: false });
    if (!world) throw new HttpError(404, 'World ID sign-in is not set up on this server.');
    if (seg[2] === 'context' && m === 'POST') {
      if (!worldAsks.take(ip(req))) throw new HttpError(429, 'Too many sign-in attempts from here. Try later.');
      return json(res, 200, { rp_context: world.createContext() });
    }
    if (seg[2] === 'verify' && m === 'POST') {
      const { nullifier } = await world.verifyResult(body.result);
      const r = store.loginWithWorld(nullifier, body.name, bearer(req, 'x-profile-token'));
      return json(res, 200, { token: r.token, profile: r.profile, linked: r.linked, created: r.created });
    }
  }

  // leaderboard
  if (path === '/api/leaderboard' && m === 'GET') {
    const b = url.searchParams.get('board');
    const p = url.searchParams.get('period');
    const board: LeaderboardBoard = b === 'runner' || b === 'hunter' ? b : 'xp';
    const period: LeaderboardPeriod = p === 'week' || p === 'month' ? p : 'all';
    return json(res, 200, { board, period, rows: store.leaderboard(board, period) });
  }

  // events
  if (seg[0] === 'events') {
    const viewer = profileOf(req);
    if (!seg[1] && m === 'GET') return json(res, 200, { events: store.events(viewer) });
    if (!seg[1] && m === 'POST') {
      const o = requireOrganiser(req);
      const host = o.profileId ?? requireProfile(req);
      return json(res, 200, store.createEvent(host, body));
    }
    if (seg[1] && !seg[2]) {
      if (m === 'GET') {
        const e = store.event(seg[1], viewer);
        if (!e) throw new HttpError(404, 'No such event.');
        return json(res, 200, e);
      }
      if (m === 'DELETE') {
        const pid = requireProfile(req);
        store.cancelEvent(seg[1], pid, !!organiserOf(req));
        return json(res, 200, store.event(seg[1], pid));
      }
    }
    if (seg[1] && seg[2] === 'rsvp') {
      const pid = requireProfile(req);
      if (m === 'POST') store.rsvp(seg[1], pid);
      else if (m === 'DELETE') store.unrsvp(seg[1], pid);
      return json(res, 200, store.event(seg[1], pid));
    }
  }

  throw new HttpError(404, 'Not found.');
}

// ───────────────────────────── static ─────────────────────────────

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL) {
  const index = join(WEB_DIST, 'index.html');
  if (!existsSync(index)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('The web app is not built yet. Run `pnpm build` in the repo root, then restart the server.\n');
  }
  let rel: string;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    rel = '/';
  }
  const file = normalize(join(WEB_DIST, rel));
  const inside = file === WEB_DIST || file.startsWith(WEB_DIST + sep);
  let target = index;
  if (inside && existsSync(file) && statSync(file).isFile()) target = file;
  else if (extname(rel) && rel !== '/') {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  const headers: Record<string, string> = { 'Content-Type': MIME[extname(target)] ?? 'application/octet-stream' };
  if (target.startsWith(join(WEB_DIST, 'assets') + sep)) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  else headers['Cache-Control'] = 'no-cache';
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  createReadStream(target).pipe(res);
}

// ───────────────────────────── server ─────────────────────────────

export const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (!url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed.' });
    return serveStatic(req, res, url);
  }
  try {
    await api(req, res, url);
  } catch (e) {
    if (e instanceof HttpError) return json(res, e.status, { error: e.message });
    if (e instanceof StoreError) return json(res, e.status, { error: e.message });
    if (e instanceof GameError) return json(res, 400, { error: e.message });
    if (e instanceof WorldError) return json(res, e.status, { error: e.message });
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: 'Something went wrong on our side.' });
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

server.on('upgrade', (req, socket, head) => {
  if (!req.url?.startsWith('/ws')) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

function sendWs(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

wss.on('connection', (ws: WebSocket) => {
  let room: Room | null = null;
  let me: Player | null = null;

  // Token bucket: 30 messages, +10 per second.
  let budget = 30;
  const refill = setInterval(() => (budget = Math.min(30, budget + 10)), 1000);
  // Mobile networks half-close constantly; without a heartbeat dead sockets pile up.
  let alive = true;
  ws.on('pong', () => (alive = true));
  const hb = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 20_000);
  // A frame over maxPayload emits 'error'. Unhandled, that crashes the whole server.
  ws.on('error', () => ws.terminate());

  ws.on('close', () => {
    clearInterval(refill);
    clearInterval(hb);
    if (room && me) room.detach(me, ws);
  });

  ws.on('message', (raw) => {
    if (--budget < 0) {
      if (budget === -1) sendWs(ws, { t: 'error', msg: 'Slow down.' });
      return;
    }
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;

    try {
      if (msg.t === 'ping') return sendWs(ws, { t: 'pong', serverNow: Date.now() });

      if (msg.t === 'join') {
        const code = String(msg.code ?? '').toUpperCase();
        const r = ROOM_CODE_RE.test(code) ? rooms.get(code) : undefined;
        if (!r) return sendWs(ws, { t: 'error', msg: 'That game no longer exists.', fatal: true });
        const profileId = store.profileIdByToken(msg.profileToken);
        const { player } = r.join({ ...msg, profileId });
        if (room && me && (room !== r || me !== player)) room.detach(me, ws);
        room = r;
        me = player;
        r.attach(player, ws);
        sendWs(ws, { t: 'joined', playerId: player.id, secret: player.secret, code: r.code, isHost: player.isHost });
        sendWs(ws, { t: 'view', view: r.viewFor(player) });
        return;
      }

      if (!room || !me || !room.players.has(me.id)) return sendWs(ws, { t: 'error', msg: 'Join a game first.' });
      room.lastActivity = Date.now();

      switch (msg.t) {
        case 'pos':
          if (me.isBot) return;
          return room.updatePos(me, Number(msg.lat), Number(msg.lng), Number(msg.acc));
        case 'act':
          return room.act(me, String(msg.action), typeof msg.code === 'string' ? msg.code : undefined);
        case 'scan':
          return room.scan(me, String(msg.qr ?? ''));
        case 'host': {
          const { t: _t, ...cmd } = msg;
          return room.hostCmd(me, cmd as HostCmd);
        }
        case 'sos':
          return room.setSos(me, !!msg.on);
        case 'watch':
          return room.watch(me, msg.team);
      }
    } catch (e) {
      if (e instanceof GameError || e instanceof StoreError) sendWs(ws, { t: 'toast', text: e.message, kind: 'bad' });
      else {
        console.error('ws message failed', e);
        sendWs(ws, { t: 'error', msg: 'Something went wrong.' });
      }
    }
  });
});

// Two loops: that is the whole scheduler.
const tickLoop = setInterval(() => {
  for (const room of rooms.values()) {
    try {
      room.tick();
      if (room.shouldBroadcast()) room.broadcast();
    } catch (e) {
      // One room must not kill the rest.
      console.error(`room ${room.code} tick failed`, e);
    }
  }
}, 250);

const reapLoop = setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    const humans = [...r.players.values()].some((p) => !p.isBot && p.sockets.size > 0);
    const idle = now - r.lastActivity;
    if ((!humans && idle > (r.sim ? 15 * 60_000 : 3 * 3600_000)) || (r.phase === 'ended' && idle > 6 * 3600_000)) {
      rooms.delete(code);
    }
  }
  for (const b of [codeAsks, loginIp, loginUser, creates, worldAsks]) b.sweep();
}, 60_000);

export function stop() {
  clearInterval(tickLoop);
  clearInterval(reapLoop);
  for (const c of wss.clients) c.terminate();
  wss.close();
  server.close();
  store.close();
}

if (process.env.NO_LISTEN !== '1') {
  server.listen(PORT, HOST, () => {
    console.log(`RUNNN server on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    if (!existsSync(join(WEB_DIST, 'index.html'))) console.log(`(no web build at ${WEB_DIST} yet: run pnpm build)`);
  });
  const shutdown = () => {
    stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
