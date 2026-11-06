import type { ReactNode } from 'react';
import { Mascot } from './Mascot.tsx';
import { QR } from './ui.tsx';

// The three first-launch tour scenes. Each loops one rule of the game, and only while its card is on screen
// (`active`): `.scene:not([data-active])` pauses every animation inside it (index.css). Reduced motion shows the
// scene's resting frame.

function Scene({ active, className = '', children }: { active: boolean; className?: string; children: ReactNode }) {
  return (
    <div className={`scene light-surface relative h-full w-full overflow-hidden rounded-[32px] ${className}`} data-active={active || undefined} aria-hidden>
      {children}
    </div>
  );
}

/** A doodle starburst with a word in it. */
function Burst({ children, className = '' }: { children: ReactNode; className?: string }) {
  const pts = Array.from({ length: 24 }, (_, i) => {
    const r = i % 2 ? 34 : 48;
    const a = (i / 24) * Math.PI * 2;
    return `${(Math.sin(a) * r).toFixed(1)},${(-Math.cos(a) * r).toFixed(1)}`;
  }).join(' ');
  return (
    <svg viewBox="-56 -56 112 112" width="104" height="104" className={className}>
      <polygon points={pts} fill="#fff" stroke="#141414" strokeWidth="3.4" strokeLinejoin="round" />
      <text y="9" textAnchor="middle" fontSize="27" fontWeight="900" style={{ fontStretch: '125%' }} fill="#141414">
        {children}
      </text>
    </svg>
  );
}

/** Random teams: the two sides square up. */
export function SceneTeams({ active }: { active: boolean }) {
  return (
    <Scene active={active} className="bg-sun bg-[length:420px] bg-topo">
      <Mascot team="zombie" mood="happy" size={176} live className="scene-lunge absolute -bottom-1 left-[1%]" />
      <div className="absolute left-1/2 top-[18%] -translate-x-1/2">
        <Burst className="scene-pulse">VS</Burst>
      </div>
      <Mascot team="survivor" mood="scared" size={132} live className="mascot-bob absolute bottom-3 right-[3%]" />
    </Scene>
  );
}

/** Watch your radar: a zombie closes in, the crosshair locks on, you get scared; it drifts off again. */
export function SceneRadar({ active }: { active: boolean }) {
  const R = 92;
  return (
    <Scene active={active} className="grid place-items-center bg-panel">
      <svg viewBox="-112 -112 224 224" className="h-[92%] w-[92%]">
        {[0, 90, 180, 270].map((a) => {
          const s = Math.sin((a * Math.PI) / 180);
          const c = Math.cos((a * Math.PI) / 180);
          return <line key={a} x1={(R + 4) * s} y1={-(R + 4) * c} x2={(R + 15) * s} y2={-(R + 15) * c} stroke="#141414" strokeWidth="3.4" strokeLinecap="round" />;
        })}
        <circle r={R} fill="#f7f5f0" stroke="#141414" strokeWidth="3.4" />
        {[0.33, 0.66].map((f) => (
          <circle key={f} r={R * f} fill="none" stroke="#141414" strokeOpacity=".16" strokeWidth="1.4" strokeDasharray="3 4" />
        ))}
        <circle className="radar-ping" r={R} fill="none" stroke="#ffc21a" strokeWidth="3" />
        <g className="scene-approach">
          <g className="scene-lock" stroke="#141414" strokeWidth="2.4" strokeLinecap="round" fill="none">
            <circle r="13" />
            <path d="M0 -19 V-15 M0 15 V19 M-19 0 H-15 M15 0 H19" />
          </g>
          <circle r="6.6" fill="#ffc21a" stroke="#141414" strokeWidth="2.4" />
        </g>
        <g className="scene-calm">
          <g transform="translate(-21 -23)">
            <Mascot team="survivor" mood="idle" size={42} />
          </g>
        </g>
        <g className="scene-alarm">
          <g transform="translate(-21 -23)">
            <Mascot team="survivor" mood="scared" size={42} />
          </g>
        </g>
      </svg>
    </Scene>
  );
}

/** Scan to infect: the crosshair holds on a vest QR, the ring fills, and the survivor turns. */
export function SceneScan({ active }: { active: boolean }) {
  const r = 70;
  const C = 2 * Math.PI * r;
  return (
    <Scene active={active} className="bg-raise bg-[length:420px] bg-topo">
      <div className="absolute left-1/2 top-[44%] -translate-x-1/2 -translate-y-1/2 -rotate-3 rounded-2xl border-[3px] border-ink bg-panel p-2">
        <QR text="Zombie Run vest" size={104} className="rounded-lg" />
      </div>
      <svg viewBox="-96 -96 192 192" className="absolute left-1/2 top-[44%] h-[200px] w-[200px] -translate-x-1/2 -translate-y-1/2">
        <circle r={r} fill="none" stroke="#141414" strokeOpacity=".18" strokeWidth="9" />
        <circle
          className="scene-fill"
          r={r}
          fill="none"
          stroke="#ffc21a"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={C}
          style={{ ['--c' as string]: C, strokeDashoffset: C }}
          transform="rotate(-90)"
        />
        <path d="M0 -94 V-80 M0 80 V94 M-94 0 H-80 M80 0 H94" stroke="#141414" strokeWidth="5" strokeLinecap="round" />
      </svg>
      <Mascot team="zombie" mood="happy" size={112} live className="absolute -bottom-2 -left-1" />
      <div className="absolute bottom-3 right-3 h-[86px] w-[86px]">
        <Mascot team="survivor" mood="scared" size={86} className="scene-before absolute inset-0" />
        <Mascot team="zombie" mood="idle" size={86} className="scene-after absolute inset-0" />
      </div>
      <span className="scene-plus font-display absolute right-[22%] top-[14%] grid h-11 w-11 place-items-center rounded-full border-2 border-ink bg-sun text-base">+1</span>
    </Scene>
  );
}
