import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { END_REASONS, type HostGameLog, type HostGameRow, type HostRoomRow } from '@kalikkam/shared';
import { api, hostSignOut } from '../lib/api.ts';
import { getHost, getSession, setSession } from '../lib/storage.ts';
import { relTime } from '../lib/time.ts';
import { Empty, ErrorBox, Sheet, Spinner, TopBar } from '../components/ui.tsx';
import { Bot, CalendarPlus, ChevronRight, LogOut, Mic, Radio } from 'lucide-react';

const PHASE: Record<string, string> = { lobby: 'in the lobby', countdown: 'starting', live: 'live', paused: 'paused' };
const reasonLabel = (id: string | null) => END_REASONS.find((r) => r.id === id)?.label ?? null;
const clock = (secs: number) => `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;

/** Host HQ: start things, open any running game as its host, and read what happened in finished games. */
export function HQPage() {
  const nav = useNavigate();
  const host = getHost();
  const [live, setLive] = useState<HostRoomRow[] | null>(null);
  const [games, setGames] = useState<HostGameRow[] | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<HostGameRow | null>(null);

  useEffect(() => {
    api<HostRoomRow[]>('/api/host/rooms').then(setLive).catch((e) => setErr(e.message));
    api<HostGameRow[]>('/api/host/games').then(setGames).catch((e) => setErr(e.message));
  }, []);

  // Any host can take over any running game: the room's host key goes into this phone's session.
  const openAsHost = (r: HostRoomRow) => {
    setSession(r.code, { ...(getSession(r.code) ?? {}), hostKey: r.hostKey, name: host?.username ?? 'Host' });
    nav(`/play/${r.code}`);
  };

  if (!host) return null;
  return (
    <div className="page">
      <TopBar
        title="Host HQ"
        back="/"
        right={
          <button
            className="btn-ghost btn-sm"
            onClick={async () => {
              await hostSignOut();
              nav('/', { replace: true });
            }}
          >
            <LogOut size={16} /> Sign out
          </button>
        }
      />
      <p className="-mt-3 mb-4 text-sm font-semibold text-dim">Signed in as {host.username}</p>

      <div className="mb-6 grid grid-cols-3 gap-2">
        {[
          { to: '/host', label: 'New game', Icon: Mic },
          { to: '/events/new', label: 'Plan event', Icon: CalendarPlus },
          { to: '/sim', label: 'Bot test', Icon: Bot },
        ].map(({ to, label, Icon }) => (
          <Link key={to} to={to} className="card press flex flex-col items-center gap-2 p-4 text-center active:bg-raise">
            <span className="grid h-11 w-11 place-items-center rounded-full border-2 border-ink bg-sun">
              <Icon size={20} strokeWidth={2.4} />
            </span>
            <span className="text-sm font-bold">{label}</span>
          </Link>
        ))}
      </div>

      {err && (
        <div className="mb-4">
          <ErrorBox>{err}</ErrorBox>
        </div>
      )}

      <h2 className="label">Running now</h2>
      {!live && !err && <Spinner />}
      {live && live.length === 0 && <p className="mb-6 px-1 text-sm text-dim">No games running.</p>}
      {live && live.length > 0 && (
        <div className="card mb-6 divide-y divide-line">
          {live.map((r) => (
            <button key={r.code} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-raise" onClick={() => openAsHost(r)}>
              <Radio size={18} className={r.phase === 'live' ? 'text-blood' : 'text-dim'} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold">
                  {r.title} {r.sim && <span className="chip ml-1 bg-raise py-0 text-dim">bots</span>}
                </div>
                <div className="text-xs text-dim">
                  <span className="font-mono">{r.code}</span> · {r.players} players · {PHASE[r.phase] ?? r.phase}
                </div>
              </div>
              <span className="text-sm font-bold">Open</span>
              <ChevronRight size={16} className="text-dim" />
            </button>
          ))}
        </div>
      )}

      <h2 className="label">Finished games</h2>
      {!games && !err && <Spinner />}
      {games && games.length === 0 && <Empty title="No games yet">Finished games show up here with their logs.</Empty>}
      {games && games.length > 0 && (
        <div className="card divide-y divide-line">
          {games.map((g) => (
            <button key={g.id} className="flex w-full items-start gap-3 px-4 py-3 text-left active:bg-raise" onClick={() => setOpen(g)}>
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold">{g.title}</div>
                <div className="truncate text-xs text-dim">
                  {relTime(g.endedAt)} · {g.players} players · {g.headline}
                </div>
                <GameFlags g={g} />
              </div>
              <ChevronRight size={16} className="mt-1 text-dim" />
            </button>
          ))}
        </div>
      )}
      {open && <LogSheet game={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** The problems a test run usually has, at a glance. */
function GameFlags({ g }: { g: HostGameRow }) {
  const flags: { text: string; bad?: boolean }[] = [];
  const total = g.infections.scan + g.infections.code + g.infections.unknown;
  if (total) flags.push({ text: `${total} infected: ${g.infections.scan} scan · ${g.infections.code} code · ${g.infections.unknown} no credit`, bad: g.infections.unknown > 0 });
  if (g.endReason) flags.push({ text: `ended early: ${reasonLabel(g.endReason)?.toLowerCase()}`, bad: g.endReason === 'broken' });
  if (g.eliminated) flags.push({ text: `${g.eliminated} out of bounds` });
  if (g.gpsDropouts) flags.push({ text: `${g.gpsDropouts} GPS dropout${g.gpsDropouts === 1 ? '' : 's'}`, bad: true });
  if (!g.hasLog) flags.push({ text: 'no log (older game)' });
  if (!flags.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {flags.map((f) => (
        <span key={f.text} className={`chip py-0.5 text-[11px] ${f.bad ? 'bg-blood/10 text-blood' : 'bg-raise text-dim'}`}>
          {f.text}
        </span>
      ))}
    </div>
  );
}

type Entry = HostGameLog['log'][number];

/** One log line in words. `who` turns a player id into a name. */
function describe(e: Entry, who: (id: unknown) => string): string | null {
  switch (e.kind) {
    case 'start':
      return `Started with ${(e.players as unknown[]).length} players`;
    case 'scan':
      return e.outcome === 'started' ? `${who(e.p)} started scanning ${who(e.target)}` : e.outcome === 'broken' ? `${who(e.target)} broke ${who(e.p)}'s scan (${e.secs} s)` : null;
    case 'reject':
      return `${who(e.p)}'s scan was refused: ${e.why}`;
    case 'infect':
      return e.how === 'scan'
        ? `🧟 ${who(e.by)} infected ${who(e.p)} by scan`
        : e.how === 'code'
          ? `🧟 ${who(e.p)} was caught by ${who(e.by)} (catch code)`
          : `🧟 ${who(e.p)} turned without a code: nobody credited`;
    case 'code':
      return e.ok ? null : `${who(e.p)} typed a wrong catch code`;
    case 'out':
      return e.outcome === 'warned' ? `🚧 ${who(e.p)} left the play area` : e.outcome === 'back' ? `${who(e.p)} came back in (${e.secs} s)` : `🚫 ${who(e.p)} was eliminated (out of the area)`;
    case 'host':
      return e.action === 'end'
        ? `Host ended the game${e.reason ? `: ${reasonLabel(String(e.reason))?.toLowerCase()}` : ''}${typeof e.left === 'number' ? ` with ${clock(e.left)} left` : ''}`
        : e.action === 'pause'
          ? 'Host paused'
          : e.action === 'resume'
            ? 'Host resumed'
            : `Host removed ${who(e.p)}`;
    case 'join':
      return `${e.name} joined late as ${e.as}`;
    case 'sos':
      return e.on ? `🆘 ${who(e.p)} sent an SOS` : `${who(e.p)} cancelled the SOS`;
    case 'end':
      return 'Game over';
    default:
      return null;
  }
}

