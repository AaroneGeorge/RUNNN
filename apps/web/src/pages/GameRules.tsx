import { Link, useParams } from 'react-router';
import { GAMES, isGameId } from '@kalikkam/shared';
import { ActionBar, TopBar } from '../components/ui.tsx';
import { Mascot, Sparkle } from '../components/Mascot.tsx';
import { Wordmark } from '../components/Brand.tsx';
import { ArrowRight, CalendarPlus, Lightbulb, Shirt, Timer, Users } from 'lucide-react';

export function GameRulesPage() {
  const id = useParams().id;
  if (!isGameId(id)) {
    return (
      <div className="page">
        <TopBar title="Unknown game" />
      </div>
    );
  }
  const g = GAMES[id];
  const mins = Math.round((g.defaults.durationSecs ?? g.defaults.seekSecs ?? 1200) / 60);
  return (
    <div className="page">
      <TopBar title="" />
      <div className="relative mb-6 overflow-hidden rounded-[32px] bg-sun bg-[length:420px] bg-topo p-6">
        <Sparkle size={20} fill="#fff" className="absolute right-8 top-6" />
        <div className="mb-3 flex items-end">
          <Mascot team="zombie" mood="idle" size={104} />
          <Mascot team="survivor" mood="scared" size={78} className="-ml-2" />
        </div>
        <Wordmark className="text-[46px]" />
        <p className="mt-3 text-lg font-bold leading-snug text-ink/80">{g.tagline}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="chip bg-panel">
            <Users size={13} /> {g.minPlayers}+ players
          </span>
          <span className="chip bg-panel">
            <Timer size={13} /> {mins} min rounds
          </span>
          {g.needsVests && (
            <span className="chip bg-panel">
              <Shirt size={13} /> numbered vests
            </span>
          )}
        </div>
      </div>

      <h2 className="label">How it works</h2>
      <ol className="mb-6 space-y-2">
        {g.rules.map((r, i) => (
          <li key={r} className="card flex gap-3 p-4 text-[15px] leading-snug">
            <span className="font-mono grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-ink bg-sun text-sm font-extrabold">
              {i + 1}
            </span>
            <span className="pt-0.5">{r}</span>
          </li>
        ))}
      </ol>

      <h2 className="label">Hosting tips</h2>
      <ul className="card mb-6 divide-y divide-line">
        {g.hostTips.map((r) => (
          <li key={r} className="flex gap-3 p-4 text-sm leading-snug text-dim">
            <Lightbulb size={18} className="mt-px shrink-0 text-gold" />
            {r}
          </li>
        ))}
      </ul>

      <ActionBar>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Link to={`/host?game=${g.id}`} className="btn-brand text-lg">
            Host {g.name} <ArrowRight size={20} strokeWidth={2.6} />
          </Link>
          <Link to={`/events/new?game=${g.id}`} aria-label={`Plan a ${g.name} event`} className="btn-ghost px-4">
            <CalendarPlus size={20} />
          </Link>
        </div>
      </ActionBar>
    </div>
  );
}
