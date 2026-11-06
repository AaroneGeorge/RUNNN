// Full-game browser test: real server, real UI, three phones. The zombie's "camera" is a video of a
// printed vest QR (Chrome's fake media device), so the scan-and-hold infection runs for real.
//
//   pnpm e2e            screenshots land in e2e/out/
//
// Needs Chrome (CHROME_PATH, default /opt/google/chrome/chrome) and ffmpeg. Uses its own server, DB and
// vest key in a temp dir, so it never touches the live game.
import { chromium } from 'playwright-core';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const QRCode = require('qrcode');
const PORT = 2690;
const B = `http://127.0.0.1:${PORT}`;
const OUT = new URL('./out', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const TMP = mkdtempSync(pathJoin(tmpdir(), 'kalikkam-e2e-'));
const server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
  cwd: new URL('../apps/server', import.meta.url).pathname,
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DB_PATH: pathJoin(TMP, 'e2e.db'), VEST_KEY_PATH: pathJoin(TMP, 'vest.key') },
  stdio: 'ignore',
});
const fail = (msg) => {
  console.error(`❌ ${msg}`);
  server.kill();
  process.exit(1);
};
process.on('unhandledRejection', (e) => fail(e?.message ?? String(e)));
for (let i = 0; i < 40; i++) {
  try {
    if ((await fetch(`${B}/api/health`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
// 1. The printed vest for 222, as the camera will see it.
const [{ qr }] = await (await fetch(`${B}/api/vests?from=222&count=1`)).json();
await QRCode.toFile(`${OUT}/vest222.png`, qr, { width: 600, margin: 4 });
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-loop', '1', '-i', `${OUT}/vest222.png`, '-vf', 'pad=1280:720:(ow-iw)/2:(oh-ih)/2:white,format=yuv420p', '-t', '3', '-r', '15', `${OUT}/cam.y4m`]);

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/google/chrome/chrome',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${OUT}/cam.y4m`],
});
const phone = async (name) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['camera'] });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  return p;
};

// 2. Host creates a game (referee, not playing).
const res = await fetch(`${B}/api/rooms`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ game: 'zombies', title: 'E2E night', hostName: 'Host', hostPlays: false, boundary: { type: 'circle', center: { lat: 9.9785, lng: 76.2795 }, radius: 150 }, config: { zombieDelaySecs: 0, scanSecs: 5 } }),
});
const { code, hostKey } = await res.json();
const host = await phone('host');
await host.goto(B);
await host.evaluate(([c, k]) => localStorage.setItem(`klk.session.${c}`, JSON.stringify({ hostKey: k, name: 'Host' })), [code, hostKey]);
await host.goto(`${B}/play/${code}`);

// 3. Three players join through the real Join screen, each picking a team.
const join = async (name, vest, team) => {
  const p = await phone(name);
  await p.goto(`${B}/join/${code}`);
  await p.getByPlaceholder('What should we call you?').fill(name);
  await p.getByRole('radio', { name: team }).click();
  await p.locator('#jvest').fill(vest);
  await p.getByRole('button', { name: /^Join Zombies/ }).click();
  await p.waitForURL(`**/play/${code}`);
  return p;
};
const zed = await join('Zed', '111', 'Zombie');
const anu = await join('Anu', '222', 'Survivor');
const bobby = await join('Bobby', '333', 'Survivor');
await sleep(1500);
await shot(host, '01-lobby-host');

// 4. Teams were picked on the Join screen; the host just starts.
await host.getByRole('button', { name: /Start Zombies/ }).click();
await sleep(7500); // 5 s countdown + roles
await shot(anu, '03-anu-live');
await shot(zed, '04-zed-live');

// 5. Zed opens the camera; it "sees" Anu's back QR continuously.
await zed.getByRole('button', { name: /Scan a survivor/ }).click();
await sleep(2200);
await shot(anu, '06-anu-being-infected');
await shot(zed, '05-zed-scanning');
await sleep(5000);
await shot(zed, '07-zed-after');
await sleep(800);
await shot(anu, '08-anu-after');
if (!/Zombie/.test(await anu.locator('body').innerText())) fail('Anu was not infected by the 5 s scan');
console.log('✓ scan-and-hold infected the survivor');

// 6. Host ends the game; results.
await zed.getByRole('button', { name: 'Close camera' }).click();
await host.getByRole('button', { name: 'End' }).click();
await sleep(400);
await host.locator('[role=dialog] .btn-blood').click();
await sleep(2000);
await shot(host, '09-results');
const results = await host.locator('body').innerText();
if (!/Top infector: Zed \(1\)/.test(results)) fail('results are missing the infection');
if (!/Survivors win/.test(results)) fail('Bobby was still standing, so survivors should win');
if (!/Bobby/.test(results.split('Players')[1] ?? '')) fail('no player list');
console.log('✓ results: survivors win, zombie credited for the infection');
await browser.close();
server.kill();
if (errors.length) fail(`page errors:\n${errors.join('\n')}`);
console.log(`✅ e2e passed, screenshots in ${OUT}`);
