import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import NumberFlow from '@number-flow/react';
import { ArrowRight, FlaskConical, LayoutGrid, LifeBuoy, Map as MapIcon, QrCode, Users, Vibrate, Volume2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { END_REASONS, GAMES, OUT_GRACE_SECS, offset, type ActionDef, type Blip, type Hud, type PlayerSummary, type Role, type Team, type TeamPoints } from '@kalikkam/shared';
import type { PlayCtx } from '../pages/Play.tsx';
import { fmtClock, useNow } from '../lib/time.ts';
import { setSession } from '../lib/storage.ts';
import { setStatusBarColor } from '../lib/theme.ts';
import { GameMap } from '../components/GameMap.tsx';
import { Mascot, Sparkle } from '../components/Mascot.tsx';
import { Sheet } from '../components/ui.tsx';
import { BeingScanned, InfectScanner } from './Infect.tsx';
import { WatchBar, WatchScan } from './Watch.tsx';
import { GpsBadge, GpsWarning, MyVestSheet, ROLE_INFO } from './bits.tsx';

type ZHud = Extract<Hud, { kind: 'zombies' }>;
type RadarData = NonNullable<ZHud['radar']>;

const isTeam = (r: Role | null): r is Team => r === 'zombie' || r === 'survivor';

/** The phone's status bar matches the screen behind it (null: the page colour of the theme in use). */
function useThemeColor(color: string | null) {
  useEffect(() => {
    setStatusBarColor(color);
    return () => setStatusBarColor(null);
  }, [color]);
}

/** Non-zero for a few seconds after `value` goes up (a new infection), so the count can show "+1". */
function useBump(value: number, ms = 2500) {
  const prev = useRef(value);
  const [until, setUntil] = useState(0);
  useEffect(() => {
    if (value > prev.current) setUntil(Date.now() + ms);
    prev.current = value;
  }, [value, ms]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!until) return;
    const t = setTimeout(() => tick((n) => n + 1), Math.max(0, until - Date.now()) + 20);
    return () => clearTimeout(t);
  }, [until]);
  return Date.now() < until ? until : 0;
}

