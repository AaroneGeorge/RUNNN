// End-to-end $1 entry game against a running server on Arc Testnet (spends test USDC from the operator).
// Start the server with World ID off (a script can't do a selfie): WORLD_APP_ID= ... then:
//   HOST_USERNAME=… HOST_PASSWORD=… tsx test/entry-e2e.ts http://127.0.0.1:2578
import WebSocket from 'ws';
import type { RoomView, ServerMsg } from '@kalikkam/shared';

const BASE = process.argv[2] ?? 'http://127.0.0.1:2578';
const center = { lat: 9.9822, lng: 76.2763 };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function call(path: string, body: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(BASE + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path}: ${j.error}`);
  return j;
}
function client(code: string, join: Record<string, unknown>) {
  const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws');
  const state: { view: RoomView | null; errors: string[] } = { view: null, errors: [] };
  ws.on('open', () => ws.send(JSON.stringify({ t: 'join', code, ...join })));
  ws.on('message', (d) => {
    const m: ServerMsg = JSON.parse(d.toString());
    if (m.t === 'view') state.view = m.view;
    if (m.t === 'error') state.errors.push(m.msg);
  });
  return { ws, state, send: (m: unknown) => ws.send(JSON.stringify(m)) };
}

const host = await call('/api/host/login', { username: process.env.HOST_USERNAME, password: process.env.HOST_PASSWORD });
const hostH = { authorization: `Bearer ${host.profileToken}`, 'x-host-token': host.token };
const { code, hostKey } = await call(
  '/api/rooms',
  { game: 'zombies', title: 'Paid test night', boundary: { type: 'circle', center, radius: 120 }, config: { durationSecs: 300, zombieDelaySecs: 0 }, hostName: 'Host', hostPlays: false, entry: true },
  hostH,
);
console.log('room', code);
const h = client(code, { name: 'Host', hostKey, profileToken: host.profileToken });
const players = [];
for (const [name, vest] of [['Anu', '201'], ['Bobby', '202'], ['Zed', '203']]) {
  const prof = await call('/api/profile', { name });
  const c = client(code, { name, vest, profileToken: prof.token });
  players.push({ name, token: prof.token, c });
}
await wait(800);
for (const p of players) p.c.send({ t: 'pos', ...center, acc: 6 });

// Not enough paid players yet: the start is refused.
h.send({ t: 'host', cmd: 'start' });
await wait(500);
console.log('start before paying:', h.state.errors.at(-1));

for (const p of players) {
  const auth = { authorization: `Bearer ${p.token}` };
  const w = await call('/api/wallet', undefined, auth);
  const t = await call('/api/wallet/topup', {}, auth);
  const e = await call(`/api/rooms/${code}/entry`, {}, auth);
  console.log(`${p.name}: wallet ${w.address}, topped up to ${t.balance} USDC, entry tx ${e.tx}`);
}
await wait(600);
console.log('pot:', h.state.view?.entry);

h.send({ t: 'host', cmd: 'start' });
await wait(6500);
console.log('phase', h.state.view?.phase);
for (let i = 0; i < 12; i++) {
  for (const p of players) p.c.send({ t: 'pos', ...center, acc: 6 });
  await wait(1000);
}
h.send({ t: 'host', cmd: 'end', reason: 'testing' });
for (let i = 0; i < 40 && h.state.view?.result?.payout?.status !== 'paid' && h.state.view?.result?.payout?.status !== 'refunded' && h.state.view?.result?.payout?.status !== 'failed'; i++) await wait(1000);
const res = h.state.view?.result;
console.log('result:', res?.headline);
console.log('payout:', JSON.stringify(res?.payout));
for (const p of players) {
  const w = await call('/api/wallet', undefined, { authorization: `Bearer ${p.token}` });
  console.log(`${p.name} balance after: ${w.balance} USDC`);
}
for (const c of [h, ...players.map((p) => p.c)]) c.ws.close();
if (res?.payout?.status !== 'paid' && res?.payout?.status !== 'refunded') process.exitCode = 1;
