import { Navigate, useParams } from 'react-router';
import { GAMES, POINTS, isGameId } from '@runnn/shared';
import { Card, Page, Pill, Section } from '../components/ui.tsx';
import { useOrganiser } from '../lib/storage.ts';

export function GameRules() {
  const { id } = useParams();
  const org = useOrganiser();
  if (!isGameId(id)) return <Navigate to="/" replace />;
  const g = GAMES[id];

  return (
    <Page title={`${g.emoji} ${g.name}`} back>
      <p className="text-lg font-semibold">{g.tagline}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Pill>{g.minPlayers}+ players</Pill>
        {g.needsBibs && <Pill>Printed bibs</Pill>}
        <Pill tone="accent">+{POINTS.perConversion} per catch</Pill>
        <Pill tone="accent">+{POINTS.runnerPerMinute}/min alive</Pill>
      </div>

      <Section title="Rules">
        <Card>
          <ol className="list-decimal space-y-2.5 pl-5">
            {g.rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ol>
        </Card>
      </Section>

      <Section title="Why GPS doesn’t decide tags">
        <Card className="text-sm">
          Phone GPS is off by 5–20 m in a city, worse under trees. So the map only keeps you inside the area and drives the radar. Every catch needs a human: a
          camera on a real bib, or a claim code both players agree on. GPS can only reject a tag that is physically impossible.
        </Card>
      </Section>

      {org && (
        <Section title="Organiser tips">
          <Card>
            <ul className="list-disc space-y-2 pl-5 text-sm">
              {g.hostTips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </Card>
        </Section>
      )}
    </Page>
  );
}
