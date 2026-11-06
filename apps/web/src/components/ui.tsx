import { ChevronLeft, Loader2, X } from 'lucide-react';
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { useNavigate } from 'react-router';
import type { ConfigField } from '@runnn/shared';

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');

// ───────────────────────────── layout ─────────────────────────────

export function Page({
  title,
  back,
  actions,
  children,
  wide,
  className,
}: {
  title?: ReactNode;
  back?: string | true;
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  const nav = useNavigate();
  return (
    <div className={cx('mx-auto w-full px-4 pb-28', wide ? 'max-w-3xl' : 'max-w-xl', className)}>
      {(title || back || actions) && (
        <header className="safe-top sticky top-0 z-20 -mx-4 mb-3 flex items-center gap-2 bg-night/90 px-4 pb-3 backdrop-blur">
          {back && (
            <button
              aria-label="Back"
              onClick={() => (back === true ? (history.length > 1 ? nav(-1) : nav('/')) : nav(back))}
              className="-ml-2 grid size-10 place-items-center rounded-full active:bg-sunk"
            >
              <ChevronLeft className="size-6" />
            </button>
          )}
          <h1 className="min-w-0 flex-1 truncate text-2xl font-extrabold tracking-tight">{title}</h1>
          {actions}
        </header>
      )}
      {children}
    </div>
  );
}

export function Card({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={cx(
        'block w-full rounded-3xl bg-panel p-4 text-left shadow-[0_1px_0_rgba(0,0,0,0.04)] ring-1 ring-line/60',
        onClick && 'transition active:scale-[0.99] active:bg-sunk',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function Section({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('mt-6', className)}>
      {(title || action) && (
        <div className="mb-2 flex items-end justify-between px-1">
          <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-dim">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

// ───────────────────────────── buttons ─────────────────────────────

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink active:brightness-95',
  secondary: 'bg-panel text-ink ring-1 ring-line active:bg-sunk',
  ghost: 'bg-transparent text-ink active:bg-sunk',
  danger: 'bg-alarm text-white active:brightness-95',
  dark: 'bg-ink text-night active:opacity-90',
};

export function Button({
  variant = 'primary',
  size = 'md',
  block,
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-full font-bold transition duration-150 ease-[var(--ease-out)] active:scale-[0.97] disabled:opacity-45 disabled:active:scale-100',
        size === 'sm' && 'h-9 px-4 text-sm',
        size === 'md' && 'h-12 px-5 text-base',
        size === 'lg' && 'h-14 px-6 text-lg',
        block && 'w-full',
        VARIANTS[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="size-5 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      {...rest}
      className={cx('grid size-11 place-items-center rounded-full bg-panel ring-1 ring-line active:bg-sunk disabled:opacity-40', className)}
    >
      {children}
    </button>
  );
}

// ───────────────────────────── forms ─────────────────────────────

export function Field({ label, help, error, children }: { label: ReactNode; help?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="mb-4 block">
      <span className="mb-1.5 block px-1 text-sm font-bold">{label}</span>
      {children}
      {help && !error && <span className="mt-1.5 block px-1 text-sm text-dim">{help}</span>}
      {error && <span className="mt-1.5 block px-1 text-sm font-semibold text-alarm">{error}</span>}
    </label>
  );
}

const inputCls =
  'w-full rounded-2xl bg-panel px-4 py-3 ring-1 ring-line outline-none transition placeholder:text-dim/70 focus:ring-2 focus:ring-ink';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, 'h-13', props.className)} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputCls, 'min-h-24', props.className)} />;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cx('flex rounded-full bg-sunk p-1', className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            'h-9 flex-1 rounded-full px-3 text-sm font-bold transition',
            o.value === value ? 'bg-panel text-ink shadow-sm' : 'text-dim',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, help }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; help?: ReactNode }) {
  return (
    <button onClick={() => onChange(!checked)} className="flex w-full items-center gap-3 py-3 text-left" role="switch" aria-checked={checked}>
      <span className="flex-1">
        <span className="block font-bold">{label}</span>
        {help && <span className="block text-sm text-dim">{help}</span>}
      </span>
      <span className={cx('relative h-7 w-12 shrink-0 rounded-full transition', checked ? 'bg-ink' : 'bg-line')}>
        <span
          className={cx(
            'absolute top-1 size-5 rounded-full bg-panel shadow transition-all duration-200 ease-[var(--ease-out)]',
            checked ? 'left-6' : 'left-1',
          )}
        />
      </span>
    </button>
  );
}

/** A slider bound to one tunable game setting. */
export function ConfigSlider({ field, value, onChange }: { field: ConfigField; value: number; onChange: (v: number) => void }) {
  const shown = field.minutes ? value / 60 : value;
  const unit = field.unit ?? '';
  return (
    <div className="mb-5">
      <div className="mb-1 flex items-baseline justify-between px-1">
        <span className="text-sm font-bold">{field.label}</span>
        <span className="tabular text-lg font-extrabold">
          {shown}
          <span className="ml-0.5 text-sm font-bold text-dim">{unit}</span>
        </span>
      </div>
      <input
        type="range"
        min={field.min}
        max={field.max}
        step={field.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-ink)]"
      />
      {field.help && <p className="mt-1 px-1 text-sm text-dim">{field.help}</p>}
    </div>
  );
}

// ───────────────────────────── bits ─────────────────────────────

export function Pill({ children, tone = 'plain', className }: { children: ReactNode; tone?: 'plain' | 'accent' | 'alarm' | 'good' | 'dark'; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-bold',
        tone === 'plain' && 'bg-sunk text-ink',
        tone === 'accent' && 'bg-accent text-accent-ink',
        tone === 'alarm' && 'bg-alarm text-white',
        tone === 'good' && 'bg-good text-white',
        tone === 'dark' && 'bg-ink text-night',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Stat({ label, value, className }: { label: ReactNode; value: ReactNode; className?: string }) {
  return (
    <div className={cx('rounded-2xl bg-sunk px-3 py-2.5', className)}>
      <div className="tabular text-2xl font-extrabold leading-tight">{value}</div>
      <div className="text-xs font-bold uppercase tracking-wider text-dim">{label}</div>
    </div>
  );
}

export function Avatar({ name, size = 40, color }: { name: string; size?: number; color?: string }) {
  const initials =
    name
      .replace(/[^\p{L}\p{N} ]/gu, '')
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '?';
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-extrabold text-white"
      style={{ width: size, height: size, fontSize: size * 0.38, background: color ?? '#141414' }}
    >
      {initials}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-6 animate-spin text-dim', className)} />;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="grid place-items-center gap-3 py-16 text-dim">
      <Spinner />
      <span className="text-sm font-semibold">{label}</span>
    </div>
  );
}

export function ErrorBox({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl bg-alarm/10 p-4 text-sm font-semibold text-alarm ring-1 ring-alarm/30">
      {children}
      {onRetry && (
        <button onClick={onRetry} className="ml-2 underline">
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ art, title, body, action }: { art?: ReactNode; title: ReactNode; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      {art && <div className="mb-4">{art}</div>}
      <h3 className="text-lg font-extrabold">{title}</h3>
      {body && <p className="mt-1 max-w-xs text-sm text-dim">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** A bottom sheet that reads like a native drawer. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <div className={cx('fixed inset-0 z-50', !open && 'pointer-events-none')} aria-hidden={!open}>
      <div
        onClick={onClose}
        className={cx('absolute inset-0 bg-black/40 transition-opacity duration-300', open ? 'opacity-100' : 'opacity-0')}
      />
      <div
        role="dialog"
        className={cx(
          'safe-bottom absolute inset-x-0 bottom-0 mx-auto max-h-[88dvh] max-w-xl overflow-y-auto rounded-t-[2rem] bg-night px-5 pt-3 transition-transform duration-500 ease-[var(--ease-drawer)]',
          open ? 'translate-y-0' : 'translate-y-full',
        )}
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line" />
        <div className="mb-3 flex items-center">
          <h2 className="flex-1 text-xl font-extrabold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="grid size-9 place-items-center rounded-full bg-sunk">
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function KeyValue({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="divide-y divide-line/70">
      {items.map(([k, v], i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-2.5">
          <dt className="text-sm text-dim">{k}</dt>
          <dd className="text-right font-bold">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ListRow({ left, title, sub, right, onClick }: { left?: ReactNode; title: ReactNode; sub?: ReactNode; right?: ReactNode; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={cx('flex w-full items-center gap-3 py-2.5 text-left', onClick && 'active:opacity-70')}>
      {left}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold">{title}</span>
        {sub && <span className="block truncate text-sm text-dim">{sub}</span>}
      </span>
      {right}
    </Tag>
  );
}
