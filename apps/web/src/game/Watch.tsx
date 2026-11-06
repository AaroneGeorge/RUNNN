import { Link } from 'react-router';
import type { Hud, Team } from '@kalikkam/shared';
import type { PlayCtx } from '../pages/Play.tsx';

type ZHud = Extract<Hud, { kind: 'zombies' }>;

/**
 * Simulation host only: switch between the referee map and a bot's own phone screen. Tapping the team
 * you're already watching jumps to another bot of that team.
 */
export function WatchBar({ ctx }: { ctx: PlayCtx }) {
  const { view, watchTeam, watch } = ctx;
  if (!view.sim || !(view.me.isHost || view.watching)) return null;
  const w = view.watching;
  const btn = (on: boolean) => `btn-sm press rounded-full border-2 border-ink px-3 text-xs font-bold ${on ? 'bg-ink text-night' : 'bg-panel'}`;
  const teamBtn = (t: Team, emoji: string, label: string) => (
    <button className={btn(watchTeam === t)} onClick={() => watch(t)}>
      {emoji} {watchTeam === t && w ? `Another ${label.toLowerCase()}` : label}
    </button>
  );
  return (
    <div className="pointer-events-auto flex flex-col items-center gap-1.5">
      <div className="flex flex-wrap justify-center gap-1.5">
        <button className={btn(!watchTeam)} onClick={() => watch(null)}>
          🗺 Referee
        </button>
        {teamBtn('zombie', '🧟', 'Zombie')}
        {teamBtn('survivor', '🏃', 'Survivor')}
        <Link to={`/watch/${view.code}`} className={`${btn(false)} hidden md:inline-flex`}>
          ⧉ Both
        </Link>
      </div>
      {watchTeam && (
        <div className="chip bg-sun-soft text-xs">
          {w ? (
            <>
              👁 Watching <b className="mx-1">{w.name}</b> {view.me.role === 'zombie' ? '🧟 zombie' : '🏃 survivor'}
              {watchTeam !== view.me.role && ' (infected)'}
            </>
          ) : (
            `👁 You'll see a ${watchTeam}'s screen once teams are dealt…`
          )}
        </div>
      )}
    </div>
  );
}

/** A watched bot zombie has no camera: show its scan filling up instead. */
export function WatchScan({ ctx }: { ctx: PlayCtx }) {
  const { view } = ctx;
  const hud = view.hud.kind === 'zombies' ? (view.hud as ZHud) : null;
  const scan = hud?.scanning;
  if (!view.watching || view.me.role !== 'zombie' || !scan) return null;
  const now = ctx.serverNow();
  const p = Math.min(1, Math.max(0, 1 - (scan.endsAt - now) / scan.totalMs));
  return (
    <div role="status" className="pointer-events-none fixed inset-x-0 top-1/3 z-40 px-6">
      <div className="mx-auto max-w-sm rounded-[22px] border-2 border-ink bg-sun p-4 text-center text-ink">
        <div className="font-display text-[22px]">🧟 Infecting {scan.name}…</div>
        <div className="text-sm font-bold">Camera held on their back QR</div>
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-ink/20">
          <div className="h-full rounded-full bg-ink" style={{ width: `${p * 100}%`, transition: 'width 100ms linear' }} />
        </div>
      </div>
    </div>
  );
}