export function Live({ ctx, wakeLock }: { ctx: PlayCtx; wakeLock: boolean }) {
  const { view, geo, settings, host, act, pendingAction } = ctx;
  const nav = useNavigate();
  const now = useNow(250);
  const meta = GAMES[view.game];
  const me = view.me;
  const referee = me.isHost && !me.plays;
  // Simulation host watching through a bot's screen: everything shows, nothing can be pressed.
  const watching = !!view.watching;
  const actions = watching ? [] : me.actions;
  const [menu, setMenu] = useState(false);
  const [scanner, setScanner] = useState(false);
  const [confirm, setConfirm] = useState<ActionDef | null>(null);
  const [codeAsk, setCodeAsk] = useState<ActionDef | null>(null);
  const [myQr, setMyQr] = useState(false);
  const [roster, setRoster] = useState(false);
  const [endAsk, setEndAsk] = useState(false);
  const [areaMap, setAreaMap] = useState(false);
  const [recenter, setRecenter] = useState<{ lat: number; lng: number } | null>(null);
  // Recording mode: hide every button so the screen shows only the game.
  const [clean, setClean] = useState(false);
  useThemeColor(view.phase === 'countdown' ? '#ffc21a' : null);

  // Server-synced clock; frozen while paused.
  const serverNow = view.phase === 'paused' ? view.serverNow : ctx.serverNow();
  const stageLeft = view.stage?.endsAt ? view.stage.endsAt - serverNow : null;
  const myPlayer = view.players.find((p) => p.id === me.id);
  const role = me.role ? ROLE_INFO[me.role] : null;
  const hud = view.hud.kind === 'zombies' ? view.hud : null;
  const radar = hud?.radar ?? null;
  const infectedJustNow = useBump(hud?.zombies ?? 0);
  // A zombie inside half the radar range: the whole screen pulses red.
  const dangerFlash = me.role === 'survivor' && !!radar?.blips.some((b) => b.team === 'zombie' && Math.hypot(b.e, b.n) <= radar.range / 2);

  const onAction = (a: ActionDef) => {
    if (a.input === 'scan') setScanner(true);
    else if (a.input === 'code') setCodeAsk(a);
    else if (a.confirm) setConfirm(a);
    else act(a.id);
  };

  // Test mode: tap the radar to step that many metres from where you are.
  const fix = geo.state.kind === 'ok' ? geo.state.fix : null;
  const stepBy = settings.simGps && fix ? (east: number, north: number) => geo.setSimPos(offset(offset(fix, east, 90), north, 0)) : undefined;

  const selfMarker = view.markers.find((m) => m.self);
  void now;

  if (view.phase === 'countdown') {
    const n = Math.max(1, Math.ceil((stageLeft ?? 0) / 1000));
    const team = isTeam(me.role) ? me.role : null;
    return (
      <div className="fixed inset-0 z-30 flex flex-col items-center justify-center overflow-hidden bg-sun bg-[length:560px] bg-topo px-6">
        <Sparkle size={28} fill="#fff" className="absolute left-[14%] top-[14%]" />
        <Sparkle size={16} fill="#fff" className="absolute right-[18%] top-[22%]" />
        <Sparkle size={20} fill="#fff" className="absolute bottom-[18%] right-[14%]" />
        <div className="text-lg font-bold">{meta.name} starts in</div>
        <div key={n} className="rise font-display font-mono text-[10rem] leading-[.9]">
          {n}
        </div>
        <div className="relative mt-6 flex items-end">
          {team ? (
            <>
              <Mascot team={team} mood={team === 'zombie' ? 'happy' : 'scared'} size={150} live className="mascot-bob" />
              <div className="relative mb-28 -ml-2 max-w-[11.5rem] rounded-[22px] rounded-bl-[6px] border-2 border-ink bg-panel px-4 py-3 text-[15px] font-bold leading-snug">
                {team === 'zombie' ? "You're a zombie. Go get them!" : "You're a survivor. Don't get caught!"}
              </div>
            </>
          ) : (
            <>
              <Mascot team="survivor" mood="scared" size={110} live className="mascot-bob" />
              <Mascot team="zombie" mood="happy" size={140} live className="mascot-bob -ml-4 [animation-delay:-1.4s]" />
            </>
          )}
        </div>
        <p className="mt-8 max-w-xs text-center text-sm font-semibold text-ink/70">Keep this app open with the screen on. Your radar switches on at zero.</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 overflow-hidden">
      {referee && (
        <GameMap
          className="absolute inset-0"
          boundary={view.boundary}
          markers={view.markers}
          fitKey={`${view.code}:${view.startedAt}`}
          center={recenter}
          onTap={settings.simGps ? geo.setSimPos : undefined}
          showLabels={view.players.length <= 40 || referee}
        />
      )}
      {dangerFlash && <div className="danger-flash pointer-events-none absolute inset-0 z-10 bg-blood" />}

      {/* Header and counts, the radar, then actions. For the referee the middle is empty and the map shows through. */}
      <div className="pointer-events-none relative z-20 flex h-full flex-col">
        <div className={`pointer-events-auto pt-[max(.75rem,env(safe-area-inset-top))] ${referee ? 'bg-night/90 pb-1 backdrop-blur' : ''}`}>
          <div className="mx-auto max-w-xl px-4">
            <div className="flex items-center gap-3">
              {!clean && !watching ? (
                <button aria-label="Menu" className="press grid h-12 w-12 shrink-0 place-items-center rounded-full bg-panel" onClick={() => setMenu(true)}>
                  <LayoutGrid size={20} strokeWidth={2.4} />
                </button>
              ) : (
                <span className="w-12" />
              )}
              <div className="min-w-0 flex-1 text-center">
                <div className="truncate text-lg font-extrabold leading-tight">{view.title}</div>
                <div className="truncate text-xs font-semibold text-dim">
                  {role && me.plays ? (
                    <>
                      {role.name} · vest <span className="font-mono">{me.vest}</span>
                    </>
                  ) : (
                    'Referee'
                  )}
                </div>
              </div>
              {me.plays ? (
                <button aria-label="My vest QR" className="press grid h-12 w-12 shrink-0 place-items-center rounded-full bg-ink text-night" onClick={() => setMyQr(true)}>
                  <QrCode size={20} strokeWidth={2.4} />
                </button>
              ) : (
                <button aria-label="Players" className="press grid h-12 w-12 shrink-0 place-items-center rounded-full bg-ink text-night" onClick={() => setRoster(true)}>
                  <Users size={20} strokeWidth={2.4} />
                </button>
              )}
            </div>
            {hud && (
              <div className="relative mx-auto mt-2 flex h-[128px] max-w-[340px] items-center justify-center">
                <StatBlob
                  value={hud.zombies}
                  label="Zombies"
                  size={88}
                  shape="54% 46% 52% 48% / 50% 54% 46% 50%"
                  style={{ marginTop: 34, marginRight: -10 }}
                  badge={infectedJustNow ? <span key={infectedJustNow}>+1</span> : null}
                />
                <StatBlob
                  value={stageLeft !== null ? fmtClock(stageLeft) : '--:--'}
                  label={view.phase === 'paused' ? 'Paused' : view.stage?.key === 'release' ? 'Release in' : 'Time left'}
                  size={120}
                  shape="48% 52% 50% 50% / 52% 48% 52% 48%"
                  warn={stageLeft !== null && stageLeft < 60_000}
                  style={{ zIndex: 1 }}
                />
                <StatBlob value={hud.survivors} label="Survivors" size={88} shape="50% 50% 46% 54% / 46% 52% 48% 54%" style={{ marginTop: 34, marginLeft: -10 }} />
              </div>
            )}
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-xl flex-col gap-2 px-4 pt-2">
          {me.outDeadline !== null && me.plays && (
            <div role="alert" className="pointer-events-auto rounded-2xl border-2 border-ink bg-blood px-4 py-2.5 text-center font-bold text-white">
              🚧 Outside the play area! Back in within{' '}
              <span className="whitespace-nowrap font-mono">{Math.max(0, Math.ceil((me.outDeadline - serverNow) / 1000))} s</span> or you're out.
            </div>
          )}
          {myPlayer?.sos && <div className="rounded-2xl border-2 border-ink bg-blood px-4 py-2 text-center text-sm font-bold text-white">🆘 SOS sent. Hosts can see where you are.</div>}
          <div className="flex flex-wrap justify-center gap-2">
            {view.sim ? <span className="chip bg-panel">Simulation{view.sim.speed > 1 ? ` · ${view.sim.speed}×` : ''}</span> : <GpsBadge ctx={ctx} />}
            {hud?.points && me.plays && <PointsChip points={hud.points} />}
            {!wakeLock && view.phase === 'live' && me.plays && <span className="chip bg-panel text-gold">☀️ keep screen on</span>}
            {settings.simGps && <span className="chip bg-sun-soft">{referee ? 'tap map to move' : 'tap radar to move'}</span>}
          </div>
          {!clean && <WatchBar ctx={ctx} />}
        </div>

        <div className="min-h-0 flex-1 px-4">{!referee && me.plays && <Radar radar={radar} myRole={me.role} onStep={stepBy} />}</div>

        <div className="pointer-events-auto px-4 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-2">
          {clean ? (
            <div className="mx-auto flex max-w-xl flex-col gap-2">
              {referee && <Feed items={view.feed.slice(-3)} compact />}
              <button aria-label="Show controls" className="btn-sm self-end rounded-full bg-panel/60 px-3 text-xs text-dim" onClick={() => setClean(false)}>
                ⚙︎ controls
              </button>
            </div>
          ) : (
            <div className="mx-auto flex max-w-xl flex-col gap-2">
              {referee && selfMarker && (
                <button className="btn-ghost btn-sm self-end" onClick={() => setRecenter({ lat: selfMarker.lat, lng: selfMarker.lng })}>
                  ◎ Me
                </button>
              )}
              <GpsWarning ctx={ctx} />
              {me.catchCode && <CatchCode code={me.catchCode} />}
              {me.hint && <p className="px-2 pb-1 text-center text-[13px] font-semibold leading-snug text-dim">{me.hint}</p>}
              {me.plays && (
                <div className="flex gap-2">
                  <button className="btn-ghost flex-1" onClick={() => setAreaMap(true)}>
                    <MapIcon size={18} strokeWidth={2.4} /> Play area
                  </button>
                  {actions
                    .filter((a) => a.style !== 'primary')
                    .map((a) => (
                      <ActionButton key={a.id} a={a} serverNow={serverNow} busy={pendingAction === a.id} onClick={() => onAction(a)} />
                    ))}
                </div>
              )}
              {actions
                .filter((a) => a.style === 'primary')
                .map((a) => (
                  <ActionButton key={a.id} a={a} serverNow={serverNow} busy={pendingAction === a.id} onClick={() => onAction(a)} />
                ))}
              {me.isHost && (
                <div className="flex gap-2">
                  {view.phase === 'live' ? (
                    <button className="btn-ghost flex-1" onClick={() => host({ cmd: 'pause' })}>
                      ⏸ Pause
                    </button>
                  ) : (
                    <button className="btn-go flex-1" onClick={() => host({ cmd: 'resume' })}>
                      ▶ Resume
                    </button>
                  )}
                  <button className="btn-ghost flex-1" onClick={() => setRoster(true)}>
                    Players
                    {view.players.some((p) => p.sos) && <span className="ml-1 rounded-full bg-blood px-1.5 text-xs text-white">SOS</span>}
                  </button>
                  <button className="btn-ghost text-blood" onClick={() => setEndAsk(true)}>
                    End
                  </button>
                </div>
              )}
              {referee && (
                <button className="btn-ghost btn-sm" onClick={() => setClean(true)}>
                  🎥 Clean view for recording
                </button>
              )}
              {referee && <Feed items={view.feed.slice(-3)} compact />}
            </div>
          )}
        </div>
      </div>

      {view.phase === 'paused' && !me.isHost && !watching && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-night/90 backdrop-blur-sm">
          <Mascot team={isTeam(me.role) ? me.role : 'survivor'} mood="idle" size={110} />
          <div className="font-display mt-4 text-[28px]">Game paused</div>
          <p className="mt-1 font-semibold text-dim">Stay where you are. The host will resume.</p>
        </div>
      )}

      {!me.plays && !me.isHost && view.entry && !watching && (
        <div className="absolute inset-x-4 top-1/3 z-30 mx-auto max-w-sm rounded-[28px] border-2 border-ink bg-panel p-6 text-center">
          <div className="font-display text-[24px]">You're watching</div>
          <p className="mt-2 font-semibold text-dim">You didn't pay the entry before the start, so you sit this round out. Pay for the rematch to play.</p>
        </div>
      )}
      {me.status === 'eliminated' && !watching && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-night/95 px-8 text-center backdrop-blur-sm">
          <Mascot team={isTeam(me.role) ? me.role : 'survivor'} mood="sad" size={120} />
          <div className="font-display mt-4 text-[30px]">You're out</div>
          <p className="mt-2 max-w-xs font-semibold text-dim">
            You stayed outside the play area for {OUT_GRACE_SECS} s, so you score no points this round. Please stay off the field until the next game.
          </p>
          <button
            className="btn-ghost mt-6"
            onClick={() => {
              setSession(view.code, null);
              nav('/');
            }}
          >
            Leave game
          </button>
        </div>
      )}

      {codeAsk && me.role === 'survivor' && (
        <CodeSheet a={codeAsk} serverNow={serverNow} busy={pendingAction === codeAsk.id} onClose={() => setCodeAsk(null)} onSubmit={(code) => act(codeAsk.id, code)} />
      )}
      {scanner && me.role === 'zombie' && view.phase === 'live' && <InfectScanner ctx={ctx} onClose={() => setScanner(false)} />}
      {me.role === 'survivor' && <BeingScanned ctx={ctx} />}
      <WatchScan ctx={ctx} />
      <Sheet open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.label}>
        <p className="mb-5 text-dim">{confirm?.confirm}</p>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-ghost" onClick={() => setConfirm(null)}>
            Cancel
          </button>
          <button
            className="btn-blood"
            onClick={() => {
              if (confirm) act(confirm.id);
              setConfirm(null);
            }}
          >
            Yes
          </button>
        </div>
      </Sheet>
      <Sheet open={endAsk} onClose={() => setEndAsk(false)} title="End the game now?">
        <p className="mb-4 text-dim">The game stops and everyone sees the results. Why are you ending it? It's saved with the game.</p>
        <div className="grid gap-2">
          {END_REASONS.map((r) => (
            <button
              key={r.id}
              className="btn-ghost justify-start text-blood"
              onClick={() => {
                host({ cmd: 'end', reason: r.id });
                setEndAsk(false);
              }}
            >
              End: {r.label.toLowerCase()}
            </button>
          ))}
        </div>
        <button className="btn-brand mt-3 w-full" onClick={() => setEndAsk(false)}>
          Keep playing
        </button>
      </Sheet>
      <Sheet open={areaMap} onClose={() => setAreaMap(false)} title="Play area">
        <p className="-mt-2 mb-3 text-sm text-dim">Only you are on this map. Stay inside the dashed line.</p>
        <GameMap
          className="mb-4 h-[55dvh] overflow-hidden rounded-3xl border-2 border-ink"
          boundary={view.boundary}
          markers={view.markers}
          fitKey={view.code}
          onTap={settings.simGps ? geo.setSimPos : undefined}
          showLabels={false}
        />
      </Sheet>
      <MyVestSheet open={myQr} onClose={() => setMyQr(false)} qr={me.vestQr} vest={me.vest} name={me.name} noVest={me.noVest} />
      <RosterSheet open={roster} onClose={() => setRoster(false)} ctx={ctx} />
      <Sheet open={menu} onClose={() => setMenu(false)} title={view.title}>
        <div className="flex flex-col gap-2">
          {me.plays && (
            <button
              className="btn-ghost justify-start"
              onClick={() => {
                setMenu(false);
                setMyQr(true);
              }}
            >
              <QrCode size={18} /> My vest &amp; QR <span className="font-mono ml-auto text-dim">{me.vest}</span>
            </button>
          )}
          {me.plays && (
            <button
              className={myPlayer?.sos ? 'btn-ghost justify-start' : 'btn-blood justify-start'}
              onClick={() => {
                ctx.send({ t: 'sos', on: !myPlayer?.sos });
                setMenu(false);
              }}
            >
              <LifeBuoy size={18} /> {myPlayer?.sos ? 'Cancel SOS' : 'I need help (alerts the host)'}
            </button>
          )}
          <div className="grid grid-cols-3 gap-2">
            <Toggle label={<><Volume2 size={16} /> Sound</>} on={settings.sound} set={(v) => ctx.setSettings({ ...settings, sound: v })} />
            <Toggle label={<><Vibrate size={16} /> Buzz</>} on={settings.vibrate} set={(v) => ctx.setSettings({ ...settings, vibrate: v })} />
            <Toggle label={<><FlaskConical size={16} /> Test GPS</>} on={settings.simGps} set={(v) => ctx.setSettings({ ...settings, simGps: v })} />
          </div>
          <h3 className="label mt-3">Rules</h3>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-snug text-dim">
            {meta.rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ol>
          <h3 className="label mt-3">What's happening</h3>
          <Feed items={view.feed.slice(-15).reverse()} />
          <button
            className="mt-2 py-2 text-sm font-semibold text-dim"
            onClick={() => {
              if (!me.isHost) setSession(view.code, null);
              nav('/');
            }}
          >
            {me.isHost ? 'Go home (game keeps running)' : 'Quit game'}
          </button>
        </div>
      </Sheet>
    </div>
  );
}

