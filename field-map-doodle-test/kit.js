// Field Map Doodle drawing kit: SVG helpers, easing, the tempo grid and sound events, the camera punch,
// and the recurring pieces (field map, phone, pills, sparkles, crosshair, tap ring).
// Everything that moves is a pure function of t (see render() in film.js).

export const W = 1080, H = 1920;
export const INK = '#141414', CREAM = '#eeebe3', SUN = '#ffc21a', SUN_SOFT = '#ffe7a3', GREY = '#e2ded4', WHITE = '#ffffff', RED = '#e8452c', DIM = '#6b665c';
export const FONT = "'Archivo Variable', 'Archivo', sans-serif";
const NS = 'http://www.w3.org/2000/svg';

// ---- DOM ------------------------------------------------------------------------------------------------
export function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
export function txt(parent, str, attrs = {}) {
  const e = el('text', { 'font-family': FONT, ...attrs }, parent);
  e.textContent = str;
  return e;
}
/** Display type: 125 % width, 900. */
export const DISPLAY = { 'font-weight': 900, style: 'font-stretch:125%' };
export function tf(e, x = 0, y = 0, s = 1, r = 0, sy) {
  e.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${r.toFixed(2)}) scale(${s.toFixed(4)} ${(sy ?? s).toFixed(4)})`);
}
export function op(e, o) { e.setAttribute('opacity', Math.max(0, Math.min(1, o)).toFixed(3)); }
export function show(e, v) { e.style.display = v ? '' : 'none'; }

// ---- time ---------------------------------------------------------------------------------------------
export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const seg = (t, a, b) => clamp((t - a) / (b - a));
export const lerp = (a, b, p) => a + (b - a) * p;
export const E = {
  out: (p) => 1 - Math.pow(1 - p, 3),
  in: (p) => p * p * p,
  io: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  back: (p) => { const c = 1.7; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); },
};
/** 0 before t0, then a back-eased 0 → 1 over d. */
export const pop = (t, t0, d = 0.32) => (t < t0 ? 0 : E.back(seg(t, t0, t0 + d)));
/** Damped wobble after t0 (a landing or a hit): 0 before, ~amt peak, settles in ~0.35 s. */
export const squash = (t, t0, amt = 0.12) => (t < t0 ? 0 : amt * Math.exp(-(t - t0) * 9) * Math.cos((t - t0) * 30));

// The tempo grid: one BPM for the film. at(bar, beat) is the time of a beat; everything lands on it.
export const BPM = 118;
export const BEAT = 60 / BPM, BAR = BEAT * 4;
export const at = (bar, beat = 0) => +(bar * BAR + beat * BEAT).toFixed(4);

// Sound events for the score (exported by events.mjs as window.EV).
export const EV = [];
export const ev = (t, type, o = {}) => { EV.push({ t: +t.toFixed(4), type, ...o }); return t; };

// Camera punches: a short zoom kick around the centre on a hit.
const PUNCH = [];
export const punch = (t, amt = 0.02) => { PUNCH.push([t, amt]); return t; };
export const punchAt = (t) => PUNCH.reduce((s, [t0, a]) => (t >= t0 ? s + a * Math.exp(-(t - t0) * 14) : s), 0);

// ---- pieces ---------------------------------------------------------------------------------------------
/** The cream field map: contour lines tiled from topo.svg, drifting with `shift`. */
export function fieldMap(parent, { fill = CREAM, id = 'topo' + Math.random().toString(36).slice(2, 7) } = {}) {
  const defs = el('defs', {}, parent);
  const pat = el('pattern', { id, width: 560, height: 560, patternUnits: 'userSpaceOnUse' }, defs);
  el('image', { href: 'topo.svg', width: 560, height: 560 }, pat);
  const g = el('g', {}, parent);
  el('rect', { x: -200, y: -200, width: W + 400, height: H + 400, fill }, g);
  const lines = el('rect', { x: -800, y: -800, width: W + 1600, height: H + 1600, fill: `url(#${id})` }, g);
  return { g, move: (dx, dy) => tf(lines, ((dx % 560) + 560) % 560 - 560, ((dy % 560) + 560) % 560 - 560) };
}

