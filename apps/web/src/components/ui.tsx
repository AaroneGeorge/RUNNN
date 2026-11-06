import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink, useNavigate } from 'react-router';
import { Award, Backpack, CalendarDays, ChevronLeft, CircleUserRound, Gamepad2 } from 'lucide-react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { Mascot } from './Mascot.tsx';
import { getHost } from '../lib/storage.ts';

export function TopBar({ title, back = true, right, onBack }: { title?: ReactNode; back?: boolean | string; right?: ReactNode; onBack?: () => void }) {
  const nav = useNavigate();
  return (
    <div className="mb-5 flex items-center gap-3">
      {back && (
        <button
          aria-label="Back"
          className="press grid h-11 w-11 shrink-0 place-items-center rounded-full bg-panel text-ink active:bg-raise"
          onClick={() => (onBack ? onBack() : typeof back === 'string' ? nav(back) : history.length > 1 ? nav(-1) : nav('/'))}
        >
          <ChevronLeft size={22} strokeWidth={2.5} />
        </button>
      )}
      <h1 className="flex-1 truncate text-2xl font-extrabold tracking-tight">{title}</h1>
      {right}
    </div>
  );
}

type Tab = { to: string; label: string; Icon: typeof Gamepad2; end?: boolean };
const PLAY: Tab = { to: '/', label: 'Play', Icon: Gamepad2, end: true };
const EVENTS: Tab = { to: '/events', label: 'Events', Icon: CalendarDays };
const ME: Tab = { to: '/me', label: 'Me', Icon: CircleUserRound };
// The third tab depends on who's holding the phone: hosts get the Kit (vest print sheets, gear), players their badges.
const HOST_NAV: Tab[] = [PLAY, EVENTS, { to: '/kit', label: 'Kit', Icon: Backpack }, ME];
const PLAYER_NAV: Tab[] = [PLAY, EVENTS, { to: '/achievements', label: 'Achievements', Icon: Award }, ME];

