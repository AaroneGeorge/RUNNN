/**
 * Boots a real server on a spare port and drives a full round over real WebSockets:
 * organiser login → create room → 4 players join → start → a hunter holds a scan
 * on a runner's signed bib → conversion → organiser ends → result saved.
 *
 *   pnpm --filter @runnn/server smoke
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import type { ClientMsg, RoomView, ServerMsg } from '@runnn/shared';

const here = fileURLToPath(new URL('.', import.meta.url));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function freePort(): Promise<number> {
  return new Promise((ok) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => ok(port));
    });
  });
}

class Client {
  ws: WebSocket;
  view: RoomView | null = null;
  toasts: string[] = [];
  id = '';
  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (raw) => {
      const m = JSON.parse(String(raw)) as ServerMsg;
      if (m.t === 'view') this.view = m.view;
      if (m.t === 'joined') this.id = m.playerId;
      if (m.t === 'toast') this.toasts.push(m.text);
      if (m.t === 'error') this.toasts.push(`error: ${m.msg}`);
    });
  }
  open() {
    return new Promise<void>((ok, fail) => {
      this.ws.once('open', () => ok());
      this.ws.once('error', fail);
    });
  }
  send(m: ClientMsg) {
    this.ws.send(JSON.stringify(m));
  }
  async until(what: string, fn: (v: RoomView) => boolean, ms = 10_000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (this.view && fn(this.view)) return this.view;
      await sleep(50);
    }
    throw new Error(`timed out waiting for: ${what}\nlast toasts: ${this.toasts.slice(-5).join(' | ')}`);
  }
}

async function main() {
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'runnn-smoke-'));
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['--import', 'tsx', resolve(here, '../src/index.ts')], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DB_PATH: join(dir, 'smoke.db'),
      BIB_KEY_PATH: join(dir, 'bib.key'),
      ORGANISER_USERNAME: 'smoke',
      ORGANISER_PASSWORD: 'smoke-test-pw',
      MAIL_LOG: 'off',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const clients: Client[] = [];
  try {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`${base}/api/health`)).ok) break;
      } catch {
        /* not up yet */
      }
      await sleep(100);
    }
    const api = async (path: string, init: RequestInit & { org?: string } = {}): Promise<any> => {
      const res = await fetch(base + path, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init.org ? { 'x-organiser-token': init.org } : {}) },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(body)}`);
      return body;
    };

    const login = await api('/api/organiser/login', { method: 'POST', body: JSON.stringify({ username: 'smoke', password: 'smoke-test-pw' }) });
    const center = { lat: 51.5, lng: -0.12 };
    const { code, organiserKey } = await api('/api/rooms', {
      method: 'POST',
      org: login.token,
      body: JSON.stringify({
        title: 'Smoke',
        game: 'chase',
        boundary: { type: 'circle', center, radius: 150 },
        config: { releaseDelaySecs: 0, holdSecs: 5, durationSecs: 600 },
      }),
    });
    const { bibs } = await api('/api/bibs?from=100&count=4', { org: login.token });
    console.log(`room ${code} created`);

    const wsUrl = `ws://127.0.0.1:${port}/ws`;
    const host = new Client(wsUrl);
    await host.open();
    host.send({ t: 'join', code, name: 'Organiser', organiserKey });
    clients.push(host);

    for (let i = 0; i < 4; i++) {
      const c = new Client(wsUrl);
      await c.open();
      const prof = await api('/api/profile', { method: 'POST', body: JSON.stringify({ name: `Player ${i}` }) });
      c.send({ t: 'join', code, name: `Player ${i}`, bib: bibs[i].bib, profileToken: prof.token });
      clients.push(c);
    }
    await host.until('4 players in lobby', (v) => v.players.filter((p) => p.plays).length === 4);
    const players = clients.slice(1);
    for (const c of players) c.send({ t: 'pos', lat: center.lat, lng: center.lng, acc: 5 });

    host.send({ t: 'host', cmd: 'start' });
    await host.until('round live', (v) => v.phase === 'live');
    for (const c of players) await c.until('own role', (v) => v.me.role === 'hunter' || v.me.role === 'runner');
    const hunter = players.find((c) => c.view!.me.role === 'hunter')!;
    const runner = players.find((c) => c.view!.me.role === 'runner')!;
    const runnerBib = runner.view!.me.bib;
    const qr = bibs.find((b: { bib: string }) => b.bib === runnerBib).qr;
    console.log(`live: ${hunter.view!.me.name} hunts ${runner.view!.me.name} (bib ${runnerBib})`);

    const privacy = JSON.stringify(runner.view);
    if (privacy.includes(hunter.view!.me.claimCode)) throw new Error('a runner can see a hunter claim code');

    const scanning = setInterval(() => hunter.send({ t: 'scan', qr }), 250);
    await runner.until('runner sees the scan', (v) => v.hud.beingScanned !== null, 3000);
    await runner.until('runner converted', (v) => v.me.role === 'hunter', 9000);
    clearInterval(scanning);
    console.log('conversion landed');

    host.send({ t: 'host', cmd: 'end', reason: 'organiser' });
    const ended = await host.until('round ended', (v) => v.phase === 'ended' && v.result !== null);
    const hrow = ended.result!.rows.find((r) => r.name === hunter.view!.me.name)!;
    if (hrow.points.hunter !== 25) throw new Error(`expected 25 hunter points, got ${hrow.points.hunter}`);
    await sleep(200);
    const { games } = await api('/api/organiser/games', { org: login.token });
    if (games.length !== 1) throw new Error('round was not saved');
    console.log(`saved: ${games[0].headline}`);
    console.log('SMOKE OK');
  } finally {
    for (const c of clients) c.ws.close();
    server.kill('SIGTERM');
    await sleep(200);
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
