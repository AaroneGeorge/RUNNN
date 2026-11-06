import { useState } from 'react';
import { useNavigate } from 'react-router';
import { GAMES, zombieRange, type PlayerSummary } from '@kalikkam/shared';
import type { PlayCtx } from '../pages/Play.tsx';
import { setSession } from '../lib/storage.ts';
import { GameMap } from '../components/GameMap.tsx';
import { ActionBar, Avatar, GameBadge, QR, Sheet, shareText } from '../components/ui.tsx';
import { ArrowRight, Bot, ChevronLeft, Copy, Mic, QrCode, Share2, UserPlus, X } from 'lucide-react';
import { GpsBadge, MyVestSheet, TestModeToggle } from './bits.tsx';
import { EntryCard } from './Entry.tsx';

export function Lobby({ ctx }: { ctx: PlayCtx }) {
  const { view, host, geo, settings } = ctx;
  const nav = useNavigate();
  const meta = GAMES[view.game];
  const me = view.me;
  const players = view.players.filter((p) => !p.isHost || me.isHost || p.role !== 'host');
  const playing = view.players.filter((p) => p.role !== 'host');
  const joinUrl = `${location.origin}/join/${view.code}`;
  const [share, setShare] = useState(false);
  const [myQr, setMyQr] = useState(false);
  const [rules, setRules] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const enough = playing.length >= meta.minPlayers;
  // Same rule the server deals with: about 4 in 10 zombies, always fewer than survivors.
  const [zLo, zHi] = zombieRange(playing.length);

  const leave = () => {
    setSession(view.code, null);
    nav('/');
  };

  return (
    <div className="min-h-dvh">
      <GameMap
        className="h-[38dvh] border-b border-line"
        boundary={view.boundary}
        markers={view.markers}
        fitKey={view.code}
        onTap={settings.simGps ? geo.setSimPos : undefined}
      >
        <div className="absolute left-3 top-[max(.75rem,env(safe-area-inset-top))] z-10 flex gap-2">
          <button aria-label="Back" className="press grid h-10 w-10 place-items-center rounded-xl border border-line bg-night/90 shadow-xl backdrop-blur" onClick={() => nav('/')}>
            <ChevronLeft size={20} strokeWidth={2.5} />
          </button>
          <GpsBadge ctx={ctx} />
        </div>
      </GameMap>

      <div className="mx-auto max-w-xl px-4">
        <div className="-mt-8 relative z-10 mb-4 card p-5">
          <div className="flex items-center gap-4">
            <GameBadge color={meta.color} emoji={meta.emoji} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xl font-extrabold">{view.title}</div>
              <div className="text-sm text-dim">{meta.name} · lobby</div>
            </div>
          </div>
          <button className="press mt-4 flex w-full items-center justify-between rounded-2xl bg-deep p-4 active:bg-raise" onClick={() => setShare(true)}>
            <span className="text-left">
              <span className="label mb-0.5">Game code</span>
              <span className="font-mono text-4xl font-bold tracking-[.25em] text-brand">{view.code}</span>
            </span>
            <span className="btn-brand btn-sm">
              <UserPlus size={16} /> Invite
            </span>
          </button>
        </div>

        <div className="card mb-4 p-4">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 font-bold">
                {me.name} {me.isHost && <span className="chip bg-brand/15 py-0.5 text-brand">host</span>}
              </div>
              <div className="text-sm text-dim">
                {me.plays ? (
                  <>
                    Vest <b className="font-mono text-ink">{me.vest}</b>
                  </>
                ) : (
                  'Referee (not playing)'
                )}
              </div>
            </div>
            {me.plays && (
              <button className="btn-ghost btn-sm" onClick={() => setMyQr(true)}>
                <QrCode size={16} /> My QR
              </button>
            )}
          </div>
          <TestModeToggle ctx={ctx} />
        </div>

        {view.entry && <EntryCard ctx={ctx} />}

        <div className="mb-2 flex items-end justify-between">
          <h2 className="label mb-0">
            Players · {playing.length}
            {!enough && <span className="normal-case tracking-normal text-gold"> need {meta.minPlayers}</span>}
          </h2>
          <button className="text-sm font-bold text-brand" onClick={() => setRules(true)}>
            How to play
          </button>
        </div>
        <p className="mb-2 text-sm text-dim">
          Teams are dealt at random when the game starts
          {enough ? `: ${zLo === zHi ? zLo : `${zLo}–${zHi}`} of ${playing.length} will be zombies.` : '.'}
        </p>
        <div className="card mb-4 divide-y divide-line">
          {players.map((p) => (
            <PlayerRow key={p.id} p={p} ctx={ctx} />
          ))}
        </div>

        {me.isHost && (
          <div className="card mb-4 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Bot size={18} className="text-ink" />
              <span className="font-bold">Practice bots</span>
              {view.players.some((p) => p.isBot) && (
                <button className="ml-auto text-sm font-semibold text-dim active:text-ink" onClick={() => host({ cmd: 'removeBots' })}>
                  Remove all
                </button>
              )}
            </div>
            <div className="mb-2 flex items-center gap-2">
              {[1, 5, 20].map((n) => (
                <button key={n} className="btn-ghost btn-sm flex-1" onClick={() => host({ cmd: 'addBots', n })}>
                  +{n}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-dim">Bots get their team in the same random deal as everyone else. Bot zombies chase and scan, bot survivors run, so you can test a game alone.</p>
          </div>
        )}

        <button className="w-full py-3 text-sm text-dim" onClick={() => (confirmLeave ? leave() : setConfirmLeave(true))}>
          {confirmLeave ? 'Tap again to leave this game' : 'Leave game'}
        </button>
      </div>

      <ActionBar>
        <div>
          {me.isHost ? (
            <button className="btn-brand w-full text-lg" disabled={!enough} onClick={() => host({ cmd: 'start' })}>
              {!enough ? `Waiting for ${meta.minPlayers - playing.length} more…` : <>Start {meta.name} <ArrowRight size={20} strokeWidth={2.6} /></>}
            </button>
          ) : (
            <div className="flex items-center justify-center gap-3 py-3 text-dim">
              <span className="relative flex h-3 w-3">
                <span className="radar-ring absolute inline-flex h-full w-full rounded-full bg-brand" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-brand" />
              </span>
              Waiting for the host to start…
            </div>
          )}
        </div>
      </ActionBar>

      <Sheet open={share} onClose={() => setShare(false)} title="Invite players">
        <div className="flex flex-col items-center gap-4">
          <QR text={joinUrl} size={220} />
          <div className="font-mono text-4xl font-bold tracking-[.3em] text-brand">{view.code}</div>
          <p className="break-all text-center text-sm text-dim">{joinUrl}</p>
          <div className="grid w-full grid-cols-2 gap-2">
            <button className="btn-brand" onClick={() => shareText(`Join my ${meta.name} game ${meta.emoji}. Code ${view.code}`, joinUrl)}>
              <Share2 size={18} /> Share
            </button>
            <button
              className="btn-ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(joinUrl);
                ctx.toast('Link copied', 'good');
              }}
            >
              <Copy size={18} /> Copy link
            </button>
          </div>
        </div>
      </Sheet>
      <MyVestSheet open={myQr} onClose={() => setMyQr(false)} qr={me.vestQr} vest={me.vest} name={me.name} noVest={me.noVest} />
      <Sheet open={rules} onClose={() => setRules(false)} title={`How to play ${meta.name}`}>
        <ol className="list-decimal space-y-2 pl-5 text-[15px] leading-snug">
          {meta.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ol>
        {me.isHost && (
          <>
            <h3 className="label mt-5">Host tips</h3>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-dim">
              {meta.hostTips.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </>
        )}
      </Sheet>
    </div>
  );
}

function PlayerRow({ p, ctx }: { p: PlayerSummary; ctx: PlayCtx }) {
  const { view, host } = ctx;
  const me = view.me;
  const [kick, setKick] = useState(false);
  const editable = me.isHost && p.role !== 'host';
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="relative">
        {p.isBot ? (
          <div className="grid h-10 w-10 place-items-center rounded-full bg-raise text-ink">
            <Bot size={20} />
          </div>
        ) : p.role === 'host' ? (
          <div className="grid h-10 w-10 place-items-center rounded-full bg-brand/15 text-brand">
            <Mic size={18} />
          </div>
        ) : (
          <Avatar name={p.name} size={40} />
        )}
        <span className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-panel ${p.connected ? 'bg-brand' : 'bg-dim'}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">
          {p.name}
          {p.id === me.id && <span className="text-dim"> (you)</span>}
        </div>
        <div className="text-xs text-dim">
          {p.role === 'host' ? 'Referee' : p.vest ? `Vest ${p.vest}` : 'Player'}
          {p.noVest && <span className="text-gold"> · no printed vest</span>}
          {p.paid !== undefined && p.role !== 'host' && <span className={p.paid ? 'font-bold text-ink' : ''}>{p.paid ? ' · paid' : ' · not paid yet'}</span>}
          {p.gpsAgeSec !== undefined && p.role !== 'host' && ` · GPS ±${p.gpsAcc} m`}
          {p.gpsAgeSec === undefined && me.isHost && p.role !== 'host' && !p.isBot && ' · no GPS yet'}
        </div>
      </div>
      {editable && p.id !== me.id && (
        <button
          className={`chip ${kick ? 'bg-blood text-white' : 'text-dim'}`}
          onClick={() => (kick ? host({ cmd: 'kick', target: p.id }) : setKick(true))}
          onBlur={() => setKick(false)}
          aria-label={`Remove ${p.name}`}
        >
          {kick ? 'Remove?' : <X size={16} />}
        </button>
      )}
    </div>
  );
}
