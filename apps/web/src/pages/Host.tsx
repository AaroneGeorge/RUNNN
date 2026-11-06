import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  ENTRY_USDC,
  GAMES,
  KOCHI_SPOTS,
  boundaryArea,
  isValidBoundary,
  normalizeConfig,
  type Boundary,
  type ConfigField,
  type CreateRoomRequest,
  type CreateRoomResponse,
  type GameId,
  type LatLng,
} from '@kalikkam/shared';
import { api, ensureProfile } from '../lib/api.ts';
import { lastName, rememberName, setSession } from '../lib/storage.ts';
import { unlockAudio } from '../lib/sound.ts';
import { GameMap } from '../components/GameMap.tsx';
import { ActionBar, ErrorBox, Range, Segmented, SwitchRow, TopBar } from '../components/ui.tsx';
import {
  ArrowRight,
  ChevronDown,
  Circle,
  Footprints,
  Trophy,
  LocateFixed,
  MapPin,
  PenLine,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  Undo2,
} from 'lucide-react';

type Mode = 'circle' | 'polygon';

export function HostPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const eventId = params.get('event') ?? undefined;
  // One game for now, so the wizard starts at the play area.
  const [step, setStep] = useState(1);
  const game: GameId = 'zombies';
  const [mode, setMode] = useState<Mode>('circle');
  const [center, setCenter] = useState<LatLng | null>(null);
  const [radius, setRadius] = useState(120);
  const [points, setPoints] = useState<LatLng[]>([]);
  const [view, setView] = useState<LatLng | null>(null);
  const [geoMsg, setGeoMsg] = useState('');
  const [title, setTitle] = useState(params.get('title') ?? '');
  const [name, setName] = useState(lastName());
  const [plays, setPlays] = useState(false);
  const [entry, setEntry] = useState(false);
  const [vest, setVest] = useState('');
  const [config, setConfig] = useState<Record<string, number>>(() => normalizeConfig(game, {}));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const meta = GAMES[game];
  const boundary: Boundary | null = useMemo(() => {
    if (mode === 'circle') return center ? { type: 'circle', center, radius } : null;
    return points.length >= 3 ? { type: 'polygon', points } : null;
  }, [mode, center, radius, points]);
  const area = boundary ? boundaryArea(boundary) : 0;

  const locate = () => {
    setGeoMsg('Finding you…');
    if (!navigator.geolocation || !window.isSecureContext) {
      setGeoMsg('GPS needs the secure (https) link. Tap the map or pick a spot instead.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const here = { lat: p.coords.latitude, lng: p.coords.longitude };
        setView({ ...here });
        if (mode === 'circle') setCenter(here);
        setGeoMsg('');
      },
      () => setGeoMsg('Could not get your location. Tap the map instead.'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const onTap = (p: LatLng) => {
    if (mode === 'circle') setCenter(p);
    else setPoints((ps) => (ps.length >= 40 ? ps : [...ps, p]));
  };

  const create = async () => {
    if (!boundary || !isValidBoundary(boundary)) return;
    setBusy(true);
    setErr('');
    unlockAudio();
    rememberName(name.trim());
    await ensureProfile(name.trim() || 'Host').catch(() => undefined);
    try {
      const body: CreateRoomRequest = {
        game,
        title: title.trim() || `${meta.name} night`,
        boundary,
        config,
        hostName: name.trim() || 'Host',
        hostPlays: plays,
        entry,
        eventId,
      };
      const r = await api<CreateRoomResponse>('/api/rooms', { body });
      setSession(r.code, { hostKey: r.hostKey, name: name.trim() || 'Host', vest: plays && vest ? vest : undefined });
      nav(`/play/${r.code}`, { replace: true });
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  const basic = meta.fields.slice(0, 3);
  const advanced = meta.fields.slice(3);

  return (
    <div className="page">
      <TopBar title={step === 1 ? 'Play area' : 'Settings'} back={step === 1 ? '/' : true} onBack={step > 1 ? () => setStep(step - 1) : undefined} />
      <div className="-mt-2 mb-5">
        <div className="mb-2 flex gap-1.5">
          {[1, 2].map((i) => (
            <div key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-brand transition-transform duration-300 ease-[var(--ease-out)]" style={{ transform: `scaleX(${i <= step ? 1 : 0})`, transformOrigin: 'left' }} />
            </div>
          ))}
        </div>
        <div className="text-xs font-semibold text-dim">Step {step} of 2</div>
      </div>

      {step === 1 && (
        <>
          <div className="mb-3">
            <Segmented
              label="Area shape"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'circle', label: <><Circle size={16} /> Circle</> },
                { value: 'polygon', label: <><PenLine size={16} /> Draw shape</> },
              ]}
            />
          </div>
          <p className="mb-3 text-sm text-dim">
            {mode === 'circle' ? 'Tap the map to set the centre, then adjust the size.' : 'Tap the map to add corners around the play area (3+).'}
          </p>
          <GameMap
            className="mb-3 h-[48dvh] overflow-hidden rounded-3xl border border-line"
            boundary={null}
            draft={mode === 'circle' ? (center ? { circle: { center, radius } } : null) : { points }}
            onTap={onTap}
            center={view}
            showLabels={false}
          >
            <button
              aria-label="Use my location"
              className="press absolute bottom-3 right-3 z-10 grid h-11 w-11 place-items-center rounded-2xl border border-line bg-night/90 text-ink shadow-xl backdrop-blur"
              onClick={(e) => {
                e.stopPropagation();
                locate();
              }}
            >
              <LocateFixed size={20} />
            </button>
          </GameMap>
          {geoMsg && <p className="mb-3 text-sm text-gold">{geoMsg}</p>}
          <div className="-mx-4 mb-4 no-scrollbar flex gap-2 overflow-x-auto px-4">
            {KOCHI_SPOTS.map((s) => (
              <button key={s.name} className="btn-ghost btn-sm shrink-0" onClick={() => setView({ lat: s.lat, lng: s.lng })}>
                <MapPin size={14} className="text-blood" /> {s.name}
              </button>
            ))}
          </div>
          {mode === 'circle' ? (
            <div className="card mb-3 p-4">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-semibold">Radius</span>
                <span className="font-mono text-sm font-bold text-brand">{radius} m</span>
              </div>
              <Range label="Radius" min={30} max={600} step={10} value={radius} onChange={setRadius} />
            </div>
          ) : (
            <div className="mb-3 flex gap-2">
              <button className="btn-ghost btn-sm" disabled={!points.length} onClick={() => setPoints((p) => p.slice(0, -1))}>
                <Undo2 size={16} /> Undo
              </button>
              <button className="btn-ghost btn-sm" disabled={!points.length} onClick={() => setPoints([])}>
                <Trash2 size={16} /> Clear
              </button>
              <span className="ml-auto self-center text-sm text-dim">{points.length} corners</span>
            </div>
          )}
          {boundary && (
            <p className="mb-3 text-sm text-dim">
              Area ≈ <b className="text-ink">{area > 20000 ? `${(area / 10000).toFixed(1)} ha` : `${Math.round(area).toLocaleString()} m²`}</b>
              {' · '}good for about {Math.max(4, Math.round(area / 900))}–{Math.max(8, Math.round(area / 350))} players
            </p>
          )}
          <p className="flex gap-2.5 rounded-2xl border border-gold/30 bg-gold/10 p-3 text-sm leading-snug">
            <TriangleAlert size={18} className="mt-px shrink-0 text-gold" />
            Keep the boundary away from busy roads, water edges and construction. You're responsible for the space.
          </p>
          <ActionBar>
            <button className="btn-brand w-full text-lg" disabled={!boundary} onClick={() => setStep(2)}>
              {boundary ? 'Next: settings' : 'Tap the map to start'} <ArrowRight size={20} />
            </button>
          </ActionBar>
        </>
      )}

      {step === 2 && (
        <>
          <label className="label" htmlFor="htitle">
            Game title
          </label>
          <input id="htitle" className="field mb-4" placeholder={`${meta.name} night`} maxLength={60} enterKeyHint="next" value={title} onChange={(e) => setTitle(e.target.value)} />
          <label className="label" htmlFor="hname">
            Your name (host)
          </label>
          <input id="hname" className="field mb-4" placeholder="Host" maxLength={24} autoComplete="nickname" enterKeyHint="done" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="card mb-4">
            <SwitchRow
              icon={<Trophy size={18} />}
              tone="text-ink"
              title={`${ENTRY_USDC} USDC entry, winners take the pot`}
              desc={`Hackathon demo: test USDC on Arc Testnet, no real money. Each player verifies with World ID and pays ${ENTRY_USDC} USDC from a wallet we make for them; the top survivor and top zombie split the pot.`}
              checked={entry}
              onChange={setEntry}
            />
          </div>
          <div className="card mb-6">
            <SwitchRow
              icon={<Footprints size={18} />}
              tone="text-brand"
              title="I'm playing too"
              desc="Off = you referee with the full map (best for 15+ players)."
              checked={plays}
              onChange={setPlays}
            />
            {plays && (
              <div className="border-t border-line p-4">
                <label className="label" htmlFor="hvest">
                  Your vest number (optional)
                </label>
                <input
                  id="hvest"
                  className="field text-center font-mono text-3xl tracking-[.4em]"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="000"
                  maxLength={3}
                  value={vest}
                  onChange={(e) => setVest(e.target.value.replace(/\D/g, '').slice(0, 3))}
                />
              </div>
            )}
          </div>
          <h3 className="label">
            {meta.name} rules
          </h3>
          <div className="card mb-3 divide-y divide-line">
            {basic.map((f) => (
              <ConfigRow key={f.key} f={f} value={config[f.key]} onChange={(v) => setConfig((c) => ({ ...c, [f.key]: v }))} />
            ))}
          </div>
          {advanced.length > 0 && (
            <details className="group mb-4">
              <summary className="flex cursor-pointer list-none items-center gap-2 py-2 text-sm font-bold text-dim [&::-webkit-details-marker]:hidden">
                <SlidersHorizontal size={16} /> More settings ({advanced.length})
                <ChevronDown size={16} className="transition-transform duration-200 group-open:rotate-180" />
              </summary>
              <div className="card mt-2 divide-y divide-line">
                {advanced.map((f) => (
                  <ConfigRow key={f.key} f={f} value={config[f.key]} onChange={(v) => setConfig((c) => ({ ...c, [f.key]: v }))} />
                ))}
              </div>
            </details>
          )}
          {err && (
            <div className="mb-4">
              <ErrorBox>{err}</ErrorBox>
            </div>
          )}
          <ActionBar>
            <button className="btn-brand w-full text-lg" disabled={busy || (plays && vest.length > 0 && vest.length !== 3)} onClick={create}>
              {busy ? 'Creating…' : <>Create game <ArrowRight size={20} strokeWidth={2.6} /></>}
            </button>
          </ActionBar>
        </>
      )}
    </div>
  );
}

function ConfigRow({ f, value, onChange }: { f: ConfigField; value: number; onChange: (v: number) => void }) {
  const shown = f.minutes ? value / 60 : value;
  const unit = f.minutes ? 'min' : (f.unit ?? '');
  const isBool = f.min === 0 && f.max === 1;
  if (isBool) return <SwitchRow title={f.label.replace(' (1 = yes)', '')} desc={f.help} checked={value === 1} onChange={(v) => onChange(v ? 1 : 0)} />;
  return (
    <div className="p-4">
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">{f.label}</span>
        <span className="font-mono text-sm font-bold text-brand">
          {Number.isInteger(shown) ? shown : shown.toFixed(1)} {unit}
        </span>
      </div>
      <Range label={f.label} min={f.min} max={f.max} step={f.step} value={value} onChange={onChange} />
      {f.help && <p className="mt-1 text-xs text-dim">{f.help}</p>}
    </div>
  );
}
