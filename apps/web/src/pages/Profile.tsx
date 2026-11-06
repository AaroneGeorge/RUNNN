import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { BADGES, GAMES, POINTS, xpForLevel, type Board, type GameHistoryRow, type HighScoreRow, type LeaderRow, type Profile } from '@kalikkam/shared';
import { api, ensureProfile } from '../lib/api.ts';
import { getProfile, setProfile } from '../lib/storage.ts';
import { relTime } from '../lib/time.ts';
import { rankIn } from '../lib/rank.ts';
import { Avatar, Empty, ErrorBox, GameBadge, Segmented, Sheet, Spinner, TopBar } from '../components/ui.tsx';
import { Mascot } from '../components/Mascot.tsx';
import { ArrowRight, Check, ChevronRight, Lock, LogOut, Mail, Pencil, Trophy } from 'lucide-react';
import NumberFlow from '@number-flow/react';
import type { Badge } from '@kalikkam/shared';
import { WalletCard } from '../game/Entry.tsx';

function ProfileView({ profile, history, editable }: { profile: Profile; history: GameHistoryRow[]; editable?: boolean }) {
  const [name, setName] = useState(profile.name);
  const [editing, setEditing] = useState(false);
  const [shown, setShown] = useState(profile);
  const [badge, setBadge] = useState<Badge | null>(null);
  const lo = xpForLevel(shown.level);
  const hi = xpForLevel(shown.level + 1);
  const pct = Math.round(((shown.xp - lo) / (hi - lo)) * 100);
  const owned = new Set(shown.badges.map((b) => b.id));
  const save = async () => {
    await ensureProfile(name.trim()).catch(() => undefined);
    setShown({ ...shown, name: name.trim() });
    setEditing(false);
  };
  return (
    <>
      <div className="card relative mb-4 overflow-hidden p-6 text-center">
        <div className="relative mx-auto mb-3 w-fit rounded-full p-1" style={{ background: `conic-gradient(var(--color-brand) ${pct}%, var(--color-line) 0)` }}>
          <div className="rounded-full bg-panel p-1">
            <Avatar name={shown.name} size={76} />
          </div>
          <span className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border-2 border-panel bg-brand px-2 py-px font-mono text-xs font-bold text-brand-ink">
            Lv {shown.level}
          </span>
        </div>
        {editing ? (
          <div className="mx-auto flex max-w-xs gap-2">
            <input className="field py-2" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} autoFocus />
            <button className="btn-brand btn-sm" disabled={!name.trim()} onClick={save}>
              Save
            </button>
          </div>
        ) : (
          <h1 className="mt-4 flex items-center justify-center gap-2 text-2xl font-extrabold">
            {shown.name}
            {shown.verifiedHuman && (
              <span className="chip bg-sun py-0.5 text-[11px]" title="Verified with World ID: one profile per person">
                ✓ human
              </span>
            )}
            {editable && (
              <button className="press grid h-8 w-8 place-items-center rounded-full bg-raise text-dim" onClick={() => setEditing(true)} aria-label="Edit name">
                <Pencil size={14} />
              </button>
            )}
          </h1>
        )}
        <div className="mt-1 font-mono text-xs text-dim">
          {shown.xp} / {hi} XP · {hi - shown.xp} to level {shown.level + 1}
        </div>
        {/* The two high scores first: best single game on each board. */}
        <div className="mt-5 grid grid-cols-2 gap-2">
          {(
            [
              ['🧟 Best as zombie', shown.best.zombie],
              ['🏃 Best as survivor', shown.best.survivor],
              ['Games', shown.gamesPlayed],
              ['Wins', shown.wins],
            ] as [string, number | null][]
          ).map(([k, v]) => (
            <div key={k} className="rounded-2xl bg-deep p-3">
              <div className="font-mono text-xl font-bold">{v === null ? '–' : <NumberFlow value={v} />}</div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-dim">{k}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-baseline justify-between">
        <h2 className="label">Badges · {shown.badges.length}/{Object.keys(BADGES).length}</h2>
        {editable && (
          <Link to="/achievements" className="mb-2 text-sm font-bold">
            See all achievements →
          </Link>
        )}
      </div>
      <div className="mb-6 grid grid-cols-5 gap-2">
        {Object.values(BADGES).map((b) => (
          <button
            key={b.id}
            aria-label={b.name}
            onClick={() => setBadge(b)}
            className={`press flex aspect-square flex-col items-center justify-center rounded-2xl border text-center ${owned.has(b.id) ? 'border-brand/50 bg-brand/10' : 'border-line bg-panel'}`}
          >
            <div className={`text-2xl ${owned.has(b.id) ? '' : 'opacity-30 grayscale'}`}>{b.emoji}</div>
            <div className={`mt-0.5 px-1 text-[9px] font-bold leading-tight ${owned.has(b.id) ? '' : 'text-dim'}`}>{b.name}</div>
          </button>
        ))}
      </div>

      <Sheet open={!!badge} onClose={() => setBadge(null)}>
        {badge && (
          <div className="pb-2 text-center">
            <div className={`mb-3 text-6xl ${owned.has(badge.id) ? '' : 'opacity-40 grayscale'}`}>{badge.emoji}</div>
            <h2 className="text-2xl font-extrabold">{badge.name}</h2>
            <p className="mx-auto mt-1 max-w-xs text-dim">{badge.desc}</p>
            <div className={`chip mt-4 ${owned.has(badge.id) ? 'bg-brand/15 text-brand' : 'bg-raise text-dim'}`}>
              {owned.has(badge.id) ? (
                <>
                  <Check size={12} strokeWidth={3} /> Earned
                </>
              ) : (
                <>
                  <Lock size={12} /> Not yet
                </>
              )}
            </div>
          </div>
        )}
      </Sheet>

      <h2 className="label">Recent games</h2>
      {history.length === 0 ? (
        <Empty title="No games yet">
          Join or host one. Your XP and badges show up here.
        </Empty>
      ) : (
        <div className="card divide-y divide-line">
          {history.map((h, i) => (
            <div key={i} className="flex items-center gap-3 p-3.5">
              <GameBadge color={GAMES[h.game].color} emoji={GAMES[h.game].emoji} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{h.title}</div>
                <div className="text-xs text-dim">
                  {relTime(h.endedAt)}
                  {h.role ? ` · ${h.role}` : ''}
                  {h.points.survivor !== null && ` · 🏃 ${h.points.survivor} pts`}
                  {h.points.zombie !== null && ` · 🧟 ${h.points.zombie} pts`}
                </div>
              </div>
              <div className="text-right">
                <div className={`chip px-2 py-0.5 ${h.won ? 'bg-brand/15 text-brand' : 'bg-raise text-dim'}`}>{h.won ? 'Win' : 'Played'}</div>
                <div className="font-mono text-xs text-dim">+{h.xp} XP</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function ProfilePage() {
  const [data, setData] = useState<{ profile: Profile; history: GameHistoryRow[]; email: string | null } | null>(null);
  const [err, setErr] = useState('');
  const [hasProfile, setHasProfile] = useState(!!getProfile());

  useEffect(() => {
    if (!hasProfile) return;
    api<{ profile: Profile; history: GameHistoryRow[]; email: string | null }>('/api/me')
      .then(setData)
      .catch((e) => setErr(e.message));
  }, [hasProfile]);

  if (!hasProfile) {
    return (
      <div className="page">
        <TopBar title="Your profile" back={false} />
        <div className="relative mt-14">
          <Mascot team="survivor" mood="idle" size={110} className="pointer-events-none absolute -top-[88px] right-5" />
          <div className="card p-5">
            <h2 className="font-display text-[26px]">No profile yet</h2>
            <p className="mb-4 mt-1 text-sm font-semibold text-dim">Play as a guest, or sign in with email to keep your XP and badges on any phone.</p>
            <Link to="/welcome?step=signin" className="btn-brand w-full justify-between px-6 text-lg">
              Sign in <ArrowRight size={20} strokeWidth={2.6} />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const signOut = () => {
    setProfile(null);
    setHasProfile(false);
    setData(null);
  };

  return (
    <div className="page">
      <TopBar
        title="You"
        back={false}
        right={
          <Link to="/leaderboard" className="btn-ghost btn-sm">
            <Trophy size={16} className="text-gold" /> Ranks
          </Link>
        }
      />
      {err && <ErrorBox>{err}</ErrorBox>}
      {!data && !err && <Spinner />}
      {data && <ProfileView profile={data.profile} history={data.history} editable />}
      {data && <WalletCard />}
      {data && (
        <div className="card mt-4 p-4">
          {data.email ? (
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-ink bg-sun">
                <Mail size={18} strokeWidth={2.4} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-bold">Signed in with email</div>
                <div className="truncate text-sm text-dim">{data.email}</div>
              </div>
              <button className="btn-ghost btn-sm" onClick={signOut}>
                <LogOut size={16} /> Sign out
              </button>
            </div>
          ) : (
            <Link to="/welcome?step=email" className="flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-ink bg-sun">
                <Mail size={18} strokeWidth={2.4} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-bold">Keep your XP on any phone</div>
                <div className="text-sm text-dim">Add your email. You’re playing as a guest on this phone.</div>
              </div>
              <ChevronRight size={20} />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

export function PublicProfilePage() {
  const id = useParams().id!;
  const [data, setData] = useState<{ profile: Profile; history: GameHistoryRow[] } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api<{ profile: Profile; history: GameHistoryRow[] }>(`/api/profiles/${id}`)
      .then(setData)
      .catch((e) => setErr(e.message));
  }, [id]);
  return (
    <div className="page">
      <TopBar title="Player" />
      {err && <ErrorBox>{err}</ErrorBox>}
      {!data && !err && <Spinner />}
      {data && <ProfileView profile={data.profile} history={data.history} />}
    </div>
  );
}

/** One row on any board: the two high-score boards (best single game) or total XP. */
interface BoardRow {
  id: string;
  name: string;
  value: number;
  unit: string;
  sub: string;
}

const BOARD_NOTE: Record<Board, string> = {
  zombie: `Best single game as a zombie: ${POINTS.perInfection} points per infection.`,
  survivor: `Best single game as a survivor: ${POINTS.survivorPerMinute} points a minute alive.`,
  xp: 'Total XP from every game you played.',
};

export function LeaderboardPage() {
  const [board, setBoard] = useState<Board>('zombie');
  const [period, setPeriod] = useState<'week' | 'month' | 'all'>('week');
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const me = getProfile();
  useEffect(() => {
    let live = true;
    setRows(null);
    const q = `/api/leaderboard?period=${period}&board=${board}`;
    const load: Promise<BoardRow[]> =
      board === 'xp'
        ? api<LeaderRow[]>(q).then((rs) => rs.map((r) => ({ id: r.id, name: r.name, value: r.xp, unit: 'XP', sub: `Lv ${r.level} · ${r.wins} wins · ${r.gamesPlayed} games` })))
        : api<HighScoreRow[]>(q).then((rs) =>
            rs.map((r) => ({ id: r.id, name: r.name, value: r.best, unit: 'pts', sub: `Lv ${r.level} · best of ${r.games} game${r.games === 1 ? '' : 's'}` })),
          );
    load.then((r) => live && setRows(r)).catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [board, period]);
  return (
    <div className="page">
      <TopBar title="Leaderboard" />
      <div className="mb-2">
        <Segmented
          label="Board"
          value={board}
          onChange={setBoard}
          options={[
            { value: 'zombie', label: '🧟 Zombies' },
            { value: 'survivor', label: '🏃 Survivors' },
            { value: 'xp', label: 'XP' },
          ]}
        />
      </div>
      <div className="mb-2">
        <Segmented
          label="Period"
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'week', label: 'This week' },
            { value: 'month', label: 'This month' },
            { value: 'all', label: 'All time' },
          ]}
        />
      </div>
      <p className="mb-5 px-1 text-sm text-dim">{BOARD_NOTE[board]}</p>
      {!rows && <Spinner />}
      {rows && rows.length === 0 && (
        <Empty title="No scores yet">
          Play a game to get on the board.
        </Empty>
      )}
      {rows && rows.length > 0 && (
        <>
          <Podium rows={rows.slice(0, 3)} me={me?.id} />
          {rows.length > 3 && (
            <div className="card divide-y divide-line">
              {rows.slice(3).map((r) => (
                <Link key={r.id} to={`/u/${r.id}`} className={`flex items-center gap-3 px-4 py-3 active:bg-raise ${r.id === me?.id ? 'bg-brand/5' : ''}`}>
                  <div className="w-6 text-center font-mono text-sm font-bold text-dim">{rankIn(rows.map((x) => x.value), r.value)}</div>
                  <Avatar name={r.name} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">
                      {r.name}
                      {r.id === me?.id && <span className="ml-1.5 text-xs text-brand">you</span>}
                    </div>
                    <div className="text-xs text-dim">{r.sub}</div>
                  </div>
                  <div className="font-mono text-sm font-bold text-brand">
                    {r.value} <span className="text-xs text-dim">{r.unit}</span>
                  </div>
                  <ChevronRight size={16} className="text-dim" />
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Top three on steps: 2nd, 1st, 3rd. */
function Podium({ rows, me }: { rows: BoardRow[]; me?: string }) {
  const order = [rows[1], rows[0], rows[2]];
  const steps = ['h-16', 'h-24', 'h-12'];
  // Medals follow the place, so a tie shares a medal.
  const MEDALS = ['🥇', '🥈', '🥉'];
  const medal = order.map((r) => (r ? MEDALS[rankIn(rows.map((x) => x.value), r.value) - 1] : ''));
  return (
    <div className="mb-5 grid grid-cols-3 items-end gap-2">
      {order.map((r, i) =>
        r ? (
          <Link key={r.id} to={`/u/${r.id}`} className="press flex flex-col items-center">
            <div className="relative mb-2">
              <Avatar name={r.name} size={i === 1 ? 64 : 52} />
              <span className="absolute -bottom-1 -right-1 text-xl">{medal[i]}</span>
            </div>
            <div className={`max-w-full truncate px-1 text-sm font-bold ${r.id === me ? 'text-brand' : ''}`}>{r.name}</div>
            <div className="mb-2 font-mono text-xs text-dim">
              {r.value} {r.unit}
            </div>
            <div className={`w-full rounded-t-2xl border border-b-0 border-line ${steps[i]} ${i === 1 ? 'bg-brand/15' : 'bg-panel'}`} />
          </Link>
        ) : (
          <div key={i} />
        ),
      )}
    </div>
  );
}