/** A phone: ink bezel, white screen, a notch. Returns the screen group (0,0 = screen top-left). */
export function phone(parent, { w = 700, h = 1420, r = 92 } = {}) {
  const g = el('g', {}, parent);
  el('rect', { x: -w / 2 + 14, y: -h / 2 + 18, width: w, height: h, rx: r, fill: INK, opacity: 0.16 }, g); // hard shadow
  el('rect', { x: -w / 2, y: -h / 2, width: w, height: h, rx: r, fill: INK }, g);
  const sw = w - 36, sh = h - 36;
  const clip = 'scr' + Math.random().toString(36).slice(2, 7);
  el('clipPath', { id: clip }, el('defs', {}, g)).appendChild(el('rect', { width: sw, height: sh, rx: r - 18 }));
  const screen = el('g', { transform: `translate(${-sw / 2} ${-sh / 2})` }, g);
  const inner = el('g', { 'clip-path': `url(#${clip})` }, screen);
  el('rect', { width: sw, height: sh, fill: CREAM }, inner);
  const content = el('g', {}, inner);
  el('rect', { x: sw / 2 - 90, y: 22, width: 180, height: 44, rx: 22, fill: INK }, screen); // notch
  return { g, screen: content, sw, sh };
}

/** A pill button: 'black' (primary), 'white' (ink border), 'yellow' (sticker). */
export function pill(parent, label, { x = 0, y = 0, w = 560, h = 108, kind = 'black', size = 40, arrow = true, align = 'between' } = {}) {
  const g = el('g', { transform: `translate(${x} ${y})` }, parent);
  const fill = kind === 'black' ? INK : kind === 'yellow' ? SUN : WHITE;
  const ink = kind === 'black' ? WHITE : INK;
  el('rect', { x: -w / 2, y: -h / 2, width: w, height: h, rx: h / 2, fill, stroke: INK, 'stroke-width': kind === 'black' ? 0 : 5 }, g);
  const left = align === 'between' ? -w / 2 + h * 0.48 : 0;
  txt(g, label, { x: left, y: size * 0.36, 'font-size': size, 'font-weight': 800, fill: ink, 'text-anchor': align === 'between' ? 'start' : 'middle' });
  if (arrow) {
    const ax = w / 2 - h * 0.5;
    el('path', { d: `M${ax - 18} 0 H${ax + 16} M${ax + 4} -13 L${ax + 17} 0 L${ax + 4} 13`, fill: 'none', stroke: ink, 'stroke-width': 6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
  }
  return g;
}

/** Four-point doodle sparkle with an ink outline. */
export function sparkle(parent, { x = 0, y = 0, s = 30, fill = WHITE } = {}) {
  const g = el('g', { transform: `translate(${x} ${y})` }, parent);
  const k = s / 10;
  el('path', { d: `M0 ${-10 * k} C${1 * k} ${-2.5 * k} ${2.5 * k} ${-1 * k} ${10 * k} 0 C${2.5 * k} ${1 * k} ${1 * k} ${2.5 * k} 0 ${10 * k} C${-1 * k} ${2.5 * k} ${-2.5 * k} ${1 * k} ${-10 * k} 0 C${-2.5 * k} ${-1 * k} ${-1 * k} ${-2.5 * k} 0 ${-10 * k} Z`, fill, stroke: INK, 'stroke-width': 3.2, 'stroke-linejoin': 'round' }, g);
  return g;
}

/** The crosshair: ring, four ticks, centre dot. r = ring radius; lw = line weight. */
export function crosshair(parent, { r = 40, lw = 9, color = INK, dot = true } = {}) {
  const g = el('g', {}, parent);
  el('circle', { r, fill: 'none', stroke: color, 'stroke-width': lw }, g);
  const a = r * 1.6, b = r * 0.58;
  el('path', { d: `M0 ${-a} V${-b} M0 ${b} V${a} M${-a} 0 H${-b} M${b} 0 H${a}`, stroke: color, 'stroke-width': lw, 'stroke-linecap': 'round' }, g);
  if (dot) el('circle', { r: lw * 0.75, fill: color }, g);
  return g;
}

/** The wordmark ZOMBIES with the O as a crosshair. Returns {g, o} (o = the crosshair group, for the lock-on). */
export function wordmark(parent, { size = 120, x = 0, y = 0 } = {}) {
  const g = el('g', { transform: `translate(${x} ${y})` }, parent);
  const inner = el('g', {}, g);
  // Same geometry as the app's wordmark: the O is a 0.8 em crosshair in a 0.86 em slot. Glyphs are measured
  // after the font loads (build() runs after document.fonts.ready).
  const zT = txt(inner, 'Z', { y: size * 0.36, 'font-size': size, ...DISPLAY, fill: INK });
  const rT = txt(inner, 'MBIES', { y: size * 0.36, 'font-size': size, ...DISPLAY, fill: INK });
  const z = zT.getComputedTextLength(), rest = rT.getComputedTextLength(), o = 0.86 * size;
  const total = z + o + rest;
  zT.setAttribute('x', (-total / 2).toFixed(1));
  rT.setAttribute('x', (-total / 2 + z + o).toFixed(1));
  const og = el('g', {}, inner);
  tf(og, -total / 2 + z + o / 2, 0);
  const cross = crosshair(og, { r: 0.24 * size, lw: 0.087 * size });
  // ox: the O's centre relative to the wordmark's centre (the iris closes onto it).
  return { g, o: cross, og, zT, rT, total, ox: -total / 2 + z + o / 2, ring: 0.24 * size, lw: 0.087 * size };
}

/** The user's tap: an ink ring that shrinks onto the point and presses. */
export function tapRing(parent) {
  const g = el('g', {}, parent);
  const ring = el('circle', { r: 46, fill: 'none', stroke: INK, 'stroke-width': 7 }, g);
  const dot = el('circle', { r: 16, fill: SUN, stroke: INK, 'stroke-width': 4 }, g);
  return {
    g,
    /** Show a tap landing at time t0 at (x, y): ring closes in ~0.18 s, dot holds, both gone by +0.5 s. */
    at(t, t0, x, y) {
      if (t < t0 - 0.2 || t > t0 + 0.5) return show(g, false);
      show(g, true);
      tf(g, x, y);
      const p = seg(t, t0 - 0.2, t0);
      ring.setAttribute('r', lerp(70, 30, E.out(p)).toFixed(1));
      op(ring, t < t0 ? p : 1 - seg(t, t0, t0 + 0.3));
      op(dot, t < t0 ? 0 : 1 - seg(t, t0 + 0.2, t0 + 0.5));
    },
  };
}

/** A white card with rounded corners (an app card), optional ink border. */
export function card(parent, { x = 0, y = 0, w = 600, h = 400, r = 56, fill = WHITE, border = 0 } = {}) {
  return el('rect', { x, y, width: w, height: h, rx: r, fill, stroke: INK, 'stroke-width': border }, parent);
}

/** Keyframes: kf(u, [[p, v], …], ease) interpolates v between the surrounding p (0–1), easing each span. */
export function kf(u, keys, ease = (x) => x) {
  if (u <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [p1, v1] = keys[i], [p0, v0] = keys[i - 1];
    if (u <= p1) return lerp(v0, v1, ease(seg(u, p0, p1)));
  }
  return keys[keys.length - 1][1];
}

/** Text width in px for layout (fonts must be loaded first). */
const mctx = document.createElement('canvas').getContext('2d');
/** Size a centred pill to its label (call once the label is in the DOM): the padding is the pill's own radius. */
export function fitPill(rect, label, cx = 0) {
  const r = +rect.getAttribute('height') / 2, w = label.getComputedTextLength() + 2 * r;
  rect.setAttribute('x', cx - w / 2);
  rect.setAttribute('width', w);
}
export function measure(str, size, weight = 800, stretch = '100%') {
  mctx.font = `${weight} ${stretch === '100%' ? '' : 'ultra-expanded '}${size}px 'Archivo Variable'`;
  return mctx.measureText(str).width;
}
