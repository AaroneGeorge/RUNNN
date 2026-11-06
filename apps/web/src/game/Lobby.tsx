import { Bot, Copy, Play, QrCode, Share2, UserX } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { GAMES } from '@runnn/shared';
import { GameMap } from '../components/GameMap.tsx';
import { Avatar, Button, Card, ListRow, Pill, Section, Sheet } from '../components/ui.tsx';
import { notify, toastError } from '../lib/toast.ts';
import { minutes } from '../lib/time.ts';
import { Countdown, type GameCtx } from './bits.tsx';

function JoinQr({ url }: { url: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) QRCode.toCanvas(ref.current, url, { width: 240, margin: 1 }).catch(() => {});
  }, [url]);
  return <canvas ref={ref} className="mx-auto rounded-2xl bg-white p-2" />;
}

export function Lobby({ view, send, serverNow, geo }: GameCtx) {
  const me = view.me;
  const meta = GAMES[view.game];
  const playing = view.players.filter((p) => p.plays);
  const [qrOpen, setQrOpen] = useState(false);
  const joinUrl = `${location.origin}/join/${view.code}`;
  const counting = view.phase === 'countdown';
  const enough = playing.length >= meta.minPlayers;

  const host = (cmd: Parameters<typeof send>[0]) => {
    if (!send(cmd)) toastError('Not connected. Wait a moment.');
  };

  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: view.title, text: `Join "${view.title}" with code ${view.code}`, url: joinUrl });
      else {
        await navigator.clipboard.writeText(joinUrl);
        notify('Link copied', 'good');
      }
    } catch {
      /* cancelled */
    }
  };

  if (counting) {
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-ink px-6 text-center text-night">
        <div className="rise">
          <div className="text-sm font-bold uppercase tracking-[0.2em] text-night/60">Starting in</div>
          <Countdown endsAt={view.stage?.endsAt ?? null} serverNow={serverNow} className="block text-[8rem] font-black leading-none" />
          <p className="mx-auto mt-6 max-w-xs text-lg font-bold">{me.roleIntro}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 pb-32">
      <header className="safe-top pb-2">
        <div className="text-xs font-bold uppercase tracking-[0.18em] text-dim">{meta.emoji} {meta.name} · lobby</div>
        <h1 className="text-3xl font-black tracking-tight">{view.title}</h1>
      </header>

      <Card className="mt-2 flex items-center gap-4">
        <div className="flex-1">
          <div className="text-xs font-bold uppercase tracking-widest text-dim">Game code</div>
          <div className="text-5xl font-black tracking-[0.15em]">{view.code}</div>
        </div>
        <div className="flex flex-col gap-2">
          <Button size="sm" variant="secondary" icon={<Share2 className="size-4" />} onClick={share}>
            Share
          </Button>
          <Button size="sm" variant="secondary" icon={<QrCode className="size-4" />} onClick={() => setQrOpen(true)}>
            QR
          </Button>
        </div>
      </Card>

      {me.plays && (
        <Card className="mt-3">
          <div className="flex items-center gap-3">
            <Avatar name={me.name} color={me.color} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-extrabold">{me.name}</div>
              <div className="text-sm text-dim">
                {me.noBib ? 'No bib: you can only be caught by claim code.' : `Bib ${me.bib}`} ·{' '}
                {geo.fix ? `GPS ±${Math.round(geo.fix.acc)} m` : geo.error ?? 'Waiting for GPS…'}
              </div>
            </div>
          </div>
        </Card>
      )}

      <div className="mt-3 h-52 overflow-hidden rounded-3xl ring-1 ring-line">
        <GameMap boundary={view.boundary} markers={view.markers} fitKey={view.code} />
      </div>

      <Section title={`Players · ${playing.length}`} action={!enough && <Pill>Need {meta.minPlayers}+</Pill>}>
        <Card className="py-1">
          {view.players.length === 0 && <div className="py-4 text-center text-dim">Nobody yet. Share the code!</div>}
          {view.players.map((p) => (
            <ListRow
              key={p.id}
              left={<Avatar name={p.name.replace('🤖', '')} size={36} color={p.isBot ? '#6b665c' : p.color} />}
              title={
                <span className="flex items-center gap-2">
                  {p.name}
                  {p.id === me.id && <Pill>You</Pill>}
                  {p.isHost && <Pill tone="dark">Organiser</Pill>}
                </span>
              }
              sub={[!p.plays && 'watching', p.bib ? `bib ${p.bib}` : p.plays && !p.isBot && me.isHost ? 'no bib' : null, !p.connected && 'offline']
                .filter(Boolean)
                .join(' · ')}
              right={
                me.isHost &&
                !p.isHost && (
                  <button aria-label={`Remove ${p.name}`} onClick={() => host({ t: 'host', cmd: 'kick', target: p.id })} className="p-2 text-dim">
                    <UserX className="size-5" />
                  </button>
                )
              }
            />
          ))}
        </Card>
      </Section>

      <Section title="This round">
        <Card>
          <div className="flex flex-wrap gap-2">
            <Pill>{minutes(view.config.durationSecs)}</Pill>
            <Pill>Head start {view.config.releaseDelaySecs}s</Pill>
            <Pill>Hold {view.config.holdSecs}s</Pill>
            <Pill>Radar {view.config.radarRange} m</Pill>
          </div>
          <p className="mt-3 text-sm text-dim">{meta.tagline} The app deals the sides when the round starts.</p>
        </Card>
      </Section>

      {view.feed.length > 0 && (
        <Section title="Activity">
          <div className="space-y-1 px-1 text-sm text-dim">
            {view.feed
              .slice(-5)
              .reverse()
              .map((f) => (
                <div key={f.id}>{f.text}</div>
              ))}
          </div>
        </Section>
      )}

      <div className="safe-bottom fixed inset-x-0 bottom-0 z-10 bg-gradient-to-t from-night via-night to-transparent px-4 pt-8">
        <div className="mx-auto flex max-w-xl gap-2">
          {me.isHost ? (
            <>
              <Button variant="secondary" icon={<Bot className="size-5" />} onClick={() => host({ t: 'host', cmd: 'addBots', n: 3 })}>
                +3
              </Button>
              <Button block size="lg" icon={<Play className="size-5" />} disabled={!enough} onClick={() => host({ t: 'host', cmd: 'start' })}>
                {enough ? 'Start round' : `Waiting for ${meta.minPlayers - playing.length} more`}
              </Button>
            </>
          ) : (
            <div className="w-full rounded-full bg-panel py-4 text-center font-bold ring-1 ring-line">Waiting for the organiser to start…</div>
          )}
        </div>
      </div>

      <Sheet open={qrOpen} onClose={() => setQrOpen(false)} title="Scan to join">
        <JoinQr url={joinUrl} />
        <button
          onClick={() => navigator.clipboard?.writeText(joinUrl).then(() => notify('Link copied', 'good'))}
          className="mx-auto mt-4 mb-6 flex items-center gap-2 text-sm font-bold text-dim"
        >
          <Copy className="size-4" /> {joinUrl}
        </button>
      </Sheet>
    </div>
  );
}