export function BottomNav() {
  // Read on every render: App re-renders on each navigation, so signing in or out as host swaps the tab straight away.
  const NAV = getHost() ? HOST_NAV : PLAYER_NAV;
  return (
    <nav className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line/70 bg-panel/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
      <div className="mx-auto grid max-w-xl grid-cols-4 px-2">
        {NAV.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `group flex flex-col items-center gap-1 pb-2 pt-2 text-[11px] font-bold ${isActive ? 'text-ink' : 'text-dim'}`}
          >
            {({ isActive }) => (
              <>
                <span
                  className={`grid h-8 w-14 place-items-center rounded-full transition-[background-color,transform] duration-150 group-active:scale-90 ${isActive ? 'bg-sun' : ''}`}
                >
                  <Icon size={22} strokeWidth={isActive ? 2.5 : 2} />
                </span>
                {label}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

/** Bottom sheet: slides up, swipe down (or flick) to dismiss, Esc and backdrop tap close it too. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [state, setState] = useState<'open' | 'closed' | 'closing'>('closed');
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; t: number; dy: number } | null>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Mount closed, then open on the next frame so the slide-up transition runs.
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setState('open')));
      return () => cancelAnimationFrame(r);
    }
    setState((s) => (s === 'closed' ? s : 'closing'));
    const t = setTimeout(() => {
      setMounted(false);
      setState('closed');
    }, 220);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  const setY = (y: number) => {
    if (panel.current) panel.current.style.transform = y ? `translateY(${y}px)` : '';
  };
  const onDown = (e: ReactPointerEvent) => {
    if (drag.current || (e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    drag.current = { y: e.clientY, t: performance.now(), dy: 0 };
    panel.current?.setAttribute('data-dragging', 'true');
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.y;
    // Downward follows the finger; upward resists (friction instead of a hard stop).
    d.dy = dy > 0 ? dy : -Math.sqrt(-dy) * 2;
    setY(d.dy);
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    panel.current?.removeAttribute('data-dragging');
    if (!d) return;
    const h = panel.current?.offsetHeight ?? 400;
    const velocity = d.dy / (performance.now() - d.t);
    // A quick flick dismisses even if it was short; otherwise it must travel 30% of the sheet.
    if (d.dy > h * 0.3 || (d.dy > 10 && velocity > 0.11)) {
      if (panel.current) panel.current.style.transform = 'translateY(100%)';
      onClose();
    } else setY(0);
  };

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center">
      <div data-state={state === 'open' ? 'open' : 'closed'} className="sheet-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        data-state={state}
        className="sheet-panel relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-[28px] border border-line bg-panel px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-[28px]"
      >
        <div className="sticky top-0 z-10 -mx-5 touch-none bg-panel px-5 pt-3" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-line sm:hidden" />
          {title && <h2 className="pb-4 text-xl font-extrabold">{title}</h2>}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function QR({ text, size = 200, className = '' }: { text: string; size?: number; className?: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    QRCode.toString(text, { type: 'svg', margin: 2, errorCorrectionLevel: 'M', color: { dark: '#0b0d17', light: '#ffffff' } })
      .then(setSvg)
      .catch(() => setSvg(''));
  }, [text]);
  return (
    <div
      className={`overflow-hidden rounded-xl bg-white ${className}`}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg.replace('<svg', `<svg width="${size}" height="${size}"`) }}
    />
  );
}

type Detector = { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };

/**
 * Rear camera into `video`, calling `onCode` for every QR it sees (continuous, ~8 checks/s).
 * Uses the native BarcodeDetector where it exists (Chrome Android) and jsQR on a downscaled frame elsewhere (iPhone).
 */
export function useQrCamera(video: RefObject<HTMLVideoElement | null>, onCode: (text: string) => void): string {
  const [err, setErr] = useState('');
  const cb = useRef(onCode);
  cb.current = onCode;
  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    const detector = BD ? new BD({ formats: ['qr_code'] }) : null;
    const loop = async () => {
      const v = video.current;
      if (!v || stopped) return;
      if (v.readyState >= 2 && v.videoWidth) {
        try {
          if (detector) {
            for (const c of await detector.detect(v)) cb.current(c.rawValue);
          } else if (ctx) {
            const scale = Math.min(1, 640 / v.videoWidth);
            canvas.width = Math.round(v.videoWidth * scale);
            canvas.height = Math.round(v.videoHeight * scale);
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
            if (code) cb.current(code.data);
          }
        } catch {
          /* keep scanning */
        }
      }
      if (!stopped) timer = window.setTimeout(loop, 120);
    };
    if (!navigator.mediaDevices) setErr('The camera needs the secure (https) link.');
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
        loop();
      })
      .catch(() => setErr('Camera unavailable. Allow camera access in your browser settings.'));
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [video]);
  return err;
}

/** One-shot scanner: closes on the first QR it reads. */
export function QrScanner({ onResult, onClose, hint = 'Point at the QR code' }: { onResult: (text: string) => void; onClose: () => void; hint?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const done = useRef(false);
  const err = useQrCamera(video, (t) => {
    if (done.current) return;
    done.current = true;
    onResult(t);
  });
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black">
      <video ref={video} playsInline muted className="h-full w-full flex-1 object-cover" />
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="h-64 w-64 rounded-3xl border-4 border-brand/80 shadow-[0_0_0_9999px_rgba(0,0,0,.45)]" />
      </div>
      <div className="absolute inset-x-0 bottom-0 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        {err && <p className="mb-3 rounded-xl bg-blood/20 p-3 text-sm">{err}</p>}
        <p className="mb-3 text-center text-sm text-dim">{hint}</p>
        <button className="btn-ghost w-full" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-dim">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-line border-t-brand" />
      {label && <p className="text-sm">{label}</p>}
    </div>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-blood/50 bg-blood/10 p-4 text-sm">{children}</div>;
}

export function Pill({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span className="chip" style={{ background: `color-mix(in srgb, ${color ?? 'var(--color-dim)'} 16%, transparent)`, color: color ?? 'var(--color-dim)' }}>
      {children}
    </span>
  );
}

export function GameBadge({ color, emoji, size = 'md' }: { color: string; emoji: string; size?: 'md' | 'lg' }) {
  const s = size === 'lg' ? 'h-16 w-16 text-4xl rounded-[22px]' : 'h-12 w-12 text-2xl rounded-2xl';
  return (
    <div className={`grid shrink-0 place-items-center overflow-hidden border-2 border-ink ${s}`} style={{ background: color }}>
      {/* Zombie Run's badge is its mascot; any future game falls back to its emoji. */}
      {emoji === '🧟' ? <Mascot team="zombie" size={size === 'lg' ? 52 : 38} className="mt-1.5" /> : emoji}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 p-8 text-center">
      <Mascot team="survivor" mood="idle" size={72} />
      <p className="font-display mt-1 text-lg">{title}</p>
      {children && <div className="text-sm text-dim">{children}</div>}
    </div>
  );
}

export function LinkCard({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="card press flex items-center gap-4 p-4 active:bg-raise">
      {children}
    </Link>
  );
}

export function shareText(text: string, url: string) {
  const full = `${text}\n${url}`;
  if (navigator.share) return navigator.share({ text, url }).catch(() => undefined);
  window.open(`https://wa.me/?text=${encodeURIComponent(full)}`, '_blank');
}

/** iOS-style toggle. The whole row is the tap target when used through SwitchRow. */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 ${checked ? 'bg-switch-on' : 'bg-line'}`}
    >
      <span
        className="absolute left-[2px] top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,.35)] transition-transform duration-200 ease-[var(--ease-out)]"
        style={{ transform: checked ? 'translateX(20px)' : 'none' }}
      />
    </button>
  );
}

export function SwitchRow({
  icon,
  tone,
  title,
  desc,
  checked,
  onChange,
}: {
  icon?: ReactNode;
  tone?: string;
  title: ReactNode;
  desc?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex cursor-pointer items-center gap-3 p-4" onClick={() => onChange(!checked)}>
      {icon && <IconTile tone={tone}>{icon}</IconTile>}
      <div className="min-w-0 flex-1">
        <div className="font-bold leading-tight">{title}</div>
        {desc && <div className="mt-0.5 text-sm leading-snug text-dim">{desc}</div>}
      </div>
      <span onClick={(e) => e.stopPropagation()}>
        <Switch checked={checked} onChange={onChange} label={typeof title === 'string' ? title : undefined} />
      </span>
    </div>
  );
}

/** Small rounded icon square, iOS Settings style. `tone` is a Tailwind text colour class. */
export function IconTile({ children, tone = 'text-ink' }: { children: ReactNode; tone?: string }) {
  return <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-raise ${tone}`}>{children}</span>;
}