function Toggle({ label, on, set }: { label: ReactNode; on: boolean; set: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      className={`press flex items-center justify-center gap-1.5 rounded-full border-2 py-2.5 text-sm font-bold transition-colors ${on ? 'border-ink bg-sun' : 'border-line text-dim'}`}
      onClick={() => set(!on)}
    >
      {label}
    </button>
  );
}

function ActionButton({ a, serverNow, busy, onClick }: { a: ActionDef; serverNow: number; busy: boolean; onClick: () => void }) {
  const cd = a.cooldownUntil ? a.cooldownUntil - serverNow : 0;
  const primary = a.style === 'primary';
  const cls = primary ? 'btn-brand w-full justify-between px-7 py-5 text-lg' : a.style === 'danger' ? 'btn-blood flex-1' : 'btn-ghost flex-1';
  return (
    <button className={cls} disabled={a.disabled || cd > 0 || busy} onClick={onClick}>
      {cd > 0 ? `🔒 ${Math.ceil(cd / 1000)} s` : busy ? '…' : a.label}
      {primary && !a.disabled && <ArrowRight size={22} strokeWidth={2.6} />}
    </button>
  );
}

function Feed({ items, compact }: { items: PlayCtx['view']['feed']; compact?: boolean }) {
  const color = { info: 'text-dim', good: 'text-ink', bad: 'text-blood', alert: 'text-gold' } as const;
  if (!items.length) return <p className="text-sm text-dim">Nothing yet.</p>;
  return (
    <div className={`flex flex-col gap-1 ${compact ? 'rounded-2xl bg-panel/95 p-3 text-xs' : 'text-sm'}`}>
      {items.map((f) => (
        <div key={f.id} className={`font-semibold ${color[f.kind]}`}>
          <span className="font-mono mr-2 text-[10px] text-dim">
            {new Date(f.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          </span>
          {f.text}
        </div>
      ))}
    </div>
  );
}

// ---- HUD ----------------------------------------------------------------------

/** A count in an organic white blob (each blob a slightly different shape), with an optional "+1" badge. */
function StatBlob({
  value,
  label,
  size,
  shape,
  warn,
  badge,
  style,
}: {
  value: number | string;
  label: string;
  size: number;
  shape: string;
  warn?: boolean;
  badge?: ReactNode;
  style?: CSSProperties;
}) {
  const big = size > 100;
  return (
    <div className="relative grid shrink-0 place-items-center bg-panel text-center" style={{ width: size, height: size, borderRadius: shape, ...style }}>
      <div>
        <div className={`font-display font-mono leading-none ${big ? 'text-[30px]' : 'text-[26px]'} ${warn ? 'text-blood' : ''}`}>
          {typeof value === 'number' ? <NumberFlow value={value} /> : value}
        </div>
        <div className="mt-1 text-[12px] font-bold text-ink/70">{label}</div>
      </div>
      {badge && (
        <span className="bump-in font-display absolute -right-1 -top-1 grid h-9 w-9 place-items-center rounded-full border-2 border-ink bg-sun text-sm">{badge}</span>
      )}
    </div>
  );
}

// ---- Radar --------------------------------------------------------------------

const R = 100; // radar radius in SVG units
const VB = 126; // half the viewBox: room for the crosshair ticks and the N
const rad = (deg: number) => (deg * Math.PI) / 180;
const fmtM = (m: number) => `${Number.isInteger(m) ? m : m.toFixed(1)}m`;

/**
 * Everyone within radar range, north-up, with you (your character) in the middle. The radar is drawn as a big
 * crosshair: an inked rim with ticks at the compass points, dashed distance rings. Yellow dots are zombies, white dots
 * survivors; the nearest player from the other team gets a crosshair that locks on when the target changes.
 * In test mode `onStep` moves you by the metres you tapped.
 */
function Radar({ radar, myRole, onStep }: { radar: RadarData | null; myRole: Role | null; onStep?: (east: number, north: number) => void }) {
  const blips = radar?.blips ?? [];
  const k = radar ? R / radar.range : 0;
  const z = blips.filter((b) => b.team === 'zombie').length;
  const s = blips.length - z;
  const enemy = isTeam(myRole) ? blips.filter((b) => b.team !== myRole) : [];
  const nearest = enemy.length ? enemy.reduce((a, b) => (Math.hypot(a.e, a.n) <= Math.hypot(b.e, b.n) ? a : b)) : null;
  const threatened = myRole === 'survivor' && !!nearest && Math.hypot(nearest.e, nearest.n) <= (radar?.range ?? 0) / 2;

  const tap = (e: MouseEvent<SVGSVGElement>) => {
    if (!onStep || !radar) return;
    const box = e.currentTarget.getBoundingClientRect();
    // The viewBox is square and centred ("meet"), so scale by the shorter side.
    const unit = Math.min(box.width, box.height) / (2 * VB);
    const x = (e.clientX - (box.left + box.width / 2)) / unit;
    const y = (e.clientY - (box.top + box.height / 2)) / unit;
    onStep((x / R) * radar.range, (-y / R) * radar.range);
  };

  return (
    <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center">
      <svg
        viewBox={`${-VB} ${-VB} ${2 * VB} ${2 * VB}`}
        className={`block min-h-0 w-full flex-1 ${onStep ? 'pointer-events-auto cursor-crosshair' : ''}`}
        role="img"
        aria-label={radar ? `Radar: ${z} zombies and ${s} survivors within ${radar.range} metres` : 'Radar: waiting for GPS'}
        onClick={tap}
      >
        {/* Crosshair ticks at N, E, S, W */}
        {[0, 90, 180, 270].map((a) => (
          <line
            key={a}
            x1={(R + 5) * Math.sin(rad(a))}
            y1={-(R + 5) * Math.cos(rad(a))}
            x2={(R + 16) * Math.sin(rad(a))}
            y2={-(R + 16) * Math.cos(rad(a))}
            stroke="var(--color-ink)"
            strokeWidth="3.4"
            strokeLinecap="round"
          />
        ))}
        <text x={9} y={-(R + 9)} fontSize="10" fontWeight="900" fill="var(--color-ink)">
          N
        </text>
        <circle r={R} fill="#fff" stroke="#141414" strokeWidth="3.4" />
        {[0.25, 0.5, 0.75].map((f) => (
          <circle key={f} r={R * f} fill="none" stroke="#141414" strokeOpacity=".16" strokeWidth="1.4" strokeDasharray="3 4" />
        ))}
        {radar && (
          <g fontSize="7.5" fontWeight="800" fill="#6b665c">
            {[0.5, 1].map((f) => (
              <text key={f} transform={`rotate(-45) translate(0 ${R * f - 4.5})`} textAnchor="middle">
                {fmtM(radar.range * f)}
              </text>
            ))}
          </g>
        )}
        {radar && <circle className="radar-ping" r={R} fill="none" stroke="#ffc21a" strokeWidth="3" />}
        {blips.map((b) => (
          <BlipDot key={b.key} b={b} k={k} locked={b.key === nearest?.key} />
        ))}
        {isTeam(myRole) && (
          <g transform="translate(-19 -21)">
            <Mascot team={myRole} mood={threatened ? 'scared' : 'idle'} size={38} />
          </g>
        )}
        {!radar && (
          <text y={34} textAnchor="middle" fontSize="9" fontWeight="700" fill="#6b665c">
            Waiting for GPS…
          </text>
        )}
      </svg>
      <div className="pointer-events-auto flex items-center gap-1.5 pb-1 text-sm font-bold">
        {!radar ? (
          <span className="text-dim">📡 The radar needs a GPS fix</span>
        ) : blips.length === 0 ? (
          <span className="text-dim">Nobody within {radar.range} m</span>
        ) : (
          <>
            {z > 0 && (
              <>
                <Dot team="zombie" /> {z} zombie{z === 1 ? '' : 's'}
              </>
            )}
            {z > 0 && s > 0 && <span className="text-dim">·</span>}
            {s > 0 && (
              <>
                <Dot team="survivor" /> {s} survivor{s === 1 ? '' : 's'}
              </>
            )}
            <span className="text-dim">within {radar.range} m</span>
          </>
        )}
      </div>
    </div>
  );
}

function Dot({ team }: { team: Team }) {
  return <span className="inline-block h-3 w-3 rounded-full border-2 border-ink" style={{ background: ROLE_INFO[team].color }} />;
}

function BlipDot({ b, k, locked }: { b: Blip; k: number; locked: boolean }) {
  return (
    <g className="radar-blip" style={{ transform: `translate(${b.e * k}px, ${-b.n * k}px)` }}>
      {locked && (
        // Mounts when this blip becomes the nearest enemy, so the lock-on plays once per new target.
        <g className="radar-lock" stroke="#141414" strokeWidth="2.4" strokeLinecap="round" fill="none">
          <circle r="13" />
          <path d="M0 -19 V-15 M0 15 V19 M-19 0 H-15 M15 0 H19" />
        </g>
      )}
      <circle r="6.2" fill={b.team === 'zombie' ? '#ffc21a' : '#fff'} stroke="#141414" strokeWidth="2.4" />
    </g>
  );
}

// ---- Host roster --------------------------------------------------------------

/** A zombie's private catch code: a survivor they catch without a scan types it to give them the infection. */
function CatchCode({ code }: { code: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border-2 border-ink bg-sun px-4 py-2.5">
      <div className="text-left">
        <div className="text-[11px] font-bold uppercase tracking-wider">Your catch code</div>
        <div className="text-[13px] font-semibold leading-snug text-ink/75">Tell it to anyone you catch without a scan.</div>
      </div>
      <div className="font-display font-mono text-[30px] tracking-[.16em]" aria-label={`Your catch code: ${code.split('').join(' ')}`}>
        {code}
      </div>
    </div>
  );
}

/** "I got infected": type the code from the zombie's phone, so that zombie gets the points. */
function CodeSheet({ a, serverNow, busy, onClose, onSubmit }: { a: ActionDef; serverNow: number; busy: boolean; onClose: () => void; onSubmit: (code: string) => void }) {
  const [code, setCode] = useState('');
  const [unsure, setUnsure] = useState(false);
  const wait = a.cooldownUntil ? Math.ceil((a.cooldownUntil - serverNow) / 1000) : 0;
  return (
    <Sheet open onClose={onClose} title={unsure ? 'Turn without a code?' : 'Who caught you?'}>
      {unsure ? (
        <>
          <p className="mb-5 text-dim">You turn into a zombie now, and nobody gets the points for catching you.</p>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-ghost" onClick={() => setUnsure(false)}>
              Back
            </button>
            <button className="btn-blood" disabled={busy} onClick={() => onSubmit('')}>
              Turn zombie
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mb-4 text-dim">Ask the zombie for the 4-digit code on their phone and type it here. They get the points for catching you.</p>
          <input
            aria-label="Zombie's catch code"
            className="field mb-3 text-center font-mono text-4xl font-bold tracking-[.5em]"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            enterKeyHint="done"
            placeholder="0000"
            maxLength={4}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && code.length === 4 && wait <= 0) onSubmit(code);
            }}
          />
          <button className="btn-blood w-full text-lg" disabled={code.length !== 4 || busy || wait > 0} onClick={() => onSubmit(code)}>
            {wait > 0 ? `Too many wrong codes: wait ${wait} s` : busy ? 'Checking…' : "I'm infected"}
          </button>
          <button className="mt-3 w-full py-2 text-sm font-semibold text-dim" onClick={() => setUnsure(true)}>
            I don't know the code
          </button>
        </>
      )}
    </Sheet>
  );
}

