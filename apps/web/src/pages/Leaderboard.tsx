import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { LeaderboardBoard, LeaderboardPeriod, LeaderboardRow } from '@runnn/shared';
import { TrophyScene } from '../components/Scenes.tsx';
import { Avatar, Card, Empty, ErrorBox, ListRow, Loading, Page, Segmented, cx } from '../components/ui.tsx';
import { useApi } from '../lib/api.ts';
import { ordinal, rankTitle } from '../lib/rank.ts';

const UNIT: Record<LeaderboardBoard, string> = { xp: 'XP', runner: 'pts', hunter: 'pts' };

export function Leaderboard() {
  const nav = useNavigate();
  const [board, setBoard] = useState<LeaderboardBoard>('xp');
  const [period, setPeriod] = useState<LeaderboardPeriod>('all');
  const { data, error, loading, reload } = useApi<{ rows: LeaderboardRow[] }>(`/leaderboard?board=${board}&period=${period}`);
  const rows = data?.rows ?? [];

  return (
    <Page title="Leaderboard">
      <Segmented
        value={board}
        onChange={setBoard}
        options={[
          { value: 'xp', label: '⭐ XP' },
          { value: 'runner', label: '🏃 Runner' },
          { value: 'hunter', label: '🎯 Hunter' },
        ]}
      />
      <Segmented
        className="mt-2"
        value={period}
        onChange={setPeriod}
        options={[
          { value: 'week', label: 'This week' },
          { value: 'month', label: 'Month' },
          { value: 'all', label: 'All time' },
        ]}
      />
      <p className="mt-2 px-1 text-xs text-dim">{board === 'xp' ? 'Total XP earned.' : `Best single-round ${board} score.`}</p>

      {loading && !data && <Loading />}
      {error && <ErrorBox onRetry={reload}>{error}</ErrorBox>}
      {data && rows.length === 0 && <Empty art={<TrophyScene />} title="Nobody here yet" body="Play a round and you could be first." />}

      {rows.length > 0 && (
        <Card className="mt-4 py-1">
          {rows.map((r) => (
            <ListRow
              key={r.id}
              onClick={() => nav(`/u/${r.id}`)}
              left={
                <span className={cx('w-10 text-center text-sm font-black tabular', r.rank <= 3 && 'text-lg')}>
                  {r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : ordinal(r.rank)}
                </span>
              }
              title={
                <span className="flex items-center gap-2">
                  <Avatar name={r.name} size={28} /> {r.name}
                </span>
              }
              sub={`Level ${r.level} · ${rankTitle(r.level)}`}
              right={
                <span className="text-lg font-black tabular">
                  {r.value} <span className="text-xs text-dim">{UNIT[board]}</span>
                </span>
              }
            />
          ))}
        </Card>
      )}
    </Page>
  );
}
