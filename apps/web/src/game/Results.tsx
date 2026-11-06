import { Home, RotateCcw } from 'lucide-react';
import { Link } from 'react-router';
import { END_REASON_LABEL, TEAM_PLURAL } from '@runnn/shared';
import { Mascot } from '../components/Mascot.tsx';
import { Button, Card, Pill, Section, cx } from '../components/ui.tsx';
import { clock } from '../lib/time.ts';
import { Points, type GameCtx } from './bits.tsx';

export function Results({ view, send, watching }: GameCtx) {
  const r = view.result;
  if (!r) return null;
  const me = view.me;
  const mine = r.rows.find((x) => x.playerId === me.id);
  const won = !!mine?.won;

  return (
    <div className="mx-auto max-w-xl px-4 pb-32">
      <div className={cx('safe-top -mx-4 px-4 pb-8 text-center', r.winner === 'hunter' ? 'bg-hunter' : r.winner === 'runner' ? 'bg-runner' : 'bg-ink', 'text-white')}>
        <div className="mx-auto mt-4 w-fit text-white">
          <Mascot mood={mine ? (won ? 'win' : 'sad') : 'wait'} size={110} />
        </div>
        <div className="text-sm font-bold uppercase tracking-[0.2em] opacity-80">{END_REASON_LABEL[r.reason]}</div>
        <h1 className="mt-1 text-4xl font-black">{r.winner ? `${TEAM_PLURAL[r.winner]} win!` : 'Round over'}</h1>
        <p className="mx-auto mt-2 max-w-sm font-semibold opacity-90">{r.headline}</p>
        <div className="mt-2 text-sm opacity-75">Played {clock(r.durationSecs * 1000)}</div>
      </div>

      {mine && (
        <Card className="-mt-5 relative">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="text-xs font-bold uppercase tracking-widest text-dim">You</div>
              <div className="text-2xl font-black">{won ? 'You won 🎉' : 'Good run'}</div>
            </div>
            {mine.xp !== undefined && <Pill tone="accent">+{mine.xp} XP</Pill>}
          </div>
          <Points points={mine.points} className="mt-2 text-2xl" />
          <div className="mt-1 text-sm text-dim">
            {mine.conversions > 0 && `${mine.conversions} caught · `}
            {mine.survivedSecs > 0 && `${clock(mine.survivedSecs * 1000)} as a runner`}
          </div>
          {!me.profileId && !me.isBot && (
            <Link to="/me" className="mt-3 block text-sm font-bold underline">
              Make a profile to keep your XP next time
            </Link>
          )}
        </Card>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        {(['runner', 'hunter'] as const).map((k) => {
          const top = r.top[k];
          return (
            <Card key={k} className="p-3">
              <div className={cx('text-xs font-bold uppercase tracking-wider', k === 'runner' ? 'text-runner' : 'text-hunter')}>
                Top {k}
              </div>
              <div className="mt-1 truncate font-extrabold">{top ? top.names.join(', ') : '—'}</div>
              <div className="tabular text-2xl font-black">{top?.points ?? 0}</div>
            </Card>
          );
        })}
      </div>

      <Section title="Everyone">
        <Card className="py-1">
          {r.rows.map((x, i) => (
            <div key={x.playerId} className={cx('flex items-center gap-3 py-2.5', x.playerId === me.id && 'font-black')}>
              <span className="w-6 text-right tabular text-dim">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">
                {x.name} {x.won && '🏆'} {x.status === 'eliminated' && '💤'}
              </span>
              <Points points={x.points} className="text-sm" />
            </div>
          ))}
        </Card>
        {r.eliminated.length > 0 && <p className="mt-2 px-1 text-sm text-dim">Out of bounds: {r.eliminated.join(', ')}</p>}
      </Section>

      <div className="safe-bottom fixed inset-x-0 bottom-0 z-10 bg-gradient-to-t from-night via-night to-transparent px-4 pt-8">
        <div className="mx-auto flex max-w-xl gap-2">
          <Link to="/" className="contents">
            <Button variant="secondary" icon={<Home className="size-5" />}>
              Home
            </Button>
          </Link>
          {me.isHost ? (
            <Button block icon={<RotateCcw className="size-5" />} onClick={() => send({ t: 'host', cmd: 'rematch' })}>
              {watching ? 'Run it again' : 'Play again'}
            </Button>
          ) : (
            <div className="flex-1 rounded-full bg-panel py-3 text-center text-sm font-bold ring-1 ring-line">Stay here for a rematch</div>
          )}
        </div>
      </div>
    </div>
  );
}
