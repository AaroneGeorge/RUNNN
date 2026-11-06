import type { Team } from '@runnn/shared';
import { Segmented } from '../components/ui.tsx';
import type { GameCtx } from './bits.tsx';
import { Live } from './Live.tsx';
import { Lobby } from './Lobby.tsx';
import { Results } from './Results.tsx';

const SPEEDS = [1, 2, 4, 8];

/**
 * Spectating a simulation. Looking through a bot uses the same per-player view the
 * server sends a phone, so this is exactly what a player would see.
 */
export function Watch(ctx: GameCtx) {
  const { view, send } = ctx;
  const sim = view.sim;
  const watching = sim?.watching ?? null;
  const inner = { ...ctx, watching: watching !== null };

  return (
    <div>
      <div className="fixed inset-x-0 bottom-24 z-30 mx-auto flex w-fit flex-col items-center gap-2 rounded-3xl bg-ink/90 p-2 text-night shadow-xl backdrop-blur">
        <Segmented<'all' | Team>
          value={watching ?? 'all'}
          onChange={(v) => send({ t: 'watch', team: v === 'all' ? null : v })}
          options={[
            { value: 'all', label: '🗺️ Map' },
            { value: 'hunter', label: '🎯 Hunter' },
            { value: 'runner', label: '🏃 Runner' },
          ]}
          className="bg-white/10"
        />
        <div className="flex gap-1">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => send({ t: 'host', cmd: 'speed', speed: s })}
              className={`h-8 rounded-full px-3 text-sm font-extrabold ${sim?.speed === s ? 'bg-accent text-accent-ink' : 'text-night/70'}`}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>
      {view.phase === 'lobby' || view.phase === 'countdown' ? (
        <Lobby {...inner} />
      ) : view.phase === 'ended' ? (
        <Results {...inner} />
      ) : (
        <Live {...inner} />
      )}
    </div>
  );
}
