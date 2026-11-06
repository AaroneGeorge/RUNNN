/**
 * End-to-end: serve the real build, open the game in headless Chromium as a hunter,
 * feed the camera a canvas that shows a runner's signed bib QR, and confirm the
 * server converts the runner.
 *
 *   pnpm e2e            (builds first)
 *   node e2e/scan.e2e.mjs   (uses the existing build)
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireWeb = createRequire(join(root, 'apps/web/package.json'));
const requireServer = createRequire(join(root, 'apps/server/package.json'));
const QRCode = requireWeb('qrcode');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const freePort = () =>
  new Promise((ok) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });

class WsClient {
  constructor(url) {
    this.view = null;
    this.ws = new WebSocket(url);
    this.ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.t === 'view') this.view = m.view;
    });
    this.opened = new Promise((ok, fail) => {
      this.ws.addEventListener('open', ok, { once: true });
      this.ws.addEventListener('error', fail, { once: true });
    });
  }
  send(m) {
    this.ws.send(JSON.stringify(m));
  }
  async until(what, fn, ms = 15_000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (this.view && fn(this.view)) return this.view;
      await sleep(50);
    }
    throw new Error(`timed out waiting for: ${what}`);
  }
}

async function main() {
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'runnn-e2e-'));
  const base = `http://localhost:${port}`;
  const tsx = requireServer.resolve('tsx');
  const server = spawn(process.execPath, ['--import', tsx, join(root, 'apps/server/src/index.ts')], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DB_PATH: join(dir, 'e2e.db'),
      BIB_KEY_PATH: join(dir, 'bib.key'),
      ORGANISER_USERNAME: 'e2e',
      ORGANISER_PASSWORD: 'e2e-password',
      MAIL_LOG: 'off',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  let browser;
  const sockets = [];
  try {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`${base}/api/health`)).ok) break;
      } catch {}
      await sleep(100);
    }
    const index = await fetch(base + '/');
    if (!(await index.text()).includes('<div id="root">')) throw new Error('web build not served: run pnpm build first');

    const api = async (path, { body, org } = {}) => {
      const res = await fetch(base + '/api' + path, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', ...(org ? { 'x-organiser-token': org } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`${path}: ${data.error}`);
      return data;
    };

    const { token } = await api('/organiser/login', { body: { username: 'e2e', password: 'e2e-password' } });
    const center = { lat: 51.5, lng: -0.12 };
    const { code, organiserKey } = await api('/rooms', {
      org: token,
      body: {
        title: 'E2E',
        game: 'chase',
        boundary: { type: 'circle', center, radius: 150 },
        config: { releaseDelaySecs: 0, holdSecs: 5, durationSecs: 600 },
      },
    });
    const { bibs } = await api('/bibs?from=100&count=4', { org: token });
    const qrFor = new Map(bibs.map((b) => [b.bib, b.qr]));

    const wsUrl = `ws://localhost:${port}/ws`;
    const host = new WsClient(wsUrl);
    await host.opened;
    host.send({ t: 'join', code, name: 'Organiser', organiserKey });
    sockets.push(host);

    const runners = [];
    for (let i = 1; i <= 3; i++) {
      const c = new WsClient(wsUrl);
      await c.opened;
      c.send({ t: 'join', code, name: `Runner ${i}`, bib: bibs[i].bib });
      runners.push(c);
      sockets.push(c);
    }

    // The browser player: hunter with bib 100, GPS test mode so it has a fix at a desk.
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera'] });
    await context.addInitScript(
      ({ code, bib }) => {
        localStorage.setItem('runnn:settings', JSON.stringify({ seenWelcome: true, gpsTest: true, sound: false, vibrate: false }));
        localStorage.setItem('runnn:sessions', JSON.stringify({ [code]: { name: 'Browser Hunter', bib, at: Date.now() } }));
        // Fake camera: a canvas showing whatever QR the test puts in window.__qr.
        navigator.mediaDevices.getUserMedia = async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 640;
          canvas.height = 480;
          const ctx = canvas.getContext('2d');
          const img = new Image();
          let src = '';
          setInterval(() => {
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, 640, 480);
            if (window.__qr && window.__qr !== src) {
              src = window.__qr;
              img.src = src;
            }
            if (img.complete && img.naturalWidth) ctx.drawImage(img, 160, 80, 320, 320);
          }, 50);
          return canvas.captureStream(15);
        };
        try {
          delete window.BarcodeDetector;
        } catch {}
      },
      { code, bib: bibs[0].bib },
    );
    const page = await context.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await page.goto(`${base}/play/${code}`);
    await host.until('browser player joined', (v) => v.players.some((p) => p.name === 'Browser Hunter'));
    for (const r of runners) r.send({ t: 'pos', lat: center.lat, lng: center.lng, acc: 5 });

    // Sides are dealt at random; re-deal until the browser is a hunter.
    let target = null;
    for (let attempt = 0; attempt < 15 && !target; attempt++) {
      host.send({ t: 'host', cmd: 'start' });
      const v = await host.until('round live', (x) => x.phase === 'live');
      const me = v.players.find((p) => p.name === 'Browser Hunter');
      const runner = v.players.find((p) => p.role === 'runner' && p.name.startsWith('Runner'));
      if (me?.role === 'hunter' && runner) {
        target = runner;
        break;
      }
      host.send({ t: 'host', cmd: 'end', reason: 'other' });
      await host.until('ended', (x) => x.phase === 'ended');
      host.send({ t: 'host', cmd: 'rematch' });
      await host.until('lobby', (x) => x.phase === 'lobby');
    }
    if (!target) throw new Error('browser was never dealt hunter');
    console.log(`browser hunts ${target.name} (bib ${target.bib})`);

    const runnerClient = runners.find((r) => r.view?.me.name === target.name);
    for (const r of runners) r.send({ t: 'pos', lat: center.lat, lng: center.lng, acc: 5 });

    const dataUrl = await QRCode.toDataURL(qrFor.get(target.bib), { width: 320, margin: 2 });
    await page.evaluate((u) => (window.__qr = u), dataUrl);
    await page.getByRole('button', { name: 'Scan a bib' }).click();

    await runnerClient.until('runner sees the camera on their back', (v) => v.hud.beingScanned !== null, 10_000);
    console.log('scan started from the real camera pipeline');
    await runnerClient.until('runner converted', (v) => v.me.role === 'hunter', 15_000);
    await page.getByText(/Caught .*!/).first().waitFor({ timeout: 5000 }).catch(() => {});
    console.log('E2E OK: tag landed');
  } finally {
    for (const s of sockets) s.ws.close();
    await browser?.close();
    server.kill('SIGTERM');
    await sleep(200);
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error('E2E FAILED:', e.message);
  process.exit(1);
});
