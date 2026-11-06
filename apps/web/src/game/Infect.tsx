import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { VEST_QR_RE, type Hud } from '@kalikkam/shared';
import type { PlayCtx } from '../pages/Play.tsx';
import { useQrCamera } from '../components/ui.tsx';
import { beep, vibrate } from '../lib/sound.ts';
import { useNow } from '../lib/time.ts';

type ZHud = Extract<Hud, { kind: 'zombies' }>;

/** Wall-clock progress 0–1 of a server timer that ends at `endsAt` and lasts `totalMs`. */
const progressOf = (t: { endsAt: number; totalMs: number }, now: number) => Math.min(1, Math.max(0, 1 - (t.endsAt - now) / t.totalMs));

/**
 * Zombie's camera. Every frame that contains a vest QR is reported to the server, which decides when the
 * hold is long enough. Stays open after an infection so the zombie can go straight for the next survivor.
 */
export function InfectScanner({ ctx, onClose }: { ctx: PlayCtx; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const lastSent = useRef(0);
  const [seenAt, setSeenAt] = useState(0);
  const now = useNow(100);
  const serverNow = ctx.serverNow();
  const hud = ctx.view.hud.kind === 'zombies' ? (ctx.view.hud as ZHud) : null;
  const scanning = hud?.scanning ?? null;
  const err = useQrCamera(video, (text) => {
    if (!VEST_QR_RE.test(text.trim())) return;
    setSeenAt(Date.now());
    // ~5 reports a second is plenty; the server forgives gaps up to ~1.2 s.
    if (Date.now() - lastSent.current < 200) return;
    lastSent.current = Date.now();
    ctx.send({ t: 'scan', qr: text.trim() });
  });
  const seeing = now - seenAt < 600;
  const p = scanning ? progressOf(scanning, serverNow) : 0;
  const R = 120;
  const C = 2 * Math.PI * R;

  return (
    <div className="fixed inset-0 z-[60] bg-black">
      <video ref={video} playsInline muted className="absolute inset-0 h-full w-full object-cover" />
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <svg width={2 * R + 24} height={2 * R + 24} className="-rotate-90 overflow-visible drop-shadow-[0_0_24px_rgba(0,0,0,.6)]">
          {/* Crosshair ticks (drawn in the rotated frame, so they still land on N/E/S/W). */}
          <path
            d={`M${R + 12} ${-6} V${16} M${R + 12} ${2 * R + 8} V${2 * R + 30} M${-6} ${R + 12} H${16} M${2 * R + 8} ${R + 12} H${2 * R + 30}`}
            stroke="#fff"
            strokeWidth={6}
            strokeLinecap="round"
          />
          <circle cx={R + 12} cy={R + 12} r={R} fill="none" stroke="rgba(255,255,255,.22)" strokeWidth={10} />
          <circle
            cx={R + 12}
            cy={R + 12}
            r={R}
            fill="none"
            style={{ stroke: scanning ? 'var(--color-sun)' : seeing ? 'var(--color-sun)' : 'rgba(255,255,255,.6)', transition: 'stroke 150ms ease' }}
            strokeWidth={10}
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - (scanning ? p : seeing ? 0.02 : 0))}
          />
        </svg>
      </div>
      <div className="absolute inset-x-0 top-0 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="mx-auto max-w-md">
          <div className="rounded-2xl bg-black/65 px-4 py-3 backdrop-blur">
            {scanning ? (
              <>
                <div className="text-lg font-extrabold text-sun">🧟 Infecting {scanning.name}…</div>
                <div className="text-sm text-white/80">Hold steady on their back. {Math.max(0, Math.ceil((scanning.endsAt - serverNow) / 1000))} s</div>
              </>
            ) : seeing ? (
              <div className="text-lg font-extrabold text-sun">Got a QR, keep it in the ring…</div>
            ) : (
              <>
                <div className="text-lg font-extrabold text-white">Point at a survivor's back QR</div>
                <div className="text-sm text-white/70">Get close and hold the camera on it until the ring fills.</div>
              </>
            )}
          </div>
        </div>
      </div>
      {/* Bottom: thumb reach, and clear of the toasts that stack at the top. */}
      <div className="absolute inset-x-0 bottom-0 p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-md flex-col gap-3">
          {err && <div className="rounded-2xl bg-blood/90 p-4 text-sm font-semibold text-white">{err}</div>}
          <button aria-label="Close camera" className="btn w-full bg-white text-ink" onClick={onClose}>
            <X size={20} /> Close camera
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Survivor alarm while a zombie holds a camera on their back: red pulsing edges, a draining bar and a
 * heartbeat buzz. Running out of the camera's view breaks the scan.
 */
export function BeingScanned({ ctx }: { ctx: PlayCtx }) {
  const now = useNow(100);
  void now;
  const hud = ctx.view.hud.kind === 'zombies' ? (ctx.view.hud as ZHud) : null;
  const scan = hud?.beingScanned ?? null;
  const active = !!scan;
  const { settings } = ctx;

  useEffect(() => {
    if (!active) return;
    const beat = () => {
      if (settings.vibrate) vibrate([180, 90, 180]);
      if (settings.sound) beep(220, 140, 0.2, 'sawtooth');
    };
    beat();
    const id = setInterval(beat, 700);
    return () => clearInterval(id);
  }, [active, settings.vibrate, settings.sound]);

  if (!scan) return null;
  const p = progressOf(scan, ctx.serverNow());
  const left = Math.max(0, Math.ceil((scan.endsAt - ctx.serverNow()) / 1000));
  return (
    <>
      <div className="infect-vignette pointer-events-none fixed inset-0 z-40" />
      <div role="alert" className="pointer-events-none fixed inset-x-0 top-0 z-50 p-3 pt-[max(.75rem,env(safe-area-inset-top))]">
        <div className="mx-auto max-w-xl rounded-[22px] border-2 border-ink bg-blood p-4 text-white">
          <div className="flex items-center justify-between gap-3">
            <div className="font-display text-[22px]">You're being infected!</div>
            <div className="font-display font-mono text-[28px]">{left}s</div>
          </div>
          <div className="mt-1 text-sm font-bold text-white/90">
            RUN! Get your back out of their camera.{scan.zombies > 1 ? ` ${scan.zombies} zombies on you.` : ''}
          </div>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-ink/30">
            <div className="h-full rounded-full bg-white" style={{ width: `${p * 100}%`, transition: 'width 100ms linear' }} />
          </div>
        </div>
      </div>
    </>
  );
}
