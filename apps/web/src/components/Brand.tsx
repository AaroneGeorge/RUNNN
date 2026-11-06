import { Crosshair } from './Mascot.tsx';

/**
 * "ZOMBIE RUN" in two stacked lines, with the O drawn as the crosshair zombies scan through. On one line it's
 * about 40 % wider than the old "ZOMBIES" and overflows a phone at the sizes the screens use.
 * The crosshair locks on once when the wordmark first appears (see .wordmark-o in index.css).
 */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <div role="heading" aria-level={1} aria-label="Zombie Run" className={`font-display flex w-fit flex-col items-center uppercase ${className}`}>
      <span aria-hidden className="flex items-center">
        <span>Z</span>
        <span className="wordmark-o mx-[.03em] inline-block h-[.8em] w-[.8em]">
          <Crosshair size={100} style={{ width: '100%', height: '100%' }} />
        </span>
        <span>MBIE</span>
      </span>
      <span aria-hidden>RUN</span>
    </div>
  );
}
