import { useMemo } from 'react';
import { Link } from 'react-router';
import { GAMES, type ResultRow, type Team } from '@kalikkam/shared';
import type { PlayCtx } from '../pages/Play.tsx';
import { shareText } from '../components/ui.tsx';
import { Mascot, Sparkle } from '../components/Mascot.tsx';
import { ROLE_INFO } from './bits.tsx';
import { rankIn } from '../lib/rank.ts';
import { getHost, getProfile } from '../lib/storage.ts';
import { getRun, runSegments, runStats, type Run } from '../lib/run.ts';
import { GameMap } from '../components/GameMap.tsx';
import { PayoutCard } from './Entry.tsx';
import { ChevronRight, Crown, Mail, RotateCcw, Share2, UserRound } from 'lucide-react';
import { WatchBar } from './Watch.tsx';

// `role` is the team they were dealt; a survivor who got infected still shows as a survivor.
const teamOf = (r: ResultRow): Team => (r.role === 'zombie' ? 'zombie' : 'survivor');
const clock = (secs: number) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
const SIDES: Team[] = ['survivor', 'zombie'];

/** Everyone on one side's board, best first. Survivors: dealt survivor. Zombies: a zombie by the end. */
function board(rows: ResultRow[], side: Team) {
  return rows.filter((r) => r.points[side] !== null).sort((a, b) => b.points[side]! - a.points[side]! || a.name.localeCompare(b.name));
}

function detail(r: ResultRow, side: Team) {
  const secs = r.stats.survivedSecs ?? 0;
  if (side === 'survivor') return r.status === 'infected' ? `infected after ${clock(secs)}` : `made it · ${clock(secs)}`;
  const n = r.stats.infections ?? 0;
  const infections = `${n} infection${n === 1 ? '' : 's'}`;
  return r.role === 'survivor' ? `${infections} · turned at ${clock(secs)}` : infections;
}

