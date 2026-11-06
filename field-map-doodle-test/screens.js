// The app's screens, redrawn in vector from the real components (apps/web/src/pages/Welcome.tsx, Home.tsx,
// components/Scenes.tsx). Each screen is laid out in the app's own points (390 wide) and scaled to the phone
// screen, so sizes, copy and spacing match the product. Animated parts are functions of time.
import { el, txt, tf, op, show, seg, lerp, E, kf, pop, wordmark, pill, fitPill, crosshair, sparkle, INK, CREAM, SUN, SUN_SOFT, WHITE, GREY, DIM, DISPLAY } from './kit.js';
import { character } from './cast.js';
import { QR_PATH } from './qr.js';

export const APP_W = 390;

/** A screen root scaled from app points to the phone screen width `sw`. */
export function screenRoot(parent, sw) {
  const g = el('g', {}, parent);
  tf(g, 0, 0, sw / APP_W);
  return g;
}

function lines(p, ls, { x, y, size = 16, lh = 22, fill = 'rgba(20,20,20,.7)', weight = 600, anchor = 'start' }) {
  return ls.map((l, i) => txt(p, l, { x, y: y + i * lh, 'font-size': size, 'font-weight': weight, fill, 'text-anchor': anchor }));
}

/** Contour-line fill for an app card (the app's bg-[url(/topo.svg)] at 420 px). */
let tid = 0;
function topoRect(p, { x = 0, y = 0, w, h, r = 32, fill }) {
  const id = 'tp' + tid++;
  const pat = el('pattern', { id, width: 420, height: 420, patternUnits: 'userSpaceOnUse', x, y }, el('defs', {}, p));
  el('image', { href: 'topo.svg', width: 420, height: 420 }, pat);
  el('rect', { x, y, width: w, height: h, rx: r, fill }, p);
  el('rect', { x, y, width: w, height: h, rx: r, fill: `url(#${id})` }, p);
}