/** Your points so far on each board you're on: survivors earn by the minute, zombies per infection. */
function PointsChip({ points }: { points: TeamPoints }) {
  const sides = (['survivor', 'zombie'] as const).filter((s) => points[s] !== null);
  return (
    <span className="chip border-2 border-ink bg-sun" aria-label={sides.map((s) => `${points[s]} ${ROLE_INFO[s].name.toLowerCase()} points`).join(', ')}>
      {sides.map((s, i) => (
        <span key={s} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-ink/40">·</span>}
          {ROLE_INFO[s].emoji} <NumberFlow value={points[s]!} />
        </span>
      ))}
      <span>pts</span>
    </span>
  );
}

function RosterSheet({ open, onClose, ctx }: { open: boolean; onClose: () => void; ctx: PlayCtx }) {
  const { view, host } = ctx;
  const players = [...view.players]
    .filter((p) => p.role !== 'host')
    .sort((a, b) => Number(b.sos) - Number(a.sos) || String(a.role).localeCompare(String(b.role)) || a.name.localeCompare(b.name));
  return (
    <Sheet open={open} onClose={onClose} title={`Players · ${players.length}`}>
      <div className="flex flex-col divide-y divide-line">
        {players.map((p: PlayerSummary) => (
          <div key={p.id} className="flex items-center gap-3 py-2.5">
            {p.sos ? <div className="text-xl">🆘</div> : isTeam(p.role) ? <Mascot team={p.role} size={34} /> : <div className="text-xl">🙂</div>}
            <div className="min-w-0 flex-1">
              <div className="truncate font-bold">
                {p.name} <span className="font-mono text-xs text-dim">#{p.vest}</span>
              </div>
              <div className="text-xs font-semibold text-dim">
                {p.connected ? 'online' : 'offline'}
                {p.gpsAgeSec !== undefined ? ` · GPS ${p.gpsAgeSec}s ago ±${p.gpsAcc}m` : ' · no GPS'}
                {p.suspicious && <span className="text-blood"> · ⚠️ too fast</span>}
                {p.status === 'eliminated' && <span className="text-blood"> · out (left the area)</span>}
                {p.role === 'zombie' && p.catchCode && p.status !== 'eliminated' && <span> · code {p.catchCode}</span>}
              </div>
            </div>
            {p.sos && (
              <button className="chip bg-blood text-white" onClick={() => host({ cmd: 'clearSos', target: p.id })}>
                Clear
              </button>
            )}
          </div>
        ))}
      </div>
    </Sheet>
  );
}
