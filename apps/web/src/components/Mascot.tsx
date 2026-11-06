/** A little runner made of circles. Moods change the face and the pose. */
export function Mascot({ mood = 'run', size = 120 }: { mood?: 'run' | 'win' | 'sad' | 'wait'; size?: number }) {
  const legs =
    mood === 'run'
      ? ['M52 86 L40 108', 'M64 86 L80 102']
      : mood === 'win'
        ? ['M54 88 L48 110', 'M66 88 L72 110']
        : ['M54 88 L52 110', 'M66 88 L68 110'];
  const arms =
    mood === 'win'
      ? ['M46 62 L30 38', 'M74 62 L90 38']
      : mood === 'run'
        ? ['M46 64 L30 76', 'M74 62 L90 50']
        : ['M46 64 L36 82', 'M74 64 L84 82'];
  const mouth = mood === 'sad' ? 'M54 56 Q60 51 66 56' : mood === 'wait' ? 'M55 54 L65 54' : 'M53 52 Q60 60 67 52';
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden className={mood === 'run' ? 'motion-safe:animate-bounce' : ''}>
      <ellipse cx="60" cy="114" rx="26" ry="4" fill="currentColor" opacity=".12" />
      <g stroke="var(--color-ink)" strokeWidth="7" strokeLinecap="round" fill="none">
        {legs.map((d) => (
          <path key={d} d={d} />
        ))}
        {arms.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <circle cx="60" cy="58" r="30" fill="var(--color-accent)" stroke="var(--color-ink)" strokeWidth="5" />
      <circle cx="52" cy="46" r="3.5" fill="var(--color-ink)" />
      <circle cx="68" cy="46" r="3.5" fill="var(--color-ink)" />
      <path d={mouth} stroke="var(--color-ink)" strokeWidth="3.5" strokeLinecap="round" fill="none" />
      {mood === 'run' && (
        <g stroke="var(--color-dim)" strokeWidth="4" strokeLinecap="round">
          <path d="M8 50 L22 50" />
          <path d="M4 62 L22 62" opacity=".6" />
          <path d="M10 74 L22 74" opacity=".35" />
        </g>
      )}
    </svg>
  );
}
