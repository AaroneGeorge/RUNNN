import { BADGES, type MeResponse } from '@runnn/shared';
import { Card, Loading, Page, cx } from '../components/ui.tsx';
import { useApi } from '../lib/api.ts';
import { useProfileToken } from '../lib/storage.ts';

export function Achievements() {
  const token = useProfileToken();
  const me = useApi<MeResponse>(token ? '/me' : null, [token]);
  const earned = new Map(me.data?.profile.badges.map((b) => [b.id, b.earnedAt]) ?? []);
  if (token && !me.data && !me.error) return <Loading />;

  return (
    <Page title="Badges" back="/me">
      <p className="mb-4 text-dim">
        {earned.size} of {Object.keys(BADGES).length} earned.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {Object.values(BADGES).map((b) => {
          const at = earned.get(b.id);
          return (
            <Card key={b.id} className={cx('text-center', !at && 'opacity-45 grayscale')}>
              <div className="text-4xl">{b.emoji}</div>
              <div className="mt-2 font-extrabold">{b.name}</div>
              <div className="text-sm text-dim">{b.desc}</div>
              {at && <div className="mt-1 text-xs font-bold text-dim">{new Date(at).toLocaleDateString()}</div>}
            </Card>
          );
        })}
      </div>
    </Page>
  );
}
