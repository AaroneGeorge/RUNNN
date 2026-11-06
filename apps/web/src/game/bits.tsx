import type { Role } from '@kalikkam/shared';
import type { PlayCtx } from '../pages/Play.tsx';
import { QR, Sheet, SwitchRow } from '../components/ui.tsx';
import { FlaskConical } from 'lucide-react';

/**
 * Team colours are fills (dots, chips, cards), always paired with an ink outline: zombies yellow, survivors white.
 * Text about a team stays ink; the fill and the character carry the team.
 */
export const ROLE_INFO: Record<Role, { name: string; emoji: string; color: string; soft: string }> = {
  host: { name: 'Referee', emoji: '🎙️', color: 'var(--color-raise)', soft: 'var(--color-raise)' },
  survivor: { name: 'Survivor', emoji: '🏃', color: 'var(--color-surv)', soft: 'var(--color-surv-soft)' },
  zombie: { name: 'Zombie', emoji: '🧟', color: 'var(--color-zomb)', soft: 'var(--color-zomb-soft)' },
};

export function GpsBadge({ ctx }: { ctx: PlayCtx }) {
  const { geo, settings, view } = ctx;
  let label = 'GPS…';
  let tone = 'text-gold';
  if (settings.simGps) {
    label = '🧪 Test GPS';
    tone = 'text-ink';
  } else if (geo.state.kind === 'ok') {
    const acc = Math.round(geo.state.fix.acc);
    label = `GPS ±${acc} m`;
    tone = acc <= 20 ? 'text-brand' : acc <= 50 ? 'text-gold' : 'text-blood';
  } else if (geo.state.kind === 'error') {
    label = 'GPS off';
    tone = 'text-blood';
  }
  if (!view.me.plays && !view.me.isHost) return null;
  return <span className={`chip bg-night/85 shadow-xl backdrop-blur ${tone}`}>📡 {label}</span>;
}

export function GpsWarning({ ctx }: { ctx: PlayCtx }) {
  const { geo, settings } = ctx;
  if (settings.simGps || geo.state.kind !== 'error') return null;
  return (
    <div className="rounded-2xl border border-blood/50 bg-blood/15 p-3 text-sm">
      <b>📡 {geo.state.message}</b>
      <button className="mt-2 block font-bold text-brand" onClick={() => ctx.setSettings({ ...settings, simGps: true })}>
        Use test mode instead (tap the map to move) →
      </button>
    </div>
  );
}

export function TestModeToggle({ ctx }: { ctx: PlayCtx }) {
  const { settings, setSettings } = ctx;
  return (
    <>
      <div className="-mx-4 mt-3 border-t border-line">
        <SwitchRow
          icon={<FlaskConical size={18} />}
          tone="text-gold"
          title="Test mode"
          desc="Fake GPS: tap the map to move yourself."
          checked={settings.simGps}
          onChange={(v) => setSettings({ ...settings, simGps: v })}
        />
      </div>
      <GpsWarning ctx={ctx} />
    </>
  );
}

export function MyVestSheet({ open, onClose, qr, vest, name, noVest }: { open: boolean; onClose: () => void; qr: string | null; vest: string; name: string; noVest: boolean }) {
  return (
    <Sheet open={open} onClose={onClose}>
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="label">{name}'s vest</div>
        <div className="font-mono text-8xl font-bold leading-none text-brand">{vest}</div>
        {qr && <QR text={qr} size={240} />}
        <p className="text-sm text-dim">
          {noVest
            ? "You joined without a printed vest. This is your QR: ask your host to print it, or zombies can only infect you when you tap \"I got infected\"."
            : 'This is the QR on your back. Zombies infect you by holding their camera on it.'}
        </p>
        <button className="btn-ghost w-full" onClick={onClose}>
          Close
        </button>
      </div>
    </Sheet>
  );
}