/** My run (beta): the route you ran this game, from this phone's own GPS. */
function RunCard({ ctx }: { ctx: PlayCtx }) {
  const { view } = ctx;
  const run: Run | null = useMemo(() => getRun(view.code, view.startedAt), [view.code, view.startedAt]);
  const path = useMemo(() => (run ? runSegments(run) : []), [run]);
  if (!run) return null;
  const { metres, secs } = runStats(run);
  const infected = run.points.some((p) => p.z) && run.points[0].z === 0;
  return (
    <section className="mb-6">
      <h2 className="label">
        Your run <span className="chip ml-1 bg-raise py-0 align-middle text-[10px] normal-case tracking-normal">beta</span>
      </h2>
      <div className="card overflow-hidden">
        <GameMap className="h-64 border-b-2 border-ink" boundary={view.boundary} fitKey={`run:${view.code}:${view.startedAt}`} path={path} showLabels={false} />
        <div className="flex items-center justify-around px-4 py-3 text-center">
          <div>
            <div className="font-display text-2xl leading-none">{metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${Math.round(metres)} m`}</div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-dim">distance</div>
          </div>
          <div>
            <div className="font-display text-2xl leading-none">{clock(secs)}</div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-dim">on the move</div>
          </div>
        </div>
        <p className="border-t border-line px-4 py-2 text-xs text-dim">
          {infected ? 'White as a survivor, yellow once you were infected. ' : ''}From this phone's GPS, kept on this phone only.
        </p>
      </div>
    </section>
  );
}

export function Results({ ctx }: { ctx: PlayCtx }) {
  const { view, host } = ctx;
  const meta = GAMES[view.game];
  const res = view.result;
  const me = view.me;
  if (!res) return null;
  const mine = res.rows.find((r) => r.id === me.id);
  const winners: Team = res.rows.some((r) => r.won && r.role === 'survivor') ? 'survivor' : 'zombie';
  const won = !!mine?.won;
  const boards = Object.fromEntries(SIDES.map((s) => [s, board(res.rows, s)])) as Record<Team, ResultRow[]>;
  const rank = (s: Team, r: ResultRow) => rankIn(boards[s].map((x) => x.points[s]!), r.points[s]!);
  const myScores = mine ? SIDES.filter((s) => mine.points[s] !== null) : [];
  // Guests: right after a game is when keeping the XP matters, so offer email here.
  const profile = getProfile();
  const offerEmail = !!mine && !!profile && !profile.email && !getHost();
  // Yellow terrain and stars for the winning team; a plain grey card otherwise; white for the referee.
  const tone = !mine ? 'bg-panel' : won ? 'bg-sun bg-[length:420px] bg-topo' : 'bg-raise';
  return (
    <div className="page">
      {view.sim && (
        <div className="mb-4">
          <WatchBar ctx={ctx} />
        </div>
      )}
      <div className={`relative mb-6 overflow-hidden rounded-[32px] px-6 pb-6 pt-7 text-center ${tone}`}>
        {(won || !mine) && (
          <>
            <Sparkle size={26} fill="#fff" className="absolute left-7 top-8" />
            <Sparkle size={15} fill="#fff" className="absolute right-10 top-6" />
            <Sparkle size={12} fill="var(--color-sun)" className="absolute right-16 top-28" />
            <Sparkle size={17} fill="#fff" className="absolute left-12 top-32" />
          </>
        )}
        <div className="flex items-end justify-center">
          {mine ? (
            <Mascot team={teamOf(mine)} mood={won ? 'happy' : 'sad'} size={128} live={won} className={won ? 'mascot-hop' : ''} />
          ) : (
            <>
              <Mascot team={winners} mood="happy" size={128} live className="mascot-hop" />
              <Mascot team={winners === 'zombie' ? 'survivor' : 'zombie'} mood="sad" size={90} className="-ml-3" />
            </>
          )}
        </div>

        {/* Points first: your score on each board you played, and where it ranks. */}
        {mine ? (
          <div className={`mt-4 grid gap-2 ${myScores.length > 1 ? 'grid-cols-2' : ''}`}>
            {myScores.map((s) => {
              return (
                <div key={s} className={myScores.length > 1 ? 'rounded-[22px] border-2 border-ink bg-panel px-2 py-3' : ''}>
                  <div className={`font-display leading-none ${myScores.length > 1 ? 'text-[40px]' : 'text-[64px]'}`}>{mine.points[s]}</div>
                  <div className="mt-1 text-sm font-bold">{ROLE_INFO[s].name} points</div>
                  <div className="text-xs font-semibold text-ink/65">
                    #{rank(s, mine)} of {boards[s].length}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <h1 className="font-display mt-4 text-[40px]">{res.headline.split('!')[0] + '!'}</h1>
        )}
        <p className="mt-3 text-base font-bold leading-snug text-ink/80">{mine ? res.headline : res.headline.split('!').slice(1).join('!').trim()}</p>
        {res.lines.length > 0 && (
          <div className="mt-2 space-y-1 text-sm font-semibold text-ink/65">
            {res.lines.map((l) => (
              <p key={l}>{l}</p>
            ))}
          </div>
        )}
      </div>

      {SIDES.map((s) =>
        boards[s].length ? (
          <section key={s} className="mb-6">
            <h2 className="label">
              {ROLE_INFO[s].emoji} {ROLE_INFO[s].name} board
            </h2>
            <div className="card divide-y divide-line">
              {boards[s].map((r) => {
                // Everyone tied for first holds the high score and gets the crown.
                const place = rank(s, r);
                return (
                  <div key={r.id} className={`flex items-center gap-3 px-4 py-2.5 ${r.id === me.id ? 'bg-sun-soft/60' : ''}`}>
                    <div className="w-5 text-center font-mono text-sm font-bold text-dim">{place === 1 ? <Crown size={16} className="mx-auto text-ink" aria-label="High score" /> : place}</div>
                    <Mascot team={s} mood={place === 1 ? 'happy' : r.status === 'infected' && s === 'survivor' ? 'sad' : 'idle'} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-bold">
                        {r.name}
                        {r.id === me.id && <span className="font-semibold text-dim"> (you)</span>}
                      </div>
                      <div className="truncate text-xs text-dim">{detail(r, s)}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-display text-xl leading-none">{r.points[s]}</div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-dim">pts</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null,
      )}

      {ctx.settings.runMap && mine && <RunCard ctx={ctx} />}

      {res.payout && <PayoutCard payout={res.payout} me={me.id} />}

      {offerEmail && (
        <Link to="/welcome?step=email" className="card press mb-4 flex items-center gap-3 p-4 active:bg-raise">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-ink bg-sun">
            <Mail size={18} strokeWidth={2.4} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-bold">Save your XP</div>
            <div className="text-sm text-dim">Add your email to keep your points and XP on any phone.</div>
          </div>
          <ChevronRight size={20} />
        </Link>
      )}

      <div className="flex flex-col gap-2">
        {me.isHost && (
          <button className="btn-brand text-lg" onClick={() => host({ cmd: 'rematch' })}>
            <RotateCcw size={20} /> Rematch with the same players
          </button>
        )}
        <button
          className="btn-ghost"
          onClick={() =>
            shareText(
              `${meta.emoji} ${view.title}: ${res.headline}${mine ? ` I scored ${myScores.map((s) => `${mine.points[s]} as a ${ROLE_INFO[s].name.toLowerCase()}`).join(' and ')}.` : ''}`,
              `${location.origin}/games/${view.game}`,
            )
          }
        >
          <Share2 size={18} /> Share result
        </button>
        {me.isHost && (
          <Link to={view.sim ? `/sim?game=${view.game}` : `/host?game=${view.game}`} className="btn-ghost">
            {view.sim ? '🎬 New simulation' : 'New game'}
          </Link>
        )}
        <Link to="/me" className="btn-ghost">
          <UserRound size={18} /> My profile &amp; high scores
        </Link>
        <Link to="/" className="py-3 text-center text-sm text-dim">
          Home
        </Link>
      </div>
    </div>
  );
}
