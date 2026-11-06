import { useId, type CSSProperties, type ReactNode } from 'react';
import type { Team } from '@kalikkam/shared';

export type Mood = 'idle' | 'happy' | 'sad' | 'scared';

const INK = '#141414';
const SUN = '#ffc21a';
const SW = 3.6; // outline weight in viewBox units

/** An inked "tube": a thick ink stroke under a thinner fill stroke (arms, legs, fingers). */
function Tube({ d, fill, w = 9 }: { d: string; fill: string; w?: number }) {
  return (
    <>
      <path d={d} fill="none" stroke={INK} strokeWidth={w + SW * 2} strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke={fill} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

/** A googly eye: white ball, ink rim, pupil looking at (dx, dy), a glint. */
function Eye({ cx, cy, r, dx = 0, dy = 0, pupil = 0.42 }: { cx: number; cy: number; r: number; dx?: number; dy?: number; pupil?: number }) {
  const pr = r * pupil;
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="#fff" stroke={INK} strokeWidth={SW} />
      <circle cx={cx + dx} cy={cy + dy} r={pr} fill={INK} />
      <circle cx={cx + dx - pr * 0.35} cy={cy + dy - pr * 0.4} r={Math.max(1.2, pr * 0.3)} fill="#fff" />
    </g>
  );
}

// ---- Zombie: a chunky yellow monster, two horns, one googly eye, one stitched X, a mouth full of teeth.
const Z_BODY =
  'M24 117 C16 115 15 104 16 94 C17 78 15 62 19 50 C22 38 30 31 40 29 L43 19 L51 28 C57 27 64 27 70 28 L79 18 L83 30 C94 34 101 42 103 54 C105 66 103 80 104 94 C105 106 103 115 95 117 Z';

function ZombieFace({ mood }: { mood: Mood }) {
  const look = mood === 'sad' ? { dx: 0, dy: 4 } : mood === 'happy' ? { dx: 2, dy: -3 } : mood === 'scared' ? { dx: 0, dy: 0 } : { dx: 3, dy: 1 };
  return (
    <>
      {/* Stitches across the right brow */}
      <g stroke={INK} strokeWidth={2.6} strokeLinecap="round" fill="none">
        <path d="M68 39 Q80 37 92 43" />
        <path d="M73 34.5 L72 43" />
        <path d="M80 34 L80 42.5" />
        <path d="M87 36.5 L85.5 44.5" />
      </g>
      <g className="m-eyes">
        <Eye cx={44} cy={53} r={mood === 'scared' ? 14.5 : 13} pupil={mood === 'scared' ? 0.25 : 0.42} {...look} />
        <path d="M73 47 L85 59 M85 47 L73 59" stroke={INK} strokeWidth={SW} strokeLinecap="round" />
      </g>
      {mood === 'happy' ? (
        <>
          <path d="M26 74 C40 80 80 80 94 74 C92 98 78 110 60 110 C42 110 28 98 26 74 Z" fill={INK} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
          <path d="M29 76.5 L35 87 L41 78.5 L47 89 L53 79.3 L59 90 L65 79.3 L71 89 L77 78.5 L83 87 L90 76.5 Z" fill="#fff" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
          <path d="M44 107 L49 98 L54 107.6 Z M62 107.6 L67 98 L72 107 Z" fill="#fff" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
        </>
      ) : mood === 'sad' ? (
        <>
          <path d="M38 98 C46 88 74 88 82 98 C74 95 46 95 38 98 Z" fill={INK} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
          <path d="M44 95 L48 91 L52 94 L56 90.5 L60 94 L64 90.5 L68 94 L72 91 L76 95" fill="none" stroke="#fff" strokeWidth={2} strokeLinejoin="round" />
          {/* drool */}
          <path d="M70 99 C70 104 68 107 70 110 C72 112 75 110 74 106 C73.4 103 72 101 70 99 Z" fill="#fff" stroke={INK} strokeWidth={2} />
        </>
      ) : mood === 'scared' ? (
        <>
          <ellipse cx="60" cy="92" rx="13" ry="12" fill={INK} stroke={INK} strokeWidth={SW} />
          <path d="M49 86 L53 92 L57 86.5 L61 92.5 L65 86.5 L69 91.5 L71 87" fill="#fff" stroke={INK} strokeWidth={1.8} strokeLinejoin="round" />
        </>
      ) : (
        <>
          <path d="M30 78 C42 83 78 83 90 78 C88 95 76 105 60 105 C44 105 32 95 30 78 Z" fill={INK} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
          <path d="M33 80.4 L38.5 89.5 L44 82 L49.5 91 L55 82.8 L60.5 91.5 L66 82.8 L71.5 91 L77 82 L82.5 89.5 L87 80.4 Z" fill="#fff" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
          <path d="M47 102.5 L51.5 95 L56 103.6 Z M64 103.6 L68.5 95 L73 102.5 Z" fill="#fff" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
        </>
      )}
    </>
  );
}

function Zombie({ mood }: { mood: Mood }) {
  const up = mood === 'happy' || mood === 'scared';
  return (
    <>
      {/* Legs */}
      <Tube d="M42 113 L41 124" fill={SUN} w={11} />
      <Tube d="M78 113 L79 124" fill={SUN} w={11} />
      {/* Arms reach out; raised when celebrating or startled. */}
      <g className="m-arm-l">
        <Tube d={up ? 'M22 66 Q10 58 7 44' : 'M22 70 Q11 68 5 58'} fill={SUN} />
        <Tube d={up ? 'M7 44 L3 38 M7 44 L8 37 M7 44 L12 39' : 'M5 58 L0.5 54 M5 58 L3 51.5 M5 58 L9 53'} fill={SUN} w={4.4} />
      </g>
      <g className="m-arm-r">
        <Tube d={up ? 'M98 66 Q110 58 113 44' : 'M98 70 Q109 68 115 58'} fill={SUN} />
        <Tube d={up ? 'M113 44 L117 38 M113 44 L112 37 M113 44 L108 39' : 'M115 58 L119.5 54 M115 58 L117 51.5 M115 58 L111 53'} fill={SUN} w={4.4} />
      </g>
      <path d={Z_BODY} fill={SUN} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      {/* A highlight stroke gives the flat body a little volume. */}
      <path d="M25 62 C25 50 30 42 38 38" fill="none" stroke="#ffe08a" strokeWidth={3.4} strokeLinecap="round" />
      <ZombieFace mood={mood} />
    </>
  );
}

// ---- Survivor: a round white creature with a cowlick, two big googly eyes and yellow sneakers.
const S_BODY = 'M60 30 C85 30 100 48 100 75 C100 102 84 119 60 119 C36 119 20 102 20 75 C20 48 35 30 60 30 Z';

function Survivor({ mood, clip }: { mood: Mood; clip: string }) {
  const up = mood === 'scared' || mood === 'happy';
  const look = mood === 'scared' ? { dx: -4, dy: -1 } : mood === 'sad' ? { dx: 0, dy: 4 } : mood === 'happy' ? { dx: 0, dy: -2 } : { dx: 2, dy: 1 };
  return (
    <>
      <defs>
        <clipPath id={clip}>
          <path d={S_BODY} />
        </clipPath>
      </defs>
      {/* Legs and sneakers */}
      <Tube d="M46 114 L45 123" fill="#fff" w={8} />
      <Tube d="M74 114 L75 123" fill="#fff" w={8} />
      <path d="M33 128 C33 121 40 119 46 120 C52 121 54 126 52 129 Z" fill={SUN} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <path d="M87 128 C87 121 80 119 74 120 C68 121 66 126 68 129 Z" fill={SUN} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
      <g className="m-arm-l">
        <Tube d={up ? 'M24 74 Q12 64 12 50' : 'M24 82 Q12 88 12 100'} fill="#fff" w={8} />
      </g>
      <g className="m-arm-r">
        <Tube d={up ? 'M96 74 Q108 64 108 50' : 'M96 82 Q108 88 108 100'} fill="#fff" w={8} />
      </g>
      <path d={S_BODY} fill="#fff" stroke={INK} strokeWidth={SW} />
      {/* Shade crescent, clipped to the body */}
      <ellipse cx="104" cy="98" rx="34" ry="40" fill="#e9e5db" clipPath={`url(#${clip})`} />
      <path d={S_BODY} fill="none" stroke={INK} strokeWidth={SW} />
      {/* Cowlick */}
      <path d="M58 31 C52 21 58 11 66 14 C71 16 70 23 64 23" fill="none" stroke={INK} strokeWidth={SW} strokeLinecap="round" />
      <g className="m-eyes">
        <Eye cx={46} cy={66} r={mood === 'scared' ? 13 : 11.5} pupil={mood === 'scared' ? 0.28 : 0.44} {...look} />
        <Eye cx={74} cy={66} r={mood === 'scared' ? 13 : 11.5} pupil={mood === 'scared' ? 0.28 : 0.44} {...look} />
      </g>
      {mood === 'happy' ? (
        <>
          <path d="M46 86 C52 90 68 90 74 86 C73 99 66 104 60 104 C54 104 47 99 46 86 Z" fill={INK} stroke={INK} strokeWidth={SW} strokeLinejoin="round" />
          <path d="M53 99 C56 96 64 96 67 99 C64 102.5 56 102.5 53 99 Z" fill="#e8452c" />
        </>
      ) : mood === 'sad' ? (
        <>
          <path d="M50 97 Q60 89 70 97" fill="none" stroke={INK} strokeWidth={SW} strokeLinecap="round" />
          <path d="M33 78 C31 83 31 86 33 88 C35 90 38 88 37 84 C36.5 82 35 80 33 78 Z" fill="#fff" stroke={INK} strokeWidth={2} />
        </>
      ) : mood === 'scared' ? (
        <>
          <path d="M48 95 C52 90 56 99 60 94 C64 89 68 98 72 93 L72 97 C68 102 64 93 60 98 C56 103 52 94 48 99 Z" fill={INK} stroke={INK} strokeWidth={2.4} strokeLinejoin="round" />
          {/* Sweat drops */}
          <path d="M90 44 C93 50 95 53 92.5 56 C90 58.5 86.5 56 87.5 52 C88 49.5 89 47 90 44 Z" fill="#fff" stroke={INK} strokeWidth={2} />
          <path d="M98 56 C100 60 101 62 99.5 64 C98 65.5 95.5 64 96 61.5 C96.4 60 97.2 58 98 56 Z" fill="#fff" stroke={INK} strokeWidth={1.8} />
        </>
      ) : (
        <path d="M51 90 Q60 97 69 90" fill="none" stroke={INK} strokeWidth={SW} strokeLinecap="round" />
      )}
    </>
  );
}

/**
 * The two characters, inked doodle style. `live` turns on their idle motion (blink, arm sway): use it only where
 * the character is the subject of the screen, never in lists.
 */
export function Mascot({
  team,
  mood = 'idle',
  size = 96,
  live = false,
  className = '',
  style,
}: {
  team: Team;
  mood?: Mood;
  size?: number;
  live?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const clip = useId();
  return (
    <svg
      viewBox="-4 6 128 128"
      width={size}
      height={size}
      className={`${live ? 'mascot-live' : ''} ${className}`}
      style={{ overflow: 'visible', ...style }}
      aria-hidden
    >
      {team === 'zombie' ? <Zombie mood={mood} /> : <Survivor mood={mood} clip={clip} />}
    </svg>
  );
}

/** Four-point doodle star, ink-outlined. */
export function Sparkle({ size = 18, className = '', style, fill = 'currentColor' }: { size?: number; className?: string; style?: CSSProperties; fill?: string }) {
  return (
    <svg viewBox="-12 -12 24 24" width={size} height={size} className={className} style={style} aria-hidden>
      <path d="M0 -10 C1 -2.5 2.5 -1 10 0 C2.5 1 1 2.5 0 10 C-1 2.5 -2.5 1 -10 0 C-2.5 -1 -1 -2.5 0 -10 Z" fill={fill} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

/** The crosshair reticle: the game's mark (zombies scan through it). */
export function Crosshair({ size = 24, className = '', style, children }: { size?: number; className?: string; style?: CSSProperties; children?: ReactNode }) {
  return (
    <svg viewBox="-12 -12 24 24" width={size} height={size} className={className} style={style} aria-hidden>
      <circle r="7.2" fill="none" stroke="currentColor" strokeWidth="2.6" />
      <path d="M0 -11.5 V-4.2 M0 4.2 V11.5 M-11.5 0 H-4.2 M4.2 0 H11.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <circle r="1.9" fill="currentColor" />
      {children}
    </svg>
  );
}
