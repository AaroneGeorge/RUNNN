// The two Kalikkam characters, drawn exactly as in the app (apps/web/src/components/Mascot.tsx), as plain SVG
// built once; pose(t, …) switches mood and arms and computes blink, sway and breath from t (no state).
import { el, show, INK, SUN } from './kit.js';

const SW = 3.6;
const ZBODY = 'M24 117 C16 115 15 104 16 94 C17 78 15 62 19 50 C22 38 30 31 40 29 L43 19 L51 28 C57 27 64 27 70 28 L79 18 L83 30 C94 34 101 42 103 54 C105 66 103 80 104 94 C105 106 103 115 95 117 Z';
const SBODY = 'M60 30 C85 30 100 48 100 75 C100 102 84 119 60 119 C36 119 20 102 20 75 C20 48 35 30 60 30 Z';
let uid = 0;

function tube(p, d, fill, w = 9) {
  el('path', { d, fill: 'none', stroke: INK, 'stroke-width': w + SW * 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, p);
  el('path', { d, fill: 'none', stroke: fill, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, p);
}
function eye(p, cx, cy, r, dx, dy, pupil = 0.42) {
  const pr = r * pupil;
  el('circle', { cx, cy, r, fill: '#fff', stroke: INK, 'stroke-width': SW }, p);
  el('circle', { cx: cx + dx, cy: cy + dy, r: pr, fill: INK }, p);
  el('circle', { cx: cx + dx - pr * 0.35, cy: cy + dy - pr * 0.4, r: Math.max(1.2, pr * 0.3), fill: '#fff' }, p);
}
const S = (extra = {}) => ({ stroke: INK, 'stroke-width': SW, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', fill: 'none', ...extra });

const MOODS = ['idle', 'happy', 'sad', 'scared'];

function zombieFace(p, mood) {
  const look = mood === 'sad' ? [0, 4] : mood === 'happy' ? [2, -3] : mood === 'scared' ? [0, 0] : [3, 1];
  const st = el('g', S({ 'stroke-width': 2.6 }), p);
  ['M68 39 Q80 37 92 43', 'M73 34.5 L72 43', 'M80 34 L80 42.5', 'M87 36.5 L85.5 44.5'].forEach((d) => el('path', { d }, st));
  const eyes = el('g', { class: 'eyes' }, p);
  eye(eyes, 44, 53, mood === 'scared' ? 14.5 : 13, look[0], look[1], mood === 'scared' ? 0.25 : 0.42);
  el('path', { d: 'M73 47 L85 59 M85 47 L73 59', ...S() }, eyes);
  if (mood === 'happy') {
    el('path', { d: 'M26 74 C40 80 80 80 94 74 C92 98 78 110 60 110 C42 110 28 98 26 74 Z', fill: INK, stroke: INK, 'stroke-width': SW, 'stroke-linejoin': 'round' }, p);
    el('path', { d: 'M29 76.5 L35 87 L41 78.5 L47 89 L53 79.3 L59 90 L65 79.3 L71 89 L77 78.5 L83 87 L90 76.5 Z', fill: '#fff', stroke: INK, 'stroke-width': 2, 'stroke-linejoin': 'round' }, p);
    el('path', { d: 'M44 107 L49 98 L54 107.6 Z M62 107.6 L67 98 L72 107 Z', fill: '#fff', stroke: INK, 'stroke-width': 2, 'stroke-linejoin': 'round' }, p);
  } else if (mood === 'sad') {
    el('path', { d: 'M38 98 C46 88 74 88 82 98 C74 95 46 95 38 98 Z', fill: INK, stroke: INK, 'stroke-width': SW, 'stroke-linejoin': 'round' }, p);
    el('path', { d: 'M44 95 L48 91 L52 94 L56 90.5 L60 94 L64 90.5 L68 94 L72 91 L76 95', fill: 'none', stroke: '#fff', 'stroke-width': 2, 'stroke-linejoin': 'round' }, p);
    el('path', { d: 'M70 99 C70 104 68 107 70 110 C72 112 75 110 74 106 C73.4 103 72 101 70 99 Z', fill: '#fff', stroke: INK, 'stroke-width': 2 }, p);
  } else if (mood === 'scared') {
    el('ellipse', { cx: 60, cy: 92, rx: 13, ry: 12, fill: INK, stroke: INK, 'stroke-width': SW }, p);
    el('path', { d: 'M49 86 L53 92 L57 86.5 L61 92.5 L65 86.5 L69 91.5 L71 87', fill: '#fff', stroke: INK, 'stroke-width': 1.8, 'stroke-linejoin': 'round' }, p);
  } else {
    el('path', { d: 'M30 78 C42 83 78 83 90 78 C88 95 76 105 60 105 C44 105 32 95 30 78 Z', fill: INK, stroke: INK, 'stroke-width': SW, 'stroke-linejoin': 'round' }, p);
    el('path', { d: 'M33 80.4 L38.5 89.5 L44 82 L49.5 91 L55 82.8 L60.5 91.5 L66 82.8 L71.5 91 L77 82 L82.5 89.5 L87 80.4 Z', fill: '#fff', stroke: INK, 'stroke-width': 2, 'stroke-linejoin': 'round' }, p);
    el('path', { d: 'M47 102.5 L51.5 95 L56 103.6 Z M64 103.6 L68.5 95 L73 102.5 Z', fill: '#fff', stroke: INK, 'stroke-width': 2, 'stroke-linejoin': 'round' }, p);
  }
  return eyes;
}

function survivorFace(p, mood) {
  const look = mood === 'scared' ? [-4, -1] : mood === 'sad' ? [0, 4] : mood === 'happy' ? [0, -2] : [2, 1];
  const eyes = el('g', { class: 'eyes' }, p);
  const r = mood === 'scared' ? 13 : 11.5, pu = mood === 'scared' ? 0.28 : 0.44;
  eye(eyes, 46, 66, r, look[0], look[1], pu);
  eye(eyes, 74, 66, r, look[0], look[1], pu);
  if (mood === 'happy') {
    el('path', { d: 'M46 86 C52 90 68 90 74 86 C73 99 66 104 60 104 C54 104 47 99 46 86 Z', fill: INK, stroke: INK, 'stroke-width': SW, 'stroke-linejoin': 'round' }, p);
    el('path', { d: 'M53 99 C56 96 64 96 67 99 C64 102.5 56 102.5 53 99 Z', fill: '#e8452c' }, p);
  } else if (mood === 'sad') {
    el('path', { d: 'M50 97 Q60 89 70 97', ...S() }, p);
    el('path', { d: 'M33 78 C31 83 31 86 33 88 C35 90 38 88 37 84 C36.5 82 35 80 33 78 Z', fill: '#fff', stroke: INK, 'stroke-width': 2 }, p);
  } else if (mood === 'scared') {
    el('path', { d: 'M48 95 C52 90 56 99 60 94 C64 89 68 98 72 93 L72 97 C68 102 64 93 60 98 C56 103 52 94 48 99 Z', fill: INK, stroke: INK, 'stroke-width': 2.4, 'stroke-linejoin': 'round' }, p);
    el('path', { d: 'M90 44 C93 50 95 53 92.5 56 C90 58.5 86.5 56 87.5 52 C88 49.5 89 47 90 44 Z', fill: '#fff', stroke: INK, 'stroke-width': 2 }, p);
    el('path', { d: 'M98 56 C100 60 101 62 99.5 64 C98 65.5 95.5 64 96 61.5 C96.4 60 97.2 58 98 56 Z', fill: '#fff', stroke: INK, 'stroke-width': 1.8 }, p);
  } else {
    el('path', { d: 'M51 90 Q60 97 69 90', ...S() }, p);
  }
  return eyes;
}

/**
 * A character, standing with its feet at the group's origin (scale 1 ≈ 128 px tall: pass size/128).
 * pose(t, {mood, up, live, seed}) shows the right face and arms; with `live` it blinks, sways and breathes.
 */
export function character(parent, team) {
  const z = team === 'zombie';
  const g = el('g', {}, parent);
  const body = el('g', { transform: 'translate(-60 -131)' }, g); // feet at the origin
  const breath = el('g', {}, body);
  const fill = z ? SUN : '#fff';
  const arms = {};
  const armPaths = z
    ? {
        down: [['M22 70 Q11 68 5 58', 'M5 58 L0.5 54 M5 58 L3 51.5 M5 58 L9 53', [22, 70]], ['M98 70 Q109 68 115 58', 'M115 58 L119.5 54 M115 58 L117 51.5 M115 58 L111 53', [98, 70]]],
        up: [['M22 66 Q10 58 7 44', 'M7 44 L3 38 M7 44 L8 37 M7 44 L12 39', [22, 66]], ['M98 66 Q110 58 113 44', 'M113 44 L117 38 M113 44 L112 37 M113 44 L108 39', [98, 66]]],
      }
    : {
        down: [['M24 82 Q12 88 12 100', null, [24, 82]], ['M96 82 Q108 88 108 100', null, [96, 82]]],
        up: [['M24 74 Q12 64 12 50', null, [24, 74]], ['M96 74 Q108 64 108 50', null, [96, 74]]],
      };
  for (const k of ['down', 'up']) {
    const set = el('g', {}, breath);
    arms[k] = { set, parts: armPaths[k].map(([d, fingers, pivot]) => {
      const a = el('g', {}, set);
      tube(a, d, fill, z ? 9 : 8);
      if (fingers) tube(a, fingers, fill, 4.4);
      return { a, pivot };
    }) };
  }
  if (z) {
    tube(breath, 'M42 113 L41 124', SUN, 11);
    tube(breath, 'M78 113 L79 124', SUN, 11);
    el('path', { d: ZBODY, fill: SUN, stroke: INK, 'stroke-width': SW, 'stroke-linejoin': 'round' }, breath);
    el('path', { d: 'M25 62 C25 50 30 42 38 38', fill: 'none', stroke: '#ffe08a', 'stroke-width': 3.4, 'stroke-linecap': 'round' }, breath);
  } else {
    const clip = 'sb' + uid++;
    el('clipPath', { id: clip }, el('defs', {}, breath)).appendChild(el('path', { d: SBODY }));
    tube(breath, 'M46 114 L45 123', '#fff', 8);
    tube(breath, 'M74 114 L75 123', '#fff', 8);
    el('path', { d: 'M33 128 C33 121 40 119 46 120 C52 121 54 126 52 129 Z', fill: SUN, stroke: INK, 'stroke-width': SW, 'stroke-linejoin': 'round' }, breath);
    el('path', { d: 'M87 128 C87 121 80 119 74 120 C68 121 66 126 68 129 Z', fill: SUN, stroke: INK, 'stroke-width': SW, 'stroke-linejoin': 'round' }, breath);
    el('path', { d: SBODY, fill: '#fff', stroke: INK, 'stroke-width': SW }, breath);
    el('ellipse', { cx: 104, cy: 98, rx: 34, ry: 40, fill: '#e9e5db', 'clip-path': `url(#${clip})` }, breath);
    el('path', { d: SBODY, fill: 'none', stroke: INK, 'stroke-width': SW }, breath);
    el('path', { d: 'M58 31 C52 21 58 11 66 14 C71 16 70 23 64 23', ...S() }, breath);
  }
  // Arms sit behind the body: move the arm sets to the back.
  for (const k of ['up', 'down']) breath.insertBefore(arms[k].set, breath.firstChild);
  const faces = {};
  for (const m of MOODS) {
    const f = el('g', {}, breath);
    faces[m] = { f, eyes: z ? zombieFace(f, m) : survivorFace(f, m) };
  }
  const eyeY = z ? 53 : 66;

  return {
    g,
    pose(t, { mood = 'idle', up, live = false, seed = 0 } = {}) {
      const raised = up ?? (mood === 'happy' || mood === 'scared');
      for (const m of MOODS) show(faces[m].f, m === mood);
      show(arms.up.set, raised);
      show(arms.down.set, !raised);
      const ph = seed * 1.37;
      // Breath: ±1.6 % height around the feet.
      const b = live ? 1 + 0.016 * Math.sin((t + ph) * 2.0) : 1;
      breath.setAttribute('transform', `translate(60 131) scale(${(2 - b).toFixed(4)} ${b.toFixed(4)}) translate(-60 -131)`);
      // Blink: shut for 0.12 s every 4.6 s, offset per character.
      const cyc = ((t + ph * 3.1) % 4.6 + 4.6) % 4.6;
      const shut = live && cyc > 4.42 && cyc < 4.54 ? 0.12 : 1;
      const eyes = faces[mood].eyes;
      eyes.setAttribute('transform', `translate(0 ${eyeY}) scale(1 ${shut}) translate(0 ${-eyeY})`);
      // Arm sway: ±7°, opposite on each side.
      const sw = live ? 7 * Math.sin((t + ph) * 3.9) : 0;
      const set = raised ? arms.up : arms.down;
      set.parts.forEach(({ a, pivot }, i) => a.setAttribute('transform', `rotate(${(i ? sw : -sw).toFixed(2)} ${pivot[0]} ${pivot[1]})`));
    },
  };
}
