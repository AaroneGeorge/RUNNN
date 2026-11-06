import { Crosshair, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import {
  GAMES,
  boundaryArea,
  isValidBoundary,
  normalizeConfig,
  type Boundary,
  type CreateRoomBody,
  type GameId,
  type LatLng,
} from '@runnn/shared';
import { GameMap } from '../components/GameMap.tsx';
import { Button, Card, ConfigSlider, Field, Input, Page, Section, Segmented, Toggle } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { setSession, useOrganiser } from '../lib/storage.ts';
import { toastError } from '../lib/toast.ts';

/** Find the organiser once, so the map opens where they are standing. */
export function useHere(): { here: LatLng | null; locate: () => void } {
  const [here, setHere] = useState<LatLng | null>(null);
  const locate = () =>
    navigator.geolocation?.getCurrentPosition(
      (p) => setHere({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  useEffect(locate, []);
  return { here, locate };
}

/** Tap corners to draw a polygon, or drop a circle and size it. */
export function AreaEditor({ value, onChange }: { value: Boundary | null; onChange: (b: Boundary | null) => void }) {
  const [mode, setMode] = useState<'polygon' | 'circle'>('circle');
  const [points, setPoints] = useState<LatLng[]>([]);
  const [radius, setRadius] = useState(120);
  const { here, locate } = useHere();

  useEffect(() => {
    if (mode === 'polygon') onChange(points.length >= 3 ? { type: 'polygon', points } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, mode]);

  useEffect(() => {
    if (mode === 'circle' && value?.type === 'circle') onChange({ ...value, radius });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radius]);

  // Default circle at the organiser's location.
  useEffect(() => {
    if (here && !value && mode === 'circle') onChange({ type: 'circle', center: here, radius });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here]);

  const tap = (p: LatLng) => {
    if (mode === 'polygon') setPoints((xs) => (xs.length >= 64 ? xs : [...xs, p]));
    else onChange({ type: 'circle', center: p, radius });
  };

  const area = value && isValidBoundary(value) ? Math.round(boundaryArea(value)) : null;

  return (
    <div>
      <Segmented
        value={mode}
        onChange={(m) => {
          setMode(m);
          setPoints([]);
          onChange(m === 'circle' && here ? { type: 'circle', center: here, radius } : null);
        }}
        options={[
          { value: 'circle', label: '◯ Circle' },
          { value: 'polygon', label: '⬠ Draw corners' },
        ]}
      />
      <div className="relative mt-3 h-[44dvh] overflow-hidden rounded-3xl ring-1 ring-line">
        <GameMap boundary={value} draft={mode === 'polygon' && points.length < 3 ? points : []} center={here} onTap={tap} />
        <div className="absolute right-3 bottom-3 flex flex-col gap-2">
          {mode === 'polygon' && points.length > 0 && (
            <button onClick={() => setPoints((xs) => xs.slice(0, -1))} className="grid size-11 place-items-center rounded-full bg-panel shadow ring-1 ring-line" aria-label="Undo corner">
              <Undo2 className="size-5" />
            </button>
          )}
          <button onClick={locate} className="grid size-11 place-items-center rounded-full bg-panel shadow ring-1 ring-line" aria-label="My location">
            <Crosshair className="size-5" />
          </button>
        </div>
      </div>
      <p className="mt-2 px-1 text-sm text-dim">
        {mode === 'polygon'
          ? points.length < 3
            ? `Tap the map to place corners (${points.length}/3 minimum). Follow paths, fences and walls.`
            : `${points.length} corners · ${area?.toLocaleString() ?? '?'} m²`
          : value
            ? `Tap to move the centre · ${area?.toLocaleString() ?? '?'} m²`
            : 'Tap the map to place the centre.'}
      </p>
      {mode === 'circle' && (
        <div className="mt-3">
          <ConfigSlider field={{ key: 'r', label: 'Radius', unit: 'm', min: 30, max: 600, step: 10 }} value={radius} onChange={setRadius} />
        </div>
      )}
    </div>
  );
}

export function Host() {
  const org = useOrganiser();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const eventId = params.get('event');
  const game: GameId = 'chase';
  const meta = GAMES[game];
  const [title, setTitle] = useState(params.get('title') ?? '');
  const [boundary, setBoundary] = useState<Boundary | null>(null);
  const [config, setConfig] = useState(() => normalizeConfig(game, {}));
  const [plays, setPlays] = useState(false);
  const [busy, setBusy] = useState(false);
  const ok = useMemo(() => !!boundary && isValidBoundary(boundary), [boundary]);

  if (!org) return <Navigate to="/welcome" replace />;

  const create = async () => {
    if (!boundary) return;
    setBusy(true);
    try {
      const body: CreateRoomBody = { title: title || `${meta.name} game`, game, boundary, config, organiserPlays: plays, eventId: eventId ?? undefined };
      const r = await api<{ code: string; organiserKey: string }>('/rooms', { body });
      setSession(r.code, { organiserKey: r.organiserKey, name: org.username });
      nav(`/play/${r.code}`, { replace: true });
    } catch (e) {
      toastError(e);
      setBusy(false);
    }
  };

  return (
    <Page title="Host a game" back="/">
      <Field label="Title">
        <Input value={title} maxLength={24} onChange={(e) => setTitle(e.target.value)} placeholder={`${meta.name} in the park`} />
      </Field>

      <Section title="Play area">
        <AreaEditor value={boundary} onChange={setBoundary} />
      </Section>

      <Section title="Settings">
        <Card>
          {meta.fields.map((f) => (
            <ConfigSlider key={f.key} field={f} value={config[f.key]} onChange={(v) => setConfig((c) => ({ ...c, [f.key]: v }))} />
          ))}
          <Toggle
            checked={plays}
            onChange={setPlays}
            label="I’m playing too"
            help="Off: you referee with the full map and every claim code. On: you play and see what players see."
          />
        </Card>
      </Section>

      <div className="mt-6">
        <Button block size="lg" disabled={!ok} loading={busy} onClick={create}>
          Create game
        </Button>
        {!ok && <p className="mt-2 text-center text-sm text-dim">Set a play area first.</p>}
      </div>
    </Page>
  );
}
