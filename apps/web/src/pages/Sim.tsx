import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  GAMES,
  KOCHI_SPOTS,
  SIM_SPEEDS,
  normalizeConfig,
  type CreateRoomRequest,
  type CreateRoomResponse,
  type GameId,
  type LatLng,
} from '@kalikkam/shared';
import { api } from '../lib/api.ts';
import { setSession } from '../lib/storage.ts';
import { unlockAudio } from '../lib/sound.ts';
import { ActionBar, ErrorBox, Range, Segmented, TopBar } from '../components/ui.tsx';
import { LocateFixed, MapPin, Play, Video } from 'lucide-react';

const ROUNDS = [5, 10, 20];
type WatchFrom = 'referee' | 'zombie' | 'survivor' | 'both';
// Two phones side by side only fit on a wide screen.
const wide = () => window.matchMedia('(min-width: 768px)').matches;

/** Game settings for a bots-only round. The server puts about 1 in 10 bots on the zombie team. */
function simConfig(game: GameId, roundMin: number): Record<string, number> {
  return normalizeConfig(game, { durationSecs: roundMin * 60, zombieDelaySecs: 30 });
}

export function SimPage() {
  const nav = useNavigate();
  const game: GameId = 'zombies';
  const [spot, setSpot] = useState<LatLng & { name: string }>(KOCHI_SPOTS[2]);
  const [radius, setRadius] = useState(150);
  const [bots, setBots] = useState(24);
  const [roundMin, setRoundMin] = useState(10);
  const [speed, setSpeed] = useState(4);
  const [from, setFrom] = useState<WatchFrom>(() => (wide() ? 'both' : 'referee'));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [geoMsg, setGeoMsg] = useState('');

  const meta = GAMES[game];
  const watchMin = (roundMin / speed).toFixed(roundMin / speed < 2 ? 1 : 0);

  const nearMe = () => {
    if (!navigator.geolocation || !window.isSecureContext) return setGeoMsg('GPS needs the https link. Pick a spot instead.');
    setGeoMsg('Finding you…');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setSpot({ name: 'Where I am', lat: p.coords.latitude, lng: p.coords.longitude });
        setGeoMsg('');
      },
      () => setGeoMsg('Could not get your location. Pick a spot instead.'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const start = async () => {
    setBusy(true);
    setErr('');
    unlockAudio();
    try {
      const body: CreateRoomRequest = {
        game,
        title: `${meta.name} simulation`,
        boundary: { type: 'circle', center: { lat: spot.lat, lng: spot.lng }, radius },
        config: simConfig(game, roundMin),
        hostName: 'Director',
        hostPlays: false,
        sim: { bots, speed },
      };
      const r = await api<CreateRoomResponse>('/api/rooms', { body });
      setSession(r.code, { hostKey: r.hostKey, name: 'Director' });
      nav(from === 'both' ? `/watch/${r.code}` : from === 'referee' ? `/play/${r.code}` : `/play/${r.code}?watch=${from}`, { replace: true });
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <TopBar title="Simulation" />
      <p className="-mt-3 mb-5 text-sm text-dim">
        Bots play a full round of Zombie Run. Watch from the referee map, or through a zombie's or survivor's own screen. Good for testing and for
        screen-recording a demo.
      </p>

      <h3 className="label">Where</h3>
      <div className="-mx-4 mb-2 no-scrollbar flex gap-2 overflow-x-auto px-4">
        <button className={`btn-sm inline-flex shrink-0 items-center gap-1.5 rounded-xl border font-bold ${spot.name === 'Where I am' ? 'border-brand bg-brand/10 text-brand' : 'border-line text-dim'}`} onClick={nearMe}>
          <LocateFixed size={14} /> Near me
        </button>
        {KOCHI_SPOTS.map((s) => (
          <button
            key={s.name}
            className={`btn-sm inline-flex shrink-0 items-center gap-1.5 rounded-xl border font-bold ${spot.name === s.name ? 'border-brand bg-brand/10 text-brand' : 'border-line text-dim'}`}
            onClick={() => setSpot(s)}
          >
            <MapPin size={14} /> {s.name}
          </button>
        ))}
      </div>
      {geoMsg && <p className="mb-2 text-sm text-gold">{geoMsg}</p>}

      <div className="card my-4 divide-y divide-line">
        <Slider label="Play area radius" value={radius} unit="m" min={60} max={400} step={10} onChange={setRadius} />
        <Slider label="Bots" value={bots} unit="" min={4} max={60} step={1} onChange={setBots} />
        <div className="p-4">
          <div className="mb-2 text-sm font-semibold">Round length (game time)</div>
          <Segmented label="Round length" value={roundMin} onChange={setRoundMin} options={ROUNDS.map((v) => ({ value: v, label: `${v} min` }))} />
        </div>
        <div className="p-4">
          <div className="mb-2 text-sm font-semibold">Fast-forward</div>
          <Segmented label="Fast-forward" value={speed} onChange={setSpeed} options={SIM_SPEEDS.map((v) => ({ value: v as number, label: `${v}×` }))} />
          <p className="mt-2 text-xs text-dim">
            Bots run, think and the clock ticks {speed}× faster. Watching takes about <b className="text-ink">{watchMin} min</b>
            {' '}(less if everyone gets infected early).
          </p>
        </div>
      </div>

      <div className="card mb-4 p-4">
        <div className="mb-2 text-sm font-semibold">Watch from</div>
        <Segmented
          label="Watch from"
          value={from}
          onChange={setFrom}
          options={[
            { value: 'referee', label: '🗺 Map' },
            { value: 'zombie', label: '🧟 Zombie' },
            { value: 'survivor', label: '🏃 Survivor' },
            ...(wide() ? [{ value: 'both' as const, label: '⧉ Both' }] : []),
          ]}
        />
        <p className="mt-2 text-xs text-dim">
          {from === 'referee'
            ? 'The referee map with every bot. You can switch to a player screen during the game.'
            : from === 'both'
              ? "A zombie's phone and a survivor's phone side by side, exactly as players see them."
              : `Exactly what a ${from}'s phone shows: radar, alarms, scans and results. Switch to another bot or side any time.`}
        </p>
      </div>

      <p className="mb-4 flex gap-2.5 rounded-2xl border border-ink/15 bg-sun-soft p-3 text-sm leading-snug">
        <Video size={18} className="mt-px shrink-0 text-ink" />
        <span>
          To record: start your phone's screen recorder (Android quick settings → <b>Screen record</b>, iPhone Control Centre → ⏺), then
        tap Start. In the game, tap <b>Clean view</b> to hide the buttons.
        </span>
      </p>

      {err && (
        <div className="mb-4">
          <ErrorBox>{err}</ErrorBox>
        </div>
      )}
      <ActionBar>
        <button className="btn-brand w-full text-lg" disabled={busy} onClick={start}>
          {busy ? (
            'Setting up…'
          ) : (
            <>
              <Play size={20} fill="currentColor" /> Start {meta.name} simulation
            </>
          )}
        </button>
      </ActionBar>
    </div>
  );
}

function Slider({ label, value, unit, min, max, step, onChange }: { label: string; value: number; unit: string; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <div className="p-4">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-semibold">{label}</span>
        <span className="font-mono text-sm font-bold text-brand">
          {value} {unit}
        </span>
      </div>
      <Range label={label} min={min} max={max} step={step} value={value} onChange={onChange} />
    </div>
  );
}
