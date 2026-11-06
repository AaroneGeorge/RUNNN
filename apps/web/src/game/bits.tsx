import NumberFlow from '@number-flow/react';
import { Siren, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ClientMsg, Radar as RadarData, Role, RoomView, TeamPoints } from '@runnn/shared';
import { cx } from '../components/ui.tsx';
import type { ConnStatus } from '../lib/conn.ts';
import { useNow, type GeoState } from '../lib/hooks.ts';
import { clock } from '../lib/time.ts';

/** Everything an in-game screen needs. */
export interface GameCtx {
  view: RoomView;
  send: (m: ClientMsg) => boolean;
  serverNow: () => number;
  status: ConnStatus;
  geo: GeoState;
  testMode: boolean;
  /** Organiser watching a simulation: read-only. */
  watching?: boolean;
}

/** Counts down to a wall-clock deadline, corrected by the server clock offset. */
export function Countdown({ endsAt, serverNow, className, paused }: { endsAt: number | null; serverNow: () => number; className?: string; paused?: boolean }) {
  const frozen = useRef<number | null>(null);
  useNow(250);
  if (endsAt === null) return null;
  const left = endsAt - serverNow();
  if (paused) frozen.current ??= left;
  else frozen.current = null;
  return <span className={cx('tabular', className)}>{clock(paused ? frozen.current! : left)}</span>;
}

/** Ring that fills from the server's hold progress. */
export function HoldRing({ startedAt, holdMs, serverNow, size = 220, tone = 'accent' }: { startedAt: number; holdMs: number; serverNow: () => number; size?: number; tone?: 'accent' | 'alarm' }) {
  useNow(60);
  const p = Math.max(0, Math.min(1, (serverNow() - startedAt) / holdMs));
  const r = size / 2 - 10;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,.25)" strokeWidth="12" fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={tone === 'alarm' ? 'var(--color-alarm)' : 'var(--color-accent)'}
        strokeWidth="12"
        strokeLinecap="round"
        fill="none"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - p)}
      />
    </svg>
  );
}

export function RoleBadge({ role, className }: { role: Role | null; className?: string }) {
  if (!role) return null;
  const label = role === 'hunter' ? '🎯 Hunter' : role === 'runner' ? '🏃 Runner' : '📋 Organiser';
  return (
    <span
      className={cx(
        'inline-flex h-8 items-center rounded-full px-3 text-sm font-extrabold text-white',
        role === 'hunter' && 'bg-hunter',
        role === 'runner' && 'bg-runner',
        role === 'organiser' && 'bg-ink text-night',
        className,
      )}
    >
      {label}
    </span>
  );
}

export function Points({ points, className }: { points: TeamPoints; className?: string }) {
  return (
    <span className={cx('inline-flex gap-3 tabular font-extrabold', className)}>
      {points.runner !== null && (
        <span className="text-runner">
          🏃 <NumberFlow value={points.runner} />
        </span>
      )}
      {points.hunter !== null && (
        <span className="text-hunter">
          🎯 <NumberFlow value={points.hunter} />
        </span>
      )}
    </span>
  );
}

export function ConnBadge({ status }: { status: ConnStatus }) {
  if (status === 'open') return <Wifi className="size-4 text-good" aria-label="Connected" />;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-alarm px-2 py-0.5 text-xs font-bold text-white">
      <WifiOff className="size-3.5" /> {status === 'closed' ? 'Offline' : 'Reconnecting'}
    </span>
  );
}

/** Anonymous radar: relative metres only, with an opaque key per dot. */
export function Radar({ radar, role, size = 220 }: { radar: RadarData | null; role: Role | null; size?: number }) {
  if (!radar) {
    return (
      <div className="grid place-items-center rounded-full bg-sunk text-center text-sm font-semibold text-dim" style={{ width: size, height: size }}>
        Radar needs
        <br />a GPS fix
      </div>
    );
  }
  const half = size / 2;
  const k = (half - 14) / radar.range;
  return (
    <div className="relative overflow-hidden rounded-full bg-ink" style={{ width: size, height: size }}>
      {[1, 0.66, 0.33].map((f) => (
        <div key={f} className="absolute rounded-full border border-white/15" style={{ inset: half - (half - 6) * f }} />
      ))}
      <div className="absolute inset-0 radar-sweep" style={{ background: 'conic-gradient(from 0deg, rgba(255,194,26,.35), transparent 25%)' }} />
      <div className="absolute size-3 rounded-full bg-accent ring-4 ring-accent/30" style={{ left: half - 6, top: half - 6 }} />
      {radar.blips.map((b) => {
        const mine = b.team === role;
        return (
          <div
            key={b.key}
            className="absolute size-4 rounded-full transition-all duration-700 ease-[var(--ease-out)]"
            style={{
              left: half + b.e * k,
              top: half - b.n * k,
              transform: 'translate(-50%,-50%)',
              background: b.team === 'hunter' ? 'var(--color-hunter)' : 'var(--color-runner)',
              boxShadow: mine ? 'none' : '0 0 0 4px rgba(255,255,255,.25)',
              animation: 'blip-in .4s var(--ease-out)',
            }}
          />
        );
      })}
      <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] font-bold text-white/60">{radar.range} m</span>
    </div>
  );
}

/** Hold for a second to send, so a pocket cannot trigger it. */
export function SosButton({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (on)
    return (
      <button onClick={() => onChange(false)} className="inline-flex h-12 shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-alarm px-4 font-extrabold text-white">
        <Siren className="size-5 animate-pulse" /> Cancel SOS
      </button>
    );
  return (
    <button
      aria-label="Hold for one second to send SOS"
      onPointerDown={() => {
        setHolding(true);
        timer.current = window.setTimeout(() => {
          setHolding(false);
          onChange(true);
        }, 1000);
      }}
      onPointerUp={() => {
        clearTimeout(timer.current);
        setHolding(false);
      }}
      onPointerLeave={() => {
        clearTimeout(timer.current);
        setHolding(false);
      }}
      className={cx(
        'relative inline-flex h-12 shrink-0 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full bg-panel px-4 font-bold ring-1 ring-line',
        holding && 'text-white',
      )}
    >
      <span className={cx('absolute inset-0 origin-left bg-alarm transition-transform ease-linear', holding ? 'scale-x-100 duration-1000' : 'scale-x-0 duration-150')} />
      <Siren className="relative size-5" />
      <span className="relative">SOS</span>
    </button>
  );
}