function iconUser(p, x, y, c = WHITE) {
  const g = el('g', { transform: `translate(${x} ${y})`, fill: 'none', stroke: c, 'stroke-width': 2.4, 'stroke-linecap': 'round' }, p);
  el('circle', { cx: 0, cy: -4, r: 4.5 }, g);
  el('path', { d: 'M-8 9 C-8 3 -4 1 0 1 C4 1 8 3 8 9' }, g);
}
function iconMail(p, x, y, c = INK) {
  const g = el('g', { transform: `translate(${x} ${y})`, fill: 'none', stroke: c, 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, p);
  el('rect', { x: -10, y: -8, width: 20, height: 16, rx: 2.5 }, g);
  el('path', { d: 'M-10 -6 L0 2 L10 -6' }, g);
}
function iconGrid(p, x, y) {
  const g = el('g', { transform: `translate(${x} ${y})`, fill: 'none', stroke: INK, 'stroke-width': 2.4 }, p);
  for (const [a, b] of [[-8, -8], [1, -8], [-8, 1], [1, 1]]) el('rect', { x: a, y: b, width: 7, height: 7, rx: 1.5 }, g);
}
function iconArrow(p, x, y, c = INK, s = 1) {
  el('path', { d: `M${x - 8 * s} ${y} H${x + 8 * s} M${x + 2 * s} ${y - 6 * s} L${x + 8 * s} ${y} L${x + 2 * s} ${y + 6 * s}`, fill: 'none', stroke: c, 'stroke-width': 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, p);
}

/** A field: white, 2 px ink at 15 %, 16 r. */
function field(p, { x, y, w, h = 52, value = '', placeholder = '' }) {
  el('rect', { x, y, width: w, height: h, rx: 16, fill: WHITE, stroke: 'rgba(20,20,20,.15)', 'stroke-width': 2 }, p);
  const ph = txt(p, placeholder, { x: x + 16, y: y + h / 2 + 6, 'font-size': 16, 'font-weight': 500, fill: 'rgba(107,102,92,.6)' });
  const v = txt(p, value, { x: x + 16, y: y + h / 2 + 6, 'font-size': 16, 'font-weight': 600, fill: INK });
  const caret = el('rect', { x: x + 16, y: y + 14, width: 2, height: h - 28, fill: INK }, p);
  return { v, ph, caret, x: x + 16 };
}

// ---- splash (Welcome.tsx Splash) ---------------------------------------------------------------------------
/** Yellow terrain, the wordmark (its O locks on), the pill, both characters rising in. start = when it shows. */
export function splash(parent, sw, sh) {
  const H = sh / (sw / APP_W);
  const g = screenRoot(parent, sw);
  topoRect(g, { w: APP_W, h: H, r: 0, fill: SUN });
  const sp = [sparkle(g, { x: 62, y: H * 0.2, s: 13, fill: WHITE }), sparkle(g, { x: 320, y: H * 0.28, s: 8, fill: WHITE })];
  const top = (H - 300) / 2;
  const wm = wordmark(g, { size: 54.6, x: APP_W / 2, y: top + 28 });
  const pillG = el('g', {}, g);
  const label = 'OUTDOOR TAG · KOCHI';
  const pillR = el('rect', { y: top + 70, height: 30, rx: 15, fill: WHITE }, pillG);
  const pillT = txt(pillG, label, { x: APP_W / 2, y: top + 90, 'font-size': 13, ...DISPLAY, fill: INK, 'text-anchor': 'middle' });
  fitPill(pillR, pillT, APP_W / 2);
  const surv = character(g, 'survivor');
  const zom = character(g, 'zombie');
  const rise = (e, t, t0, x, y, s) => {
    const p = seg(t, t0, t0 + 0.36);
    op(e, p);
    tf(e, x, y + 24 * (1 - E.out(p)), s);
  };
  return {
    g,
    texts: [{ id: 'splash-wm', el: wm.g, text: 'ZOMBIES' }, { id: 'splash-pill', el: pillT, text: label }],
    update(t, start) {
      const u = t - start;
      // The O swings in and locks (rotate −90°, scale 1.3 → 1 over 0.52 s, after 0.12 s).
      const p = seg(u, 0.12, 0.64);
      tf(wm.og, wm.ox, 0, lerp(1.3, 1, E.out(p)), lerp(-90, 0, E.out(p)));
      op(wm.og, p);
      const pp = seg(u, 0.42, 0.78);
      op(pillG, pp);
      tf(pillG, 0, 24 * (1 - E.out(pp)));
      rise(surv.g, t, start + 0.56, 140, top + 296, 118 / 128);
      rise(zom.g, t, start + 0.64, 252, top + 296, 156 / 128);
      surv.pose(t, { mood: 'scared', live: true, seed: 4 });
      zom.pose(t, { mood: 'happy', live: true, seed: 5 });
      sp.forEach((s, i) => op(s, seg(u, 0.7 + i * 0.12, 1.06 + i * 0.12)));
    },
  };
}

// ---- tour (Welcome.tsx Tour + components/Scenes.tsx) -------------------------------------------------------
const TOUR = [
  { title: 'Pick a side', body: ['Join as a zombie or a survivor. Everyone', 'wears a QR code on their back.'] },
  { title: 'Watch your radar', body: ['No map, no names. Just who’s within 10 m of', 'you, and which team they’re on.'] },
  { title: 'Scan to infect', body: ['Zombies hold their camera on a survivor’s', 'back QR. Survivors run, so the scan breaks.'] },
];
const CW = 358, CH = 460; // the illustration card, in app points

function burst(p) {
  const pts = Array.from({ length: 24 }, (_, i) => {
    const r = i % 2 ? 34 : 48, a = (i / 24) * Math.PI * 2;
    return `${(Math.sin(a) * r).toFixed(1)},${(-Math.cos(a) * r).toFixed(1)}`;
  }).join(' ');
  const g = el('g', {}, p);
  const inner = el('g', {}, g);
  el('polygon', { points: pts, fill: WHITE, stroke: INK, 'stroke-width': 3.4, 'stroke-linejoin': 'round' }, inner);
  txt(inner, 'VS', { y: 9, 'font-size': 27, ...DISPLAY, fill: INK, 'text-anchor': 'middle' });
  return { g, inner };
}

function sceneTeams(p) {
  topoRect(p, { w: CW, h: CH, fill: SUN });
  const z = character(p, 'zombie'), s = character(p, 'survivor');
  const b = burst(p);
  return (u) => {
    tf(z.g, 92 + 10 * kf((u % 2.2) / 2.2, [[0, 0], [0.45, 1], [1, 0]], E.io), 457, 176 / 128);
    z.pose(u, { mood: 'happy', live: true, seed: 6 });
    tf(s.g, 281, 445 - 132 * 0.03 * kf((u % 3.2) / 3.2, [[0, 0], [0.5, 1], [1, 0]], E.io), 132 / 128);
    s.pose(u, { mood: 'scared', live: true, seed: 7 });
    const k = (u % 1.4) / 1.4;
    tf(b.g, 179, 135, kf(k, [[0, 1], [0.5, 1.08], [1, 1]], E.io), kf(k, [[0, -4], [0.5, 3], [1, -4]], E.io));
  };
}

function sceneRadar(p) {
  el('rect', { width: CW, height: CH, rx: 32, fill: WHITE }, p);
  const g = el('g', { transform: `translate(179 230) scale(${(Math.min(CW, CH) * 0.92) / 224})` }, p);
  const R = 92;
  for (const a of [0, 90, 180, 270]) {
    const sn = Math.sin((a * Math.PI) / 180), cs = Math.cos((a * Math.PI) / 180);
    el('line', { x1: (R + 4) * sn, y1: -(R + 4) * cs, x2: (R + 15) * sn, y2: -(R + 15) * cs, stroke: INK, 'stroke-width': 3.4, 'stroke-linecap': 'round' }, g);
  }
  el('circle', { r: R, fill: '#f7f5f0', stroke: INK, 'stroke-width': 3.4 }, g);
  for (const f of [0.33, 0.66]) el('circle', { r: R * f, fill: 'none', stroke: INK, 'stroke-opacity': 0.16, 'stroke-width': 1.4, 'stroke-dasharray': '3 4' }, g);
  const ping = el('circle', { r: R, fill: 'none', stroke: SUN, 'stroke-width': 3 }, g);
  const dot = el('g', {}, g);
  const lock = el('g', { stroke: INK, 'stroke-width': 2.4, 'stroke-linecap': 'round', fill: 'none' }, dot);
  el('circle', { r: 13 }, lock);
  el('path', { d: 'M0 -19 V-15 M0 15 V19 M-19 0 H-15 M15 0 H19' }, lock);
  el('circle', { r: 6.6, fill: SUN, stroke: INK, 'stroke-width': 2.4 }, dot);
  const calm = el('g', {}, g), alarm = el('g', {}, g);
  const sc = character(calm, 'survivor'), sa = character(alarm, 'survivor');
  tf(sc.g, 0, 19, 42 / 128);
  tf(sa.g, 0, 19, 42 / 128);
  return (u) => {
    const k = (u % 4) / 4;
    const pk = (u % 2.4) / 2.4;
    ping.setAttribute('transform', `scale(${lerp(0.08, 1, E.out(pk)).toFixed(3)})`);
    op(ping, lerp(0.55, 0, E.out(pk)));
    const x = kf(k, [[0, 66], [0.5, 36], [0.78, 36], [1, 66]], E.io), y = kf(k, [[0, -60], [0.5, -30], [0.78, -30], [1, -60]], E.io);
    tf(dot, x, y);
    const lp = kf(k, [[0, 0], [0.44, 0], [0.52, 1], [0.8, 1], [0.88, 0], [1, 0]]);
    tf(lock, 0, 0, lerp(1.6, 1, lp), lerp(45, 0, lp));
    op(lock, lp);
    const al = kf(k, [[0, 0], [0.46, 0], [0.5, 1], [0.8, 1], [0.84, 0], [1, 0]]);
    op(alarm, al);
    op(calm, 1 - al);
    sc.pose(u, { mood: 'idle' });
    sa.pose(u, { mood: 'scared' });
  };
}

function sceneScan(p) {
  topoRect(p, { w: CW, h: CH, fill: GREY });
  const tag = el('g', { transform: 'translate(179 202) rotate(-3)' }, p);
  el('rect', { x: -63, y: -63, width: 126, height: 126, rx: 16, fill: WHITE, stroke: INK, 'stroke-width': 3 }, tag);
  el('path', { d: QR_PATH, transform: 'translate(-52 -52) scale(4.952)', stroke: INK, fill: 'none', 'stroke-width': 1 }, tag);
  const k = 200 / 192, r = 70 * k, C = 2 * Math.PI * r;
  const rg = el('g', { transform: 'translate(179 202)' }, p);
  el('circle', { r, fill: 'none', stroke: INK, 'stroke-opacity': 0.18, 'stroke-width': 9 * k }, rg);
  const fill = el('circle', { r, fill: 'none', stroke: SUN, 'stroke-width': 9 * k, 'stroke-linecap': 'round', 'stroke-dasharray': C.toFixed(1), transform: 'rotate(-90)' }, rg);
  el('path', { d: `M0 ${-94 * k} V${-80 * k} M0 ${80 * k} V${94 * k} M${-94 * k} 0 H${-80 * k} M${80 * k} 0 H${94 * k}`, stroke: INK, 'stroke-width': 5 * k, 'stroke-linecap': 'round' }, rg);
  const z = character(p, 'zombie');
  const before = el('g', {}, p), after = el('g', {}, p);
  const sb = character(before, 'survivor'), za = character(after, 'zombie');
  const plus = el('g', { transform: 'translate(257 86)' }, p);
  const plusIn = el('g', {}, plus);
  el('circle', { r: 22, fill: SUN, stroke: INK, 'stroke-width': 2 }, plusIn);
  txt(plusIn, '+1', { y: 6, 'font-size': 16, ...DISPLAY, fill: INK, 'text-anchor': 'middle' });
  return (u) => {
    const kk = (u % 4.5) / 4.5;
    fill.setAttribute('stroke-dashoffset', (C * (1 - kf(kk, [[0, 0], [0.66, 1], [1, 1]]))).toFixed(1));
    tf(z.g, 52, 459, 112 / 128);
    z.pose(u, { mood: 'happy', live: true, seed: 8 });
    op(before, kf(kk, [[0, 1], [0.66, 1], [0.7, 0], [0.96, 0], [1, 1]]));
    tf(sb.g, 303, 445, 86 / 128);
    sb.pose(u, { mood: 'scared' });
    const a = kf(kk, [[0, 0], [0.66, 0], [0.72, 1], [0.96, 1], [1, 0]]);
    op(after, a);
    tf(za.g, 303, 445, (86 / 128) * kf(kk, [[0, 0.9], [0.66, 0.9], [0.72, 1.06], [0.78, 1], [1, 1]], E.out));
    za.pose(u, { mood: 'idle' });
    const pl = kf(kk, [[0, 0], [0.68, 0], [0.74, 1], [0.92, 1], [1, 0]], E.out);
    op(plusIn, pl);
    tf(plusIn, 0, 8 * (1 - pl), lerp(0.9, 1, pl));
  };
}

/** The tour: header, a track of three cards (slides at each tap), page dots, the Next button. */
export function tour(parent, sw, sh) {
  const Hp = sh / (sw / APP_W);
  const g = screenRoot(parent, sw);
  el('rect', { width: APP_W, height: Hp, fill: CREAM }, g);
  txt(g, 'kalikkam', { x: 16, y: 40, 'font-size': 18, ...DISPLAY, fill: INK });
  el('rect', { x: APP_W - 16 - 62, y: 18, width: 62, height: 36, rx: 18, fill: WHITE, stroke: INK, 'stroke-width': 2 }, g);
  txt(g, 'Skip', { x: APP_W - 16 - 31, y: 41, 'font-size': 14, 'font-weight': 700, fill: INK, 'text-anchor': 'middle' });
  const clipId = 'trk' + tid++;
  el('clipPath', { id: clipId }, el('defs', {}, g)).appendChild(el('rect', { x: 0, y: 60, width: APP_W, height: Hp - 150 }));
  const track = el('g', { 'clip-path': `url(#${clipId})` }, g);
  const inner = el('g', {}, track);
  const scenes = [sceneTeams, sceneRadar, sceneScan];
  const cards = TOUR.map((c, i) => {
    const cg = el('g', { transform: `translate(${i * APP_W} 0)` }, inner);
    const ill = el('g', { transform: 'translate(16 70)' }, cg);
    const clip = 'ill' + tid++;
    el('clipPath', { id: clip }, el('defs', {}, ill)).appendChild(el('rect', { width: CW, height: CH, rx: 32 }));
    const sceneG = el('g', { 'clip-path': `url(#${clip})` }, ill);
    const update = scenes[i](sceneG);
    const title = txt(cg, c.title, { x: 16, y: 70 + CH + 56, 'font-size': 34, ...DISPLAY, fill: INK });
    lines(cg, c.body, { x: 16, y: 70 + CH + 88, size: 16.5, lh: 23 });
    return { update, title, text: c.title };
  });
  const dots = [0, 1, 2].map((i) => el('rect', { y: Hp - 52, height: 8, rx: 4, fill: INK }, g));
  const btn = el('g', {}, g);
  const btnBg = el('rect', { y: Hp - 82, height: 52, rx: 26, fill: INK }, btn);
  const btnT = txt(btn, 'Next', { y: Hp - 50, 'font-size': 18, 'font-weight': 800, fill: WHITE });
  const arrow = el('g', {}, btn);
  iconArrow(arrow, 0, 0, WHITE);
  return {
    g,
    cards,
    /** taps: times the card changes (index 1 at taps[0], 2 at taps[1]); slide 0.32 s ease-out like the app. */
    update(t, start, taps) {
      let x = 0;
      taps.forEach((tp, i) => { x = lerp(x, -(i + 1) * APP_W, E.out(seg(t, tp, tp + 0.32))); });
      inner.setAttribute('transform', `translate(${x.toFixed(2)} 0)`);
      const idx = taps.filter((tp) => t >= tp).length;
      cards.forEach((c, i) => c.update(Math.max(0, t - (i === 0 ? start : taps[i - 1] ?? start))));
      let dx = 16;
      dots.forEach((d, i) => {
        const w = i === idx ? 28 : 8;
        d.setAttribute('x', dx);
        d.setAttribute('width', w);
        d.setAttribute('fill', i === idx ? SUN : INK);
        d.setAttribute('stroke', i === idx ? INK : 'none');
        d.setAttribute('stroke-width', 2);
        dx += w + 6;
      });
      const last = idx >= 2;
      btnT.textContent = last ? 'Let’s play' : 'Next';
      const bw = last ? 158 : 118;
      btnBg.setAttribute('x', APP_W - 16 - bw);
      btnBg.setAttribute('width', bw);
      btnT.setAttribute('x', APP_W - 16 - bw + 28);
      tf(arrow, APP_W - 16 - 34, Hp - 56);
    },
    /** Screen-space centre of the Next / Let's play button (screen pixels). */
    btnAt: (last) => [(APP_W - 16 - (last ? 79 : 59)) * (sw / APP_W), (Hp - 56) * (sw / APP_W)],
  };
}

// ---- sign in (Welcome.tsx SignIn) --------------------------------------------------------------------------
/** "Join the hunt". Handles: name typing, the guest and email buttons, the peeking zombie. */
export function signIn(parent, sw) {
  const g = screenRoot(parent, sw);
  el('rect', { width: APP_W, height: 2000, fill: CREAM }, g);
  wordmark(g, { size: 34, x: APP_W / 2, y: 64 });
  const cardY = 204, cx = 16, cw = 358;
  const zombie = character(g, 'zombie');
  tf(zombie.g, 293, cardY + 23, 130 / 128); // where the app puts it: -top-[104px] right-4, size 130
  el('rect', { x: cx, y: cardY, width: cw, height: 404, rx: 28, fill: WHITE }, g);
  const title = txt(g, 'Join the hunt', { x: cx + 20, y: cardY + 52, 'font-size': 34, ...DISPLAY, fill: INK });
  lines(g, ['Play right away as a guest, or use your', 'email to keep your XP on any phone.'], { x: cx + 20, y: cardY + 82, size: 15, lh: 21 });
  txt(g, 'Your name', { x: cx + 20, y: cardY + 148, 'font-size': 14, 'font-weight': 700, fill: DIM });
  const name = field(g, { x: cx + 20, y: cardY + 160, w: cw - 40, placeholder: 'What should we call you?' });
  const guest = el('g', {}, g);
  const guestBtn = pill(guest, 'Play as guest', { x: APP_W / 2, y: cardY + 252, w: cw - 40, h: 56, size: 18, arrow: false });
  iconUser(guestBtn, (cw - 40) / 2 - 30, 0);
  txt(g, 'Your XP stays on this phone.', { x: APP_W / 2, y: cardY + 296, 'font-size': 12, 'font-weight': 600, fill: DIM, 'text-anchor': 'middle' });
  el('rect', { x: cx + 20, y: cardY + 322, width: 140, height: 2, rx: 1, fill: '#d5d0c4' }, g);
  el('rect', { x: cx + cw - 160, y: cardY + 322, width: 140, height: 2, rx: 1, fill: '#d5d0c4' }, g);
  txt(g, 'or', { x: APP_W / 2, y: cardY + 328, 'font-size': 14, 'font-weight': 700, fill: DIM, 'text-anchor': 'middle' });
  const email = el('g', {}, g);
  const emailBtn = pill(email, 'Continue with email', { x: APP_W / 2, y: cardY + 366, w: cw - 40, h: 54, size: 18, kind: 'white', arrow: false });
  iconMail(emailBtn, (cw - 40) / 2 - 30, 0);
  lines(g, ['Got a game code? Join a game'], { x: APP_W / 2, y: 760, size: 14, fill: DIM, weight: 600, anchor: 'middle' });
  const scale = sw / APP_W;
  return {
    g,
    zombie,
    texts: [{ id: 'signin-title', el: title, text: 'Join the hunt' }],
    /** Show `str` in the name field with a caret blinking on half-seconds. */
    type(str, t) {
      name.v.textContent = str;
      show(name.ph, !str);
      const w = str ? name.v.getComputedTextLength() : 0;
      name.caret.setAttribute('x', (name.x + w + 1).toFixed(1));
      op(name.caret, Math.floor(t * 2) % 2 ? 0 : 1);
    },
    guest,
    /** Press feedback: the app's button press scale (0.97) around its centre. */
    press(e, t, t0) {
      const k = t >= t0 && t < t0 + 0.14 ? 0.97 : 1;
      e.setAttribute('transform', `translate(${APP_W / 2} ${cardY + 252}) scale(${k}) translate(${-APP_W / 2} ${-(cardY + 252)})`);
    },
    guestAt: [(APP_W / 2 + 92) * scale, (cardY + 252) * scale],
    fieldAt: [(APP_W / 2) * scale, (cardY + 186) * scale],
  };
}

// ---- home (Home.tsx) -----------------------------------------------------------------------------------------
/** Home after signing in: header, the yellow hero with the code bar, Play cards, the tab bar, the toast. */
export function home(parent, sw, sh) {
  const Hp = sh / (sw / APP_W);
  const root = screenRoot(parent, sw);
  el('rect', { width: APP_W, height: Hp, fill: CREAM }, root);
  // The app pads the page by the safe-area inset, so everything sits below the notch.
  const g = el('g', { transform: 'translate(0 30)' }, root);
  el('circle', { cx: 40, cy: 44, r: 24, fill: WHITE }, g);
  iconGrid(g, 40, 44);
  txt(g, 'kalikkam', { x: APP_W / 2, y: 50, 'font-size': 18, ...DISPLAY, fill: INK, 'text-anchor': 'middle' });
  el('circle', { cx: APP_W - 40, cy: 44, r: 24, fill: INK }, g);
  const ch = el('g', { transform: `translate(${APP_W - 40} 44) scale(0.5)` }, g);
  crosshair(ch, { r: 14, lw: 5, color: WHITE });
  // Hero
  topoRect(g, { x: 16, y: 84, w: APP_W - 32, h: 404, r: 32, fill: SUN });
  wordmark(g, { size: 48.75, x: APP_W / 2, y: 134 });
  fitPill(el('rect', { y: 160, height: 30, rx: 15, fill: WHITE }, g),
    txt(g, 'KOCHI · OUTDOOR TAG', { x: APP_W / 2, y: 180, 'font-size': 13, ...DISPLAY, fill: INK, 'text-anchor': 'middle' }), APP_W / 2);
  sparkle(g, { x: 56, y: 222, s: 13, fill: WHITE });
  sparkle(g, { x: 334, y: 212, s: 8, fill: WHITE });
  const s1 = character(g, 'survivor'), s2 = character(g, 'survivor'), z = character(g, 'zombie');
  // Code bar
  el('rect', { x: 32, y: 408, width: APP_W - 64, height: 62, rx: 31, fill: WHITE, stroke: INK, 'stroke-width': 2 }, g);
  txt(g, 'CODE', { x: 132, y: 448, 'font-size': 24, 'font-weight': 800, fill: 'rgba(107,102,92,.45)', 'text-anchor': 'middle', style: 'letter-spacing:7px' });
  el('rect', { x: APP_W - 32 - 6 - 112, y: 414, width: 112, height: 50, rx: 25, fill: GREY }, g);
  txt(g, 'Join', { x: APP_W - 32 - 6 - 74, y: 445, 'font-size': 16, 'font-weight': 800, fill: DIM, 'text-anchor': 'middle' });
  iconArrow(g, APP_W - 32 - 6 - 36, 439, DIM, 0.8);
  // Play
  txt(g, 'Play', { x: 16, y: 540, 'font-size': 30, ...DISPLAY, fill: INK });
  el('rect', { x: 16, y: 590, width: 296, height: 188, rx: 28, fill: GREY }, g);
  txt(g, 'Host a', { x: 36, y: 628, 'font-size': 22, ...DISPLAY, fill: INK });
  txt(g, 'game', { x: 36, y: 652, 'font-size': 22, ...DISPLAY, fill: INK });
  const hz = character(g, 'zombie');
  tf(hz.g, 248, 640, 124 / 128);
  el('rect', { x: 36, y: 714, width: 256, height: 48, rx: 24, fill: WHITE, stroke: INK, 'stroke-width': 2 }, g);
  txt(g, 'Start', { x: 58, y: 744, 'font-size': 16, 'font-weight': 800, fill: INK });
  iconArrow(g, 268, 738, INK, 0.8);
  el('rect', { x: 324, y: 590, width: 296, height: 188, rx: 28, fill: WHITE }, g);
  // Tab bar (fixed to the bottom, not padded)
  el('rect', { x: 0, y: Hp - 66, width: APP_W, height: 66, fill: WHITE }, root);
  el('rect', { x: 0, y: Hp - 66, width: APP_W, height: 1, fill: '#d5d0c4' }, root);
  ['Play', 'Events', 'Kit', 'Me'].forEach((l, i) => {
    const cx = (APP_W / 4) * (i + 0.5);
    if (i === 0) el('rect', { x: cx - 28, y: Hp - 58, width: 56, height: 32, rx: 16, fill: SUN }, root);
    el('rect', { x: cx - 9, y: Hp - 51, width: 18, height: 16, rx: 4, fill: 'none', stroke: i === 0 ? INK : DIM, 'stroke-width': 2.2 }, root);
    txt(root, l, { x: cx, y: Hp - 12, 'font-size': 11, 'font-weight': 700, fill: i === 0 ? INK : DIM, 'text-anchor': 'middle' });
  });
  // Toast (Sonner, success: soft yellow, ink border), below the notch like the app's safe-area offset.
  const toast = el('g', {}, root);
  el('rect', { x: 16, y: 46, width: APP_W - 32, height: 54, rx: 20, fill: SUN_SOFT, stroke: INK, 'stroke-width': 2 }, toast);
  el('circle', { cx: 44, cy: 73, r: 10, fill: INK }, toast);
  el('path', { d: 'M39 73 L43 77 L49.5 69.5', fill: 'none', stroke: WHITE, 'stroke-width': 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, toast);
  const toastT = txt(toast, 'Welcome, Anu!', { x: 66, y: 79, 'font-size': 16, 'font-weight': 700, fill: INK });
  return {
    g: root,
    texts: [{ id: 'home-toast', el: toastT, text: 'Welcome, Anu!' }],
    update(t, toastAt) {
      tf(s1.g, 60, 402, 98 / 128);
      s1.pose(t, { mood: 'scared', seed: 9 });
      tf(s2.g, 320, 322 - 72 * 0.03 * Math.sin(t * 2), 72 / 128);
      s2.pose(t, { mood: 'scared', seed: 10 });
      tf(z.g, 196, 438, 200 / 128);
      z.pose(t, { mood: 'happy', live: true, seed: 11 });
      hz.pose(t, { mood: 'idle', seed: 12 });
      const p = seg(t, toastAt, toastAt + 0.4);
      op(toast, p);
      tf(toast, 0, -70 * (1 - E.out(p)));
    },
  };
}
