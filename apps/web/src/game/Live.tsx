import { Camera, Flag, Map as MapIcon, Pause, Play, Radar as RadarIcon, Siren } from 'lucide-react';
import { useEffect, useState } from 'react';
import { END_REASON_LABEL, type ActionDef, type EndReason, type PlayerSummary } from '@runnn/shared';
import { GameMap } from '../components/GameMap.tsx';
import { Avatar, Button, Card, Input, KeyValue, ListRow, Pill, Segmented, Sheet, cx } from '../components/ui.tsx';
import { useNow, useWakeLock } from '../lib/hooks.ts';
import { getSettings } from '../lib/storage.ts';
import { clock } from '../lib/time.ts';
import { toastError } from '../lib/toast.ts';
import { ConnBadge, Countdown, Points, Radar, RoleBadge, SosButton, type GameCtx } from './bits.tsx';
import { useGeiger } from './radar.ts';
import { Scanner } from './Scanner.tsx';

function TopBar({ view, serverNow, status }: GameCtx) {
  const paused = view.phase === 'paused';
  const { hunters, runners, out } = view.hud.counts;
  return (
    <div className="safe-top sticky top-0 z-20 bg-night/95 px-4 pb-3 backdrop-blur">
      <div className="flex items-center gap-2">
        <RoleBadge role={view.me.role} />
        {view.me.status === 'eliminated' && <Pill tone="dark">Out</Pill>}
        <div className="flex-1" />
        <ConnBadge status={status} />
      </div>
      <div className="mt-2 flex items-end justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-dim">{paused ? 'Paused' : view.stage?.label}</div>
          <Countdown endsAt={view.stage?.endsAt ?? null} serverNow={serverNow} paused={paused} className="text-5xl font-black leading-none" />
        </div>
        <div className="text-right text-sm font-bold">
          <div className="text-hunter">🎯 {hunters} hunters</div>
          <div className="text-runner">🏃 {runners} runners</div>
          {out > 0 && <div className="text-dim">💤 {out} out</div>}
        </div>
      </div>
    </div>
  );
}