function LogSheet({ game, onClose }: { game: HostGameRow; onClose: () => void }) {
  const [data, setData] = useState<HostGameLog | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api<HostGameLog>(`/api/host/games/${game.id}`).then(setData).catch((e) => setErr(e.message));
  }, [game.id]);
  const start = data?.log.find((e) => e.kind === 'start');
  const names = new Map(((start?.players as { id: string; name: string }[] | undefined) ?? []).map((p) => [p.id, p.name]));
  const who = (id: unknown) => (typeof id === 'string' ? (names.get(id) ?? 'someone') : 'nobody');
  const gps = data?.log.filter((e) => e.kind === 'gps') ?? [];
  return (
    <Sheet open onClose={onClose} title={game.title}>
      {err && <ErrorBox>{err}</ErrorBox>}
      {!data && !err && <Spinner />}
      {data && (
        <>
          <p className="mb-1 font-bold">{data.result.headline}</p>
          {data.result.lines.map((l) => (
            <p key={l} className="text-sm text-dim">
              {l}
            </p>
          ))}
          {gps.length > 0 && (
            <>
              <h3 className="label mt-5">GPS per player</h3>
              <div className="mb-2 grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1 text-sm">
                {gps.map((g) => (
                  <div key={String(g.p)} className="contents">
                    <span className="truncate font-semibold">{who(g.p)}</span>
                    <span className={Number(g.gaps) > 0 ? 'font-bold text-blood' : 'text-dim'}>
                      {Number(g.gaps)} dropout{Number(g.gaps) === 1 ? '' : 's'}
                      {Number(g.gaps) > 0 ? `, longest ${g.longestGap} s` : ''}
                    </span>
                    <span className="text-dim">±{String(g.avgAcc ?? '?')} m</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-dim">A dropout is 20 s or more without a location: that player vanished from radars.</p>
            </>
          )}
          <h3 className="label mt-5">What happened</h3>
          {data.log.length === 0 && <p className="text-sm text-dim">This game was played before logs existed.</p>}
          <ol className="space-y-1.5 text-sm">
            {data.log.map((e, i) => {
              const text = describe(e, who);
              return text ? (
                <li key={i} className="flex gap-3">
                  <span className="w-10 shrink-0 text-right font-mono text-dim">{clock(e.t)}</span>
                  <span>{text}</span>
                </li>
              ) : null;
            })}
          </ol>
        </>
      )}
    </Sheet>
  );
}