/** Segmented control with a sliding selection pill. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label?: string;
}) {
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div role="radiogroup" aria-label={label} className="relative grid rounded-full bg-raise p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      <span
        aria-hidden
        className="absolute bottom-1 left-1 top-1 rounded-full bg-ink transition-transform duration-[250ms] ease-[var(--ease-out)]"
        style={{ width: `calc((100% - .5rem) / ${options.length})`, transform: `translateX(${i * 100}%)` }}
      />
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          className={`relative z-10 flex items-center justify-center gap-1.5 rounded-full py-2.5 text-sm font-bold transition-colors duration-150 ${o.value === value ? 'text-night' : 'text-dim'}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Range input with a filled track and a big thumb (see .range in index.css). */
export function Range({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  label: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      aria-label={label}
      className="range"
      min={min}
      max={max}
      step={step}
      value={value}
      style={{ '--p': `${pct}%` } as CSSProperties}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

/** Primary actions pinned above the home indicator (and above the tab bar when it shows). */
export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <>
      <div aria-hidden className="h-24" />
      <div className="action-bar fixed inset-x-0 z-20 px-4 pt-6">
        <div className="mx-auto flex max-w-xl flex-col gap-2">{children}</div>
      </div>
    </>
  );
}

/** Initial in a tinted circle; colour is stable per name. */
const AVATAR_COLORS = ['#ffc21a', '#ffffff', '#e2ded4', '#ffe7a3'];
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const c = AVATAR_COLORS[[...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVATAR_COLORS.length];
  return (
    <span
      className="light-surface grid shrink-0 place-items-center rounded-full font-extrabold"
      style={{ width: size, height: size, fontSize: size * 0.42, background: c, color: 'var(--color-ink)', boxShadow: 'inset 0 0 0 2px var(--color-ink)' }}
    >
      {[...name.trim()][0]?.toUpperCase() ?? '?'}
    </span>
  );
}
