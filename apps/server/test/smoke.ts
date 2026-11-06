// End-to-end smoke test against a running server: host sign-in → HTTP create → WS join →
// bots → start → play to the end. Usage: HOST_USERNAME=… HOST_PASSWORD=… tsx test/smoke.ts [baseUrl]
// (a host account on that server: `pnpm --filter @kalikkam/server hosts add <username>`).
import WebSocket from 'ws';
import type { RoomView, ServerMsg } from '@kalikkam/shared';

const BASE = process.argv[2] ?? 'http://127.0.0.1:2567';
const center = { lat: 9.9822, lng: 76.2763 };

async function post(path: string, body: unknown, token?: string, hostToken?: string) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(hostToken ? { 'x-host-token': hostToken } : {}),
    },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path}: ${j.error}`);
  return j;
}

function client(code: string, join: Record<string, unknown>) {
  const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws');
  const state: { view: RoomView | null; toasts: string[]; errors: string[]; id?: string } = { view: null, toasts: [], errors: [] };
  ws.on('open', () => ws.send(JSON.stringify({ t: 'join', code, ...join })));
  ws.on('message', (d) => {
    const m: ServerMsg = JSON.parse(d.toString());
    if (m.t === 'view') state.view = m.view;
    if (m.t === 'toast') state.toasts.push(m.text);
    if (m.t === 'error') state.errors.push(m.msg);
    if (m.t === 'joined') state.id = m.playerId;
  });
  return { ws, state, send: (m: unknown) => ws.send(JSON.stringify(m)) };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { HOST_USERNAME, HOST_PASSWORD } = process.env;
  if (!HOST_USERNAME || !HOST_PASSWORD) throw new Error('Set HOST_USERNAME and HOST_PASSWORD to a host account on the server');
  // Only hosts can create games.
  const noHost = await fetch(BASE + '/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  if (noHost.status !== 403) throw new Error(`a guest could create a game (${noHost.status})`);
  const hostSession = await post('/api/host/login', { username: HOST_USERNAME, password: HOST_PASSWORD });
  const prof = { token: hostSession.profileToken as string };
  const { code, hostKey } = await post(
    '/api/rooms',
    {
      game: 'zombies',
      title: 'Smoke test',
      boundary: { type: 'circle', center, radius: 100 },
      config: { durationSecs: 300, zombieDelaySecs: 0 },
      hostName: 'Smoke Host',
      hostPlays: false,
    },
    prof.token,
    hostSession.token,
  );
  console.log('room', code);
  const host = client(code, { name: 'Smoke Host', hostKey, profileToken: prof.token });
  const p2 = await post('/api/profile', { name: 'Smoke Player' });
  const player = client(code, { name: 'Smoke Player', vest: '777', profileToken: p2.token });
  await wait(600);
  const dupe = client(code, { name: 'Dupe', vest: '777' });
  await wait(400);
  if (!dupe.state.errors.some((e) => /taken/.test(e))) throw new Error('duplicate vest not rejected');
  player.send({ t: 'pos', ...center, acc: 6 });
  host.send({ t: 'host', cmd: 'addBots', n: 8 });
  await wait(500);
  if (host.state.view?.players.length !== 10) throw new Error(`expected 10 players, got ${host.state.view?.players.length}`);
  if (host.state.view.players.some((p) => p.role !== 'host' && p.role !== null)) throw new Error('teams dealt before the start');
  // A non-host cannot start the game.
  player.send({ t: 'host', cmd: 'start' });
  await wait(300);
  if (!player.state.errors.some((e) => /Only the host/.test(e))) throw new Error('non-host start not rejected');
  host.send({ t: 'host', cmd: 'start' });
  await wait(6500);
  const pv = player.state.view!;
  console.log('phase', pv.phase, 'my role', pv.me.role, 'hud', pv.hud.kind, 'markers', pv.markers.length);
  if (pv.phase !== 'live') throw new Error('not live');
  if (pv.me.role !== 'survivor' && pv.me.role !== 'zombie') throw new Error(`no team dealt, got ${pv.me.role}`);
  if (pv.hud.kind !== 'zombies' || pv.hud.zombies + pv.hud.survivors !== 9 || pv.hud.zombies >= pv.hud.survivors || pv.hud.zombies < 1) {
    throw new Error(`bad deal: ${JSON.stringify(pv.hud)}`);
  }
  console.log('dealt', pv.hud.zombies, 'zombies,', pv.hud.survivors, 'survivors; I am a', pv.me.role);
  // Players only see themselves on the map; everyone else is on the radar, without names.
  if (pv.markers.some((m) => m.kind === 'player' && !m.self)) throw new Error('other players leaked onto the map');
  if (pv.hud.kind !== 'zombies' || !pv.hud.radar) throw new Error('no radar');
  const radarJson = JSON.stringify(pv.hud.radar);
  if (pv.players.some((p) => p.id !== pv.me.id && (radarJson.includes(p.id) || radarJson.includes(p.name)))) throw new Error('radar leaks names or ids');
  console.log('radar', pv.hud.radar.range, 'm,', pv.hud.radar.blips.length, 'blips');
  if (pv.players.some((p) => p.id !== pv.me.id && p.vest)) throw new Error('vest numbers leaked');
  // Keep the player alive & moving for a bit, pause/resume works.
  host.send({ t: 'host', cmd: 'pause' });
  await wait(400);
  if (player.state.view?.phase !== 'paused') throw new Error('pause failed');
  host.send({ t: 'host', cmd: 'resume' });
  await wait(1500);
  host.send({ t: 'host', cmd: 'end' });
  await wait(800);
  const res = player.state.view!.result;
  console.log('result:', res?.headline);
  if (!res) throw new Error('no result');
  await wait(300);
  console.log('player toasts:', player.state.toasts.slice(-3));
  const me = await fetch(BASE + '/api/me', { headers: { authorization: `Bearer ${p2.token}` } }).then((r) => r.json());
  console.log('player profile after game:', me.profile.gamesPlayed, 'games,', me.profile.xp, 'xp, badges:', me.profile.badges.map((b: { id: string }) => b.id));
  if (me.profile.gamesPlayed !== 1) throw new Error('result not saved to profile');
  for (const c of [host, player, dupe]) c.ws.close();
  console.log('✅ smoke test passed');
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
