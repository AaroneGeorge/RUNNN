import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { normalizeConfig, type Boundary, type CreateRoomBody } from '@runnn/shared';
import { Button, Card, ConfigSlider, Page, Section, Segmented } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { setSession, useOrganiser } from '../lib/storage.ts';
import { toastError } from '../lib/toast.ts';
import { AreaEditor } from './Host.tsx';

/** A bots-only room you watch through a bot's eyes, at up to 8×. */
export function Sim() {
  const org = useOrganiser();
  const nav = useNavigate();
  const [boundary, setBoundary] = useState<Boundary | null>(null);
  const [bots, setBots] = useState(12);
  const [mins, setMins] = useState(600);
  const [speed, setSpeed] = useState('4');
  const [busy, setBusy] = useState(false);

  if (!org) return <Navigate to="/welcome" replace />;

  const go = async () => {
    if (!boundary) return;
    setBusy(true);
    try {
      const body: CreateRoomBody = {
        title: 'Simulation',
        game: 'chase',
        boundary,
        config: normalizeConfig('chase', { durationSecs: mins, releaseDelaySecs: 30, radarRange: 25 }),
        sim: true,
        bots,
        speed: Number(speed),
      };
      const r = await api<{ code: string; organiserKey: string }>('/rooms', { body });
      setSession(r.code, { organiserKey: r.organiserKey, name: org.username });
      nav(`/watch/${r.code}`, { replace: true });
    } catch (e) {
      toastError(e);
      setBusy(false);
    }
  };

  return (
    <Page title="Simulation" back="/">
      <p className="mb-4 text-dim">Bots walk, chase, flee and tag on the real rules. Watch the whole map, or look through a hunter or runner’s phone.</p>
      <AreaEditor value={boundary} onChange={setBoundary} />
      <Section title="Setup">
        <Card>
          <ConfigSlider field={{ key: 'bots', label: 'Bots', min: 3, max: 60, step: 1 }} value={bots} onChange={setBots} />
          <ConfigSlider field={{ key: 'm', label: 'Round length', unit: 'min', min: 300, max: 3600, step: 60, minutes: true }} value={mins} onChange={setMins} />
          <div className="mb-2 px-1 text-sm font-bold">Speed</div>
          <Segmented
            value={speed}
            onChange={setSpeed}
            options={['1', '2', '4', '8'].map((s) => ({ value: s, label: `${s}×` }))}
          />
        </Card>
      </Section>
      <div className="mt-6">
        <Button block size="lg" disabled={!boundary} loading={busy} onClick={go}>
          Start simulation
        </Button>
      </div>
    </Page>
  );
}
