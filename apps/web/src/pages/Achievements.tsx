import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { BADGES, xpForLevel, type GameHistoryRow, type Profile } from '@kalikkam/shared';
import { api } from '../lib/api.ts';
import { getProfile } from '../lib/storage.ts';
import { ErrorBox, Spinner, TopBar } from '../components/ui.tsx';
import { Mascot } from '../components/Mascot.tsx';
import { ArrowRight, Check, Lock, Trophy } from 'lucide-react';
import NumberFlow from '@number-flow/react';

/** Badges with a game count behind them can show how close you are. */
const COUNTED: Record<string, number> = { regular: 10, legend: 50 };

/** Players' trophy room: rank, XP to the next level and every badge (earned or not). Hosts get the Kit tab instead. */
export function AchievementsPage() {
  const [hasProfile] = useState(!!getProfile());
  const [profile, setProfile] = useState<Profile | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!hasProfile) return;
    api<{ profile: Profile; history: GameHistoryRow[] }>('/api/me')
      .then((d) => setProfile(d.profile))
      .catch((e) => setErr(e.message));
  }, [hasProfile]);

  const ranks = (
    <Link to="/leaderboard" className="btn-ghost btn-sm">
      <Trophy size={16} className="text-gold" /> Ranks
    </Link>
  );

  if (!hasProfile) {
    return (
      <div className="page">
        {/* No Ranks button here: the mascot peeks over the top bar, like the empty profile. */}
        <TopBar title="Achievements" back={false} />
        <div className="relative mt-14">
          <Mascot team="zombie" mood="happy" size={110} className="pointer-events-none absolute -top-[88px] right-5" />
          <div className="card p-5">
            <h2 className="font-display text-[26px]">Play a game to start earning badges</h2>
            <p className="mb-4 mt-1 text-sm font-semibold text-dim">
              Every game you finish earns XP. Win, infect, survive the timer: there are {Object.keys(BADGES).length} badges to collect.
            </p>
            <Link to="/join" className="btn-brand w-full justify-between px-6 text-lg">
              Join a game <ArrowRight size={20} strokeWidth={2.6} />
            </Link>
          </div>
        </div>
        <BadgeGrid profile={null} />
      </div>
    );
  }

  return (
    <div className="page">
      <TopBar title="Achievements" back={false} right={ranks} />
      {err && <ErrorBox>{err}</ErrorBox>}
      {!profile && !err && <Spinner />}
      {profile && (
        <>
          <RankCard profile={profile} />
          <BadgeGrid profile={profile} />
        </>
      )}
    </div>
  );
}

function RankCard({ profile }: { profile: Profile }) {
  const lo = xpForLevel(profile.level);
  const hi = xpForLevel(profile.level + 1);
  const pct = Math.max(0, Math.min(100, Math.round(((profile.xp - lo) / (hi - lo)) * 100)));
  const stats: [string, number | null][] = [
    ['Games', profile.gamesPlayed],
    ['Wins', profile.wins],
    ['🧟 Best as zombie', profile.best.zombie],
    ['🏃 Best as survivor', profile.best.survivor],
  ];
  return (
    <div className="card mb-6 p-5">
      <div className="flex items-center gap-4">
        <div className="grid h-16 w-16 shrink-0 place-items-center rounded-[22px] border-2 border-ink bg-sun text-ink">
          <div className="text-center leading-none">
            <div className="text-[10px] font-bold uppercase tracking-wider">Lv</div>
            <div className="font-mono text-2xl font-bold">{profile.level}</div>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-extrabold">{profile.name}</div>
          <div className="font-mono text-xs text-dim">
            <NumberFlow value={profile.xp} /> XP · {hi - profile.xp} to level {profile.level + 1}
          </div>
          <div
            className="mt-2 h-3 overflow-hidden rounded-full border-2 border-ink bg-deep"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full rounded-full bg-sun transition-[width] duration-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2">
        {stats.map(([k, v]) => (
          <div key={k} className="rounded-2xl bg-deep p-3">
            <div className="font-mono text-xl font-bold">{v === null ? '–' : <NumberFlow value={v} />}</div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-dim">{k}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BadgeGrid({ profile }: { profile: Profile | null }) {
  const owned = new Set(profile?.badges.map((b) => b.id) ?? []);
  const all = Object.values(BADGES);
  return (
    <>
      <h2 className="label mt-6">
        Badges · {owned.size}/{all.length}
      </h2>
      <div className="grid grid-cols-2 gap-3">
        {all.map((b) => {
          const got = owned.has(b.id);
          const goal = COUNTED[b.id];
          const games = profile?.gamesPlayed ?? 0;
          return (
            <div
              key={b.id}
              className={`card flex flex-col items-center p-4 text-center ${got ? 'border-2 border-ink bg-sun-soft' : 'border-2 border-dashed border-line'}`}
            >
              <div className={`text-4xl ${got ? '' : 'opacity-35 grayscale'}`} aria-hidden>
                {b.emoji}
              </div>
              <div className={`mt-2 font-extrabold leading-tight ${got ? '' : 'text-dim'}`}>{b.name}</div>
              <p className="mt-1 text-xs text-dim">{b.desc}</p>
              {!got && goal && profile && (
                <div className="mt-2 w-full">
                  <div className="h-1.5 overflow-hidden rounded-full bg-raise">
                    <div className="h-full rounded-full bg-ink/40" style={{ width: `${Math.min(100, (games / goal) * 100)}%` }} />
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-dim">
                    {games}/{goal} games
                  </div>
                </div>
              )}
              <div className="min-h-3 flex-1" />
              <div className={`chip ${got ? 'bg-ink text-night' : 'bg-raise text-dim'}`}>
                {got ? (
                  <>
                    <Check size={12} strokeWidth={3} /> Earned
                  </>
                ) : (
                  <>
                    <Lock size={12} /> Locked
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