/** Full-screen alarm while someone holds a camera on your back. */
function BeingScanned({ startedAt, holdMs, serverNow }: { startedAt: number; holdMs: number; serverNow: () => number }) {
  useNow(60);
  const left = Math.max(0, 1 - (serverNow() - startedAt) / holdMs);
  useEffect(() => {
    if (!getSettings().vibrate) return;
    const id = setInterval(() => navigator.vibrate?.([120, 80, 120]), 700);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="alarm-edges pointer-events-none fixed inset-0 z-30 flex flex-col items-center justify-center bg-alarm/25 text-center">
      <div className="rounded-3xl bg-alarm px-6 py-5 text-white shadow-2xl">
        <div className="text-3xl font-black">YOU’RE BEING SCANNED</div>
        <div className="mt-1 font-bold">Move! Turn! Break their line of sight!</div>
        <div className="mt-4 h-3 w-64 overflow-hidden rounded-full bg-white/30">
          <div className="h-full bg-white transition-[width] duration-100" style={{ width: `${left * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

function OutWarning({ deadline, serverNow }: { deadline: number; serverNow: () => number }) {
  useNow(250);
  return (
    <div className="fixed inset-x-3 top-3 z-30 rounded-2xl bg-alarm p-4 text-center text-white shadow-xl">
      <div className="text-lg font-black">OUTSIDE THE AREA</div>
      <div className="font-bold">Get back in within {clock(deadline - serverNow())}</div>
    </div>
  );
}

function CaughtSheet({ action, open, onClose, onSubmit }: { action: ActionDef; open: boolean; onClose: () => void; onSubmit: (code?: string) => void }) {
  const [code, setCode] = useState('');
  const now = useNow(500);
  const cooling = action.cooldownUntil && action.cooldownUntil > now;
  return (
    <Sheet open={open} onClose={onClose} title="Caught?">
      <p className="mb-4 text-dim">Ask the hunter who caught you for the 4-digit claim code on their screen, so they get the points.</p>
      <Input
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        placeholder="1234"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
        className="text-center text-3xl font-black tracking-[0.4em]"
      />
      <div className="mt-4 mb-2 grid gap-2">
        <Button variant="danger" size="lg" block disabled={code.length !== 4 || !!cooling} onClick={() => onSubmit(code)}>
          {cooling ? `Wait ${Math.ceil((action.cooldownUntil! - now) / 1000)} s` : 'Confirm I was caught'}
        </Button>
        {action.confirm && (
          <Button variant="ghost" block onClick={() => onSubmit(undefined)}>
            {action.confirm}
          </Button>
        )}
      </div>
    </Sheet>
  );
}

function PlayerView(ctx: GameCtx) {
  const { view, send, serverNow, geo, testMode, watching } = ctx;
  const me = view.me;
  const [tab, setTab] = useState<'radar' | 'map'>('radar');
  const [scanner, setScanner] = useState(false);
  const [caughtOpen, setCaughtOpen] = useState(false);
  const out = me.status === 'eliminated';
  const hunter = me.role === 'hunter' && !out;
  const caught = me.actions.find((a) => a.id === 'caught');
  useGeiger(view.hud.radar, me.role, !out && view.phase === 'live' && getSettings().sound && !watching);

  // Close the camera if we stop being a hunter (e.g. eliminated).
  useEffect(() => {
    if (!hunter) setScanner(false);
  }, [hunter]);

  const act = (id: string, code?: string) => {
    if (watching) return;
    if (!send({ t: 'act', action: id, code })) toastError('Not connected. Try again in a moment.');
    setCaughtOpen(false);
  };

  return (
    <div className="pb-36">
      <TopBar {...ctx} />
      <div className="mx-auto max-w-xl px-4">
        <div className="mt-1 rounded-2xl bg-panel p-3 text-sm font-semibold ring-1 ring-line">{me.hint}</div>

        <Segmented
          className="mt-3"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'radar', label: <span className="inline-flex items-center gap-1.5"><RadarIcon className="size-4" />Radar</span> },
            { value: 'map', label: <span className="inline-flex items-center gap-1.5"><MapIcon className="size-4" />Map</span> },
          ]}
        />

        {tab === 'radar' ? (
          <div className="mt-4 flex flex-col items-center">
            <Radar radar={view.hud.radar} role={me.role} size={Math.min(300, window.innerWidth - 48)} />
            {geo.error && !testMode && <p className="mt-3 text-center text-sm font-semibold text-alarm">{geo.error}</p>}
          </div>
        ) : (
          <div className="mt-3 h-[52dvh] overflow-hidden rounded-3xl ring-1 ring-line">
            <GameMap
              boundary={view.boundary}
              markers={view.markers}
              fitKey="live"
              onTap={testMode && !watching ? geo.moveTo : undefined}
            />
          </div>
        )}
        {testMode && !watching && tab === 'map' && <p className="mt-2 text-center text-xs font-bold text-dim">Test mode: tap the map to move.</p>}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Card className="p-3">
            <div className="text-xs font-bold uppercase tracking-wider text-dim">Your points</div>
            <Points points={me.points} className="mt-1 text-xl" />
          </Card>
          <Card className="p-3">
            <div className="text-xs font-bold uppercase tracking-wider text-dim">{hunter ? 'Your claim code' : 'Your bib'}</div>
            <div className="mt-1 text-2xl font-black tabular">{hunter ? me.claimCode : me.noBib ? '—' : me.bib}</div>
          </Card>
        </div>

        {view.feed.length > 0 && (
          <div className="mt-4 space-y-1 px-1 text-sm text-dim">
            {view.feed
              .slice(-4)
              .reverse()
              .map((f) => (
                <div key={f.id} className={cx(f.kind === 'alert' && 'font-bold text-ink')}>
                  {f.text}
                </div>
              ))}
          </div>
        )}
      </div>

      {!watching && !out && (
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-night via-night to-transparent px-4 pt-8">
          <div className="mx-auto flex max-w-xl items-center gap-2">
            <SosButton on={me.sos} onChange={(on) => send({ t: 'sos', on })} />
            {hunter && (
              <Button block size="lg" icon={<Camera className="size-6" />} onClick={() => setScanner(true)} disabled={view.phase !== 'live'}>
                Scan a bib
              </Button>
            )}
            {caught && (
              <Button block size="lg" variant="dark" onClick={() => setCaughtOpen(true)}>
                {caught.label}
              </Button>
            )}
          </div>
        </div>
      )}

      {view.hud.beingScanned && me.role === 'runner' && <BeingScanned {...view.hud.beingScanned} serverNow={serverNow} />}
      {me.outDeadline && !out && <OutWarning deadline={me.outDeadline} serverNow={serverNow} />}
      {scanner && hunter && <Scanner view={view} send={send} serverNow={serverNow} onClose={() => setScanner(false)} />}
      {caught && <CaughtSheet action={caught} open={caughtOpen} onClose={() => setCaughtOpen(false)} onSubmit={(c) => act('caught', c)} />}
      {view.phase === 'paused' && (
        <div className="fixed inset-0 z-30 grid place-items-center bg-ink/80 text-center text-night">
          <div>
            <Pause className="mx-auto size-14" />
            <div className="mt-2 text-3xl font-black">Paused</div>
            <div className="font-semibold text-night/70">Stay where you are.</div>
          </div>
        </div>
      )}
    </div>
  );
}

const END_CHOICES: EndReason[] = ['organiser', 'weather', 'safety', 'other'];

/** The non-playing organiser: full map with names, claim codes, SOS, controls. */
function RefereeView(ctx: GameCtx) {
  const { view, send } = ctx;
  const [selected, setSelected] = useState<string | null>(null);
  const [endOpen, setEndOpen] = useState(false);
  const paused = view.phase === 'paused';
  const players = view.players.filter((p) => p.plays);
  const sos = players.filter((p) => p.sos);
  const sel = players.find((p) => p.id === selected);

  const cmd = (m: Parameters<typeof send>[0]) => {
    if (!send(m)) toastError('Not connected.');
  };

  const row = (p: PlayerSummary) => (
    <ListRow
      key={p.id}
      onClick={() => setSelected(p.id)}
      left={<Avatar name={p.name.replace('🤖', '')} size={34} color={p.color} />}
      title={
        <span className="flex items-center gap-1.5">
          {p.emoji} {p.name} {p.sos && <Pill tone="alarm">SOS</Pill>} {p.suspicious && <Pill>GPS?</Pill>}
        </span>
      }
      sub={[p.bib && `bib ${p.bib}`, p.claimCode && `code ${p.claimCode}`, p.gpsAge !== null && p.gpsAge !== undefined ? `GPS ${p.gpsAge}s ±${p.gpsAcc}m` : 'no GPS', !p.connected && 'offline']
        .filter(Boolean)
        .join(' · ')}
      right={<Points points={p.points} className="text-sm" />}
    />
  );

  return (
    <div className="pb-32">
      <TopBar {...ctx} />
      <div className="mx-auto max-w-3xl px-4">
        {sos.length > 0 && (
          <div className="mb-3 rounded-2xl bg-alarm p-3 text-white">
            {sos.map((p) => (
              <div key={p.id} className="flex items-center gap-2">
                <Siren className="size-5 animate-pulse" />
                <span className="flex-1 font-extrabold">SOS: {p.name}</span>
                <Button size="sm" variant="secondary" onClick={() => cmd({ t: 'host', cmd: 'clearSos', target: p.id })}>
                  Seen it
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className="h-[46dvh] overflow-hidden rounded-3xl ring-1 ring-line">
          <GameMap boundary={view.boundary} markers={view.markers} fitKey="ref" onMarker={setSelected} />
        </div>
        <Card className="mt-3 py-1">{players.map(row)}</Card>
        <div className="mt-3 space-y-1 px-1 text-sm text-dim">
          {view.feed
            .slice(-8)
            .reverse()
            .map((f) => (
              <div key={f.id}>{f.text}</div>
            ))}
        </div>
      </div>

      <div className="safe-bottom fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-night via-night to-transparent px-4 pt-8">
        <div className="mx-auto flex max-w-xl gap-2">
          <Button
            block
            variant="secondary"
            icon={paused ? <Play className="size-5" /> : <Pause className="size-5" />}
            onClick={() => cmd({ t: 'host', cmd: paused ? 'resume' : 'pause' })}
          >
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button block variant="danger" icon={<Flag className="size-5" />} onClick={() => setEndOpen(true)}>
            End round
          </Button>
        </div>
      </div>

      <Sheet open={endOpen} onClose={() => setEndOpen(false)} title="End the round now?">
        <p className="mb-3 text-dim">Points so far are kept. Pick why, so everyone sees it on the results.</p>
        <div className="mb-4 grid gap-2">
          {END_CHOICES.map((r) => (
            <Button
              key={r}
              variant={r === 'safety' ? 'danger' : 'secondary'}
              block
              onClick={() => {
                cmd({ t: 'host', cmd: 'end', reason: r });
                setEndOpen(false);
              }}
            >
              {END_REASON_LABEL[r]}
            </Button>
          ))}
        </div>
      </Sheet>

      <Sheet open={!!sel} onClose={() => setSelected(null)} title={sel?.name}>
        {sel && (
          <>
            <KeyValue
              items={[
                ['Side', sel.role ?? '—'],
                ['Status', sel.status],
                ['Bib', sel.bib || 'none'],
                ['Claim code', <span className="tabular">{sel.claimCode}</span>],
                ['GPS', sel.gpsAge !== null && sel.gpsAge !== undefined ? `${sel.gpsAge}s old, ±${sel.gpsAcc} m` : 'no fix'],
                ['Connection', sel.connected ? 'online' : 'offline'],
              ]}
            />
            {!sel.isHost && (
              <div className="mt-4 mb-4">
                <Button
                  variant="secondary"
                  block
                  onClick={() => {
                    cmd({ t: 'host', cmd: 'kick', target: sel.id });
                    setSelected(null);
                  }}
                >
                  Remove from game
                </Button>
              </div>
            )}
          </>
        )}
      </Sheet>
    </div>
  );
}

export function Live(ctx: GameCtx) {
  useWakeLock(!ctx.watching);
  const referee = ctx.view.me.isHost && !ctx.view.me.plays && !ctx.watching;
  return referee ? <RefereeView {...ctx} /> : <PlayerView {...ctx} />;
}
