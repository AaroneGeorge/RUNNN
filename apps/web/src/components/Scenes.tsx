/** Small flat illustrations for empty states and headers. */

export function MapScene({ size = 160 }: { size?: number }) {
  return (
    <svg viewBox="0 0 160 120" width={size} height={(size * 120) / 160} aria-hidden>
      <rect x="8" y="10" width="144" height="100" rx="18" fill="var(--color-sunk)" />
      <path d="M8 70 Q50 50 80 72 T152 60" stroke="var(--color-line)" strokeWidth="10" fill="none" />
      <polygon points="40,30 120,26 132,84 52,92" fill="var(--color-accent)" opacity=".25" stroke="var(--color-ink)" strokeWidth="3" strokeDasharray="6 5" />
      <circle cx="74" cy="56" r="7" fill="var(--color-runner)" />
      <circle cx="104" cy="66" r="7" fill="var(--color-hunter)" />
      <circle cx="88" cy="44" r="7" fill="var(--color-runner)" />
    </svg>
  );
}

export function CalendarScene({ size = 140 }: { size?: number }) {
  return (
    <svg viewBox="0 0 140 120" width={size} height={(size * 120) / 140} aria-hidden>
      <rect x="20" y="22" width="100" height="86" rx="16" fill="var(--color-panel)" stroke="var(--color-ink)" strokeWidth="4" />
      <rect x="20" y="22" width="100" height="24" rx="12" fill="var(--color-accent)" stroke="var(--color-ink)" strokeWidth="4" />
      <path d="M44 14 V30 M96 14 V30" stroke="var(--color-ink)" strokeWidth="6" strokeLinecap="round" />
      {[0, 1, 2].map((r) =>
        [0, 1, 2, 3].map((c) => <rect key={`${r}${c}`} x={32 + c * 20} y={56 + r * 16} width="12" height="9" rx="3" fill={r === 1 && c === 2 ? 'var(--color-ink)' : 'var(--color-line)'} />),
      )}
    </svg>
  );
}

export function TrophyScene({ size = 120 }: { size?: number }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden>
      <path d="M38 20 H82 V46 Q82 72 60 74 Q38 72 38 46 Z" fill="var(--color-accent)" stroke="var(--color-ink)" strokeWidth="4" />
      <path d="M38 28 H22 Q22 50 40 54 M82 28 H98 Q98 50 80 54" stroke="var(--color-ink)" strokeWidth="4" fill="none" />
      <rect x="52" y="74" width="16" height="16" fill="var(--color-ink)" />
      <rect x="38" y="90" width="44" height="12" rx="4" fill="var(--color-ink)" />
      <circle cx="60" cy="42" r="8" fill="var(--color-panel)" />
    </svg>
  );
}

export function QrScene({ size = 120 }: { size?: number }) {
  const cells = [
    [0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2],
    [4, 0], [5, 1], [4, 2], [6, 2], [3, 4], [5, 4], [6, 5], [4, 6], [0, 4], [1, 5], [2, 6], [0, 6],
  ];
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden>
      <rect x="10" y="10" width="100" height="100" rx="18" fill="var(--color-panel)" stroke="var(--color-ink)" strokeWidth="4" />
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={24 + x * 11} y={24 + y * 11} width="10" height="10" rx="2" fill="var(--color-ink)" />
      ))}
      <path d="M4 60 H116" stroke="var(--color-alarm)" strokeWidth="3" opacity=".8" />
    </svg>
  );
}
