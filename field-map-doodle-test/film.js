// "Join the hunt": a survivor opens Kalikkam for the first time; four taps later she's on the field, and a
// zombie's crosshair is already on her. Every frame is a pure function of t (render(t)); every hit is on the
// 118 BPM grid and is also a sound event (EV) for score.py.
import { el, txt, tf, op, show, seg, lerp, E, kf, at, ev, EV, punch, punchAt, fieldMap, phone, sparkle, wordmark, tapRing, crosshair, pill, fitPill, W, H, INK, SUN, WHITE, DISPLAY, BEAT } from './kit.js';
import { character } from './cast.js';
import { splash, tour, signIn, home } from './screens.js';

const T = at;
// Key moments (bar, beat).
const K = {
  lock0: T(0, 2), irisOpen: T(1, 0), irisOpened: T(1, 2), pull1: [T(1, 3), T(2, 3)],
  tour: T(2, 3), taps: [T(4, 0), T(5, 2), T(7, 0)], signin: T(7, 0) + 0.12, push: [T(7, 1), T(7, 3)],
  type: [T(7, 3), T(7, 3.5), T(8, 0)], guest: T(8, 2), home: T(8, 2) + 0.33, toast: T(8, 3), pull2: [T(9, 0), T(9, 3)],
  pings: [T(9, 3), T(10, 0), T(10, 2)], silence: T(10, 0), lock: T(11, 0),
  climb: [T(11, 1), T(11, 3)], zrise: [T(11, 2), T(11, 3)], zhop: [T(11, 3.5), T(12, 0)], leapS: [T(12, 0), T(12, 2)], leapZ: [T(12, 1), T(12, 3)],
  irisClose: [T(12, 2), T(13, 0)], end: T(13, 0), endPill: T(13, 2), endCta: T(13, 3), endS: T(14, 0), endZ: T(14, 1),
};
const DUR = +(T(15) + 0.6).toFixed(3);
const LOCKED = [612, 1046]; // the player the opening crosshair locks on

const world = document.getElementById('world');
const cam = document.getElementById('cam');
const TEXTS = [];
const reg = (id, text, e, t0, t1) => TEXTS.push({ id, text, el: e, t0, t1 });

// ---- camera: the phone rig's framing (x, y, scale, rotation) between key moments, eased in and out ----
const FILL = [540, 960, 1.652, 0];
const PHONE = [550, 1020, 0.94, -2.5];
const PUSH = [487, 940, 1.32, -1];
const MAP = [540, 1230, 0.6, 0];
const CAM = [[K.pull1, FILL, PHONE], [K.push, PHONE, PUSH], [K.pull2, PUSH, MAP]];
function camAt(t) {
  let v = FILL;
  for (const [[a, b], from, to] of CAM) {
    if (t < a) break;
    const p = E.io(seg(t, a, b));
    v = from.map((x, i) => lerp(x, to[i], p));
  }
  return v;
}

// ---- layers ---------------------------------------------------------------------------------------------
function build() {
  // The end card sits at the bottom: the closing iris reveals it.
  const endL = el('g', {}, world);
  const hookL = el('g', {}, world);
  const clipId = 'iris';
  const clip = el('clipPath', { id: clipId }, el('defs', {}, world));
  const irisC = el('circle', { cx: LOCKED[0], cy: LOCKED[1], r: 3000 }, clip);
  const phoneL = el('g', { 'clip-path': `url(#${clipId})` }, world);
  const ringL = el('circle', { fill: 'none', stroke: INK }, world); // the iris edge
  const ups = [buildHook(hookL), buildPhoneWorld(phoneL), buildEnd(endL)];
  const endWm = ups[2].wm;
  const endO = [W / 2 + endWm.ox, 760];

  return (t) => {
    show(hookL, t < K.irisOpened);
    show(phoneL, t >= K.irisOpen && t < K.irisClose[1]);
    show(endL, t >= K.irisClose[0]);
    // Iris: opens from the locked player into the phone; closes onto the end card's crosshair O.
    let r = 3000, cx = LOCKED[0], cy = LOCKED[1], lw = 0;
    if (t < K.irisOpened) {
      const p = E.io(seg(t, K.irisOpen, K.irisOpened));
      r = lerp(46, 1300, p);
      lw = lerp(16, 30, p);
    } else if (t >= K.irisClose[0]) {
      const p = E.io(seg(t, K.irisClose[0], K.irisClose[1]));
      [cx, cy] = endO;
      r = lerp(1340, endWm.ring, p);
      lw = lerp(30, endWm.lw, p);
    }
    irisC.setAttribute('cx', cx);
    irisC.setAttribute('cy', cy);
    irisC.setAttribute('r', r.toFixed(1));
    const ringOn = (t >= K.irisOpen && t < K.irisOpened) || (t >= K.irisClose[0] && t < K.irisClose[1]);
    show(ringL, ringOn);
    if (ringOn) {
      ringL.setAttribute('cx', cx);
      ringL.setAttribute('cy', cy);
      ringL.setAttribute('r', r.toFixed(1));
      ringL.setAttribute('stroke-width', lw.toFixed(1));
    }
    for (const u of ups) u.update(t);
  };
}

// ---- 1. the hook: players as dots on the field map; a crosshair locks on one -------------------------------
function buildHook(g) {
  const map = fieldMap(g);
  el('circle', { cx: 540, cy: 1000, r: 430, fill: 'none', stroke: INK, 'stroke-width': 6, 'stroke-dasharray': '22 16', 'stroke-linecap': 'round' }, g);
  const spots = [[612, 1046, 0], [420, 820, 0], [700, 760, 1], [330, 1120, 0], [520, 1300, 0], [800, 1180, 0], [610, 900, 0], [450, 1010, 1], [760, 980, 0]];
  const dots = spots.map(([x, y, z]) => {
    const d = el('g', {}, g);
    el('circle', { r: z ? 22 : 20, fill: z ? SUN : WHITE, stroke: INK, 'stroke-width': 6 }, d);
    return { d, x, y };
  });
  const ch = el('g', {}, g);
  crosshair(ch, { r: 46, lw: 10 });
  ev(0, 'ping');
  ev(K.lock0, 'lock');
  punch(K.lock0, 0.03);
  ev(K.lock0, 'riser', { d: K.irisOpen - K.lock0 });
  return {
    update(t) {
      map.move(-t * 10, -t * 6);
      dots.forEach((o, i) => tf(o.d, o.x + 6 * Math.sin(t * 1.3 + i * 1.7), o.y + 6 * Math.cos(t * 1.1 + i * 2.3)));
      // The crosshair swings in from the corner (scale 2.2, rotated) and locks on the beat.
      const p = E.out(seg(t, 0, K.lock0));
      const [lx, ly] = [LOCKED[0] + 6 * Math.sin(t * 1.3), LOCKED[1] + 6 * Math.cos(t * 1.1)];
      tf(ch, lerp(980, lx, p), lerp(360, ly, p), lerp(2.2, 1, p), lerp(120, 0, p));
    },
  };
}

// ---- 2. the phone world: the entry flow on the phone, then the map, the lock-on and the climb-out ----------
function buildPhoneWorld(g) {
  const map = fieldMap(g);
  const view = el('g', {}, g); // camera: the phone at the origin
  const area = el('circle', { r: 820, fill: 'none', stroke: INK, 'stroke-width': 10, 'stroke-dasharray': '36 26', 'stroke-linecap': 'round' }, view);
  const pings = K.pings.map(() => el('circle', { r: 1, fill: 'none', stroke: SUN, 'stroke-width': 14 }, view));
  const zdot = el('g', {}, view);
  el('circle', { r: 34, fill: SUN, stroke: INK, 'stroke-width': 10 }, zdot);
  const behind = el('g', {}, view);
  const zomB = character(behind, 'zombie');
  const ph = phone(view, { w: 690, h: 1400 });
  const sw = ph.sw, sh = ph.sh;
  const scr = {
    splash: splash(ph.screen, sw, sh),
    tour: tour(ph.screen, sw, sh),
    signin: signIn(ph.screen, sw),
    home: home(ph.screen, sw, sh),
  };
  const tap = tapRing(ph.screen);
  // Climb-out layer: visible inside the screen and anywhere above the phone's top edge.
  const cid = 'climb';
  const cl = el('clipPath', { id: cid }, el('defs', {}, view));
  el('rect', { x: -sw / 2, y: -sh / 2, width: sw, height: sh }, cl);
  el('rect', { x: -4000, y: -8000, width: 8000, height: 8000 - sh / 2 }, cl);
  const climbL = el('g', { 'clip-path': `url(#${cid})` }, view);
  const surv = character(climbL, 'survivor');
  const front = el('g', {}, view);
  const zomF = character(front, 'zombie');
  const lockG = el('g', {}, view);
  crosshair(lockG, { r: 520, lw: 26 });

  // Texts the viewer must read, with the windows they stay readable (readcheck).
  reg('splash-wm', 'ZOMBIES', scr.splash.texts[0].el, K.irisOpened, K.tour);
  reg('splash-pill', 'OUTDOOR TAG · KOCHI', scr.splash.texts[1].el, K.irisOpen + 0.8, K.tour);
  const cardIn = [K.tour, K.taps[0] + 0.32, K.taps[1] + 0.32];
  const cardOut = [K.taps[0], K.taps[1], K.taps[2]];
  scr.tour.cards.forEach((c, i) => reg('tour-' + i, c.text, c.title, cardIn[i], cardOut[i]));
  reg('signin', 'Join the hunt', scr.signin.texts[0].el, K.signin + 0.24, K.guest);
  reg('toast', 'Welcome, Anu!', scr.home.texts[0].el, K.toast + 0.4, K.irisClose[0]);

  // Sound events for the phone part.
  ev(K.irisOpen, 'iris');
  ev(K.irisOpen + 0.64, 'bell');
  ev(K.irisOpen + 0.42, 'pop', { f: 900 });
  ev(K.irisOpen + 0.56, 'pop', { f: 520 });
  ev(K.irisOpen + 0.64, 'pop', { f: 420 });
  ev(K.tour, 'pop', { f: 700 });
  K.taps.forEach((tp) => { ev(tp - 0.04, 'tap'); ev(tp, 'slide'); punch(tp, 0.012); });
  ev(K.signin, 'slide');
  K.type.forEach((tp, i) => ev(tp, 'type', { i }));
  ev(K.guest - 0.04, 'tap');
  punch(K.guest, 0.015);
  ev(K.home, 'pop', { f: 640 });
  ev(K.toast, 'ding');
  K.pings.forEach((tp) => ev(tp, 'ping'));
  for (let b = 0; b < 4; b++) ev(T(10, b), 'heart');
  for (let b = 0; b < 5; b++) ev(T(9, 3) + b * BEAT, 'step');
  ev(K.lock, 'lock');
  ev(K.lock, 'crash');
  punch(K.lock, 0.05);
  ev(K.zrise[0], 'pop', { f: 300 });
  ev(K.climb[1], 'land');
  ev(K.zhop[1], 'land');
  ev(K.leapS[0], 'jump');
  ev(K.leapZ[0], 'jump', { f: 0.8 });
  ev(K.irisClose[0], 'iris');

  // Zombie dot: steps closer on each beat of the silence (local coords, phone at the origin).
  const steps = [[760, -980], [660, -900], [560, -830], [460, -770], [370, -720]];
  const stepAt = (i) => T(9, 3) + i * BEAT;

  return {
    update(t) {
      const [x, y, s, r] = camAt(t);
      view.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${r.toFixed(2)}) scale(${s.toFixed(4)})`);
      map.move(-t * 10 - x * 0.4, -t * 6 - y * 0.4);
      const onMap = t >= K.pull2[0];
      op(area, seg(t, K.pull2[0], K.pull2[1]));
      // Screens
      show(scr.splash.g, t < K.tour);
      show(scr.tour.g, t >= K.tour && t < K.signin);
      show(scr.signin.g, t >= K.signin && t < K.home);
      show(scr.home.g, t >= K.home);
      if (t < K.tour) scr.splash.update(t, K.irisOpen);
      else if (t < K.signin) scr.tour.update(t, K.tour, K.taps);
      else if (t < K.home) {
        // The app's step-in: slide 28 px from the right and fade, 240 ms.
        const p = E.out(seg(t, K.signin, K.signin + 0.24));
        tf(scr.signin.g, 28 * (1 - p) * (sw / 390), 0, sw / 390);
        op(scr.signin.g, p);
        const n = K.type.filter((tp) => t >= tp).length;
        scr.signin.type('Anu'.slice(0, n), t);
        scr.signin.zombie.pose(t, { mood: 'idle', live: true, seed: 3 });
        scr.signin.press(scr.signin.guest, t, K.guest);
      } else scr.home.update(t, K.toast);
      // Taps
      const tapT = [...K.taps, K.guest].find((tp) => t > tp - 0.2 && t < tp + 0.5);
      if (tapT === K.guest) tap.at(t, tapT, ...scr.signin.guestAt);
      else if (tapT !== undefined) tap.at(t, tapT, ...scr.tour.btnAt(tapT === K.taps[2]));
      else tap.at(t, -9, 0, 0);
      // Radar pings across the map
      pings.forEach((c, i) => {
        const p = seg(t, K.pings[i], K.pings[i] + 1.6);
        show(c, p > 0 && p < 1);
        c.setAttribute('r', lerp(380, 1500, E.out(p)).toFixed(1));
        op(c, 0.9 * (1 - p));
      });
      // The zombie dot steps in on each beat, then turns into the zombie behind the phone.
      const si = steps.reduce((k, _, i) => (t >= stepAt(i) ? i : k), -1);
      show(zdot, onMap && t >= stepAt(0) - 0.3 && t < K.zrise[0] + 0.12);
      if (si >= 0) {
        const [a, b] = steps[si], [c, d] = steps[Math.min(si + 1, steps.length - 1)];
        const hop = si < steps.length - 1 ? E.out(seg(t, stepAt(si + 1) - 0.18, stepAt(si + 1))) : 0;
        tf(zdot, lerp(a, c, hop), lerp(b, d, hop) - 40 * Math.sin(Math.PI * hop), 1 - 0.6 * seg(t, K.zrise[0], K.zrise[0] + 0.12));
      } else tf(zdot, steps[0][0], steps[0][1], seg(t, stepAt(0) - 0.3, stepAt(0)));
      // LOCK-ON around the phone
      const lp = E.out(seg(t, K.lock, K.lock + 0.28));
      show(lockG, t >= K.lock && t < K.climb[0] + 0.6);
      tf(lockG, 0, 0, lerp(1.6, 1, lp), lerp(45, 0, lp));
      op(lockG, lp * (1 - seg(t, K.climb[0] + 0.2, K.climb[0] + 0.6)));
      // Climb-out: she rises out of the screen onto the top edge, then leaps off to the left.
      const S = 300 / 128, Z = 360 / 128, top = -700;
      show(surv.g, t >= K.climb[0] && t < K.leapS[1]);
      if (t < K.leapS[0]) {
        const p = seg(t, K.climb[0], K.climb[1]);
        const yy = lerp(900, top, E.out(p));
        const sq = p >= 1 ? 1 - 0.12 * Math.exp(-(t - K.climb[1]) * 9) * Math.cos((t - K.climb[1]) * 30) : 1;
        tf(surv.g, -90, yy, S * (2 - sq), 0, S * sq);
      } else {
        const p = seg(t, K.leapS[0], K.leapS[1]);
        tf(surv.g, lerp(-90, -1400, p), top - 380 * Math.sin(Math.PI * Math.min(1, p * 1.3)), S, -14 * p);
      }
      surv.pose(t, { mood: 'scared', live: true, seed: 13 });
      // The zombie rises behind the phone's right side, hops onto the edge, leaps after her.
      const zr = seg(t, K.zrise[0], K.zrise[1]);
      const onEdge = t >= K.zhop[1];
      show(zomB.g, t >= K.zrise[0] && !onEdge);
      show(zomF.g, onEdge && t < K.leapZ[1]);
      tf(zomB.g, 230, lerp(-200, -630, E.back(zr)) - 70 * E.out(seg(t, K.zhop[0], K.zhop[1])), Z);
      zomB.pose(t, { mood: 'happy', live: true, seed: 14 });
      if (t < K.leapZ[0]) tf(zomF.g, 230, top, Z);
      else {
        const p = seg(t, K.leapZ[0], K.leapZ[1]);
        tf(zomF.g, lerp(230, -1500, p), top - 420 * Math.sin(Math.PI * Math.min(1, p * 1.3)), Z, -10 * p);
      }
      zomF.pose(t, { mood: 'happy', live: true, seed: 14 });
    },
  };
}

// ---- 3. the end card: the iris lands as the wordmark's O ----------------------------------------------------
function buildEnd(g) {
  const map = fieldMap(g, { fill: SUN });
  const wm = wordmark(g, { size: 150, x: W / 2, y: 760 });
  const [ring, ticks, dot] = [...wm.o.children];
  const tickG = el('g', {}, wm.o);
  tickG.appendChild(ticks);
  tickG.appendChild(dot);
  const pillG = el('g', { transform: 'translate(540 900)' }, g);
  const pillIn = el('g', {}, pillG);
  const pillR = el('rect', { y: -34, height: 68, rx: 34, fill: WHITE }, pillIn);
  const pillT = txt(pillIn, 'OUTDOOR TAG · KOCHI', { y: 11, 'font-size': 30, ...DISPLAY, fill: INK, 'text-anchor': 'middle' });
  fitPill(pillR, pillT);
  const cta = el('g', { transform: 'translate(540 1060)' }, g);
  const ctaIn = el('g', {}, cta);
  pill(ctaIn, 'Coming to Kochi', { w: 560, h: 112, size: 44, arrow: false, align: 'center' });
  const ctaT = ctaIn.querySelector('text');
  const surv = character(g, 'survivor'), zom = character(g, 'zombie');
  const sp = [sparkle(g, { x: 170, y: 520, s: 36 }), sparkle(g, { x: 900, y: 600, s: 24 }), sparkle(g, { x: 940, y: 1250, s: 30 })];
  reg('end-wm', 'ZOMBIES', wm.g, K.end + 0.6, DUR);
  reg('end-pill', 'OUTDOOR TAG · KOCHI', pillT, K.endPill + 0.32, DUR);
  reg('end-cta', 'Coming to Kochi', ctaT, K.endCta + 0.32, DUR);
  ev(K.end, 'lock');
  ev(K.end, 'crash');
  punch(K.end, 0.04);
  ev(K.end + 0.05, 'pop', { f: 700 });
  ev(K.end + 0.5 * BEAT, 'pop', { f: 820 });
  ev(K.endPill, 'pop', { f: 900 });
  ev(K.endCta, 'pop', { f: 600 });
  ev(K.endS, 'land');
  ev(K.endZ, 'land');
  ev(T(14, 2), 'bell');
  const popIn = (e, t, t0, x, y, s = 1) => {
    const p = t < t0 ? 0 : E.back(seg(t, t0, t0 + 0.32));
    op(e, t < t0 ? 0 : seg(t, t0, t0 + 0.08));
    tf(e, x, y, s * lerp(0.6, 1, p));
  };
  return {
    wm,
    update(t) {
      map.move(-t * 8, -t * 5);
      // The ring is the iris that just closed; the ticks and dot lock on, the letters pop.
      show(ring, t >= K.end);
      const lp = E.out(seg(t, K.end, K.end + 0.28));
      tickG.setAttribute('transform', `scale(${lerp(1.6, 1, lp).toFixed(3)}) rotate(${lerp(45, 0, lp).toFixed(2)})`);
      op(tickG, lp);
      [wm.zT, wm.rT].forEach((e, i) => {
        const t0 = K.end + i * 0.5 * BEAT;
        const p = t < t0 ? 0 : E.back(seg(t, t0, t0 + 0.3));
        op(e, t < t0 ? 0 : 1);
        e.setAttribute('transform', `translate(0 ${(40 * (1 - p)).toFixed(1)})`);
      });
      popIn(pillIn, t, K.endPill, 0, 0);
      popIn(ctaIn, t, K.endCta, 0, 0);
      const sq = (t0) => (t < t0 ? 1 : 1 - 0.12 * Math.exp(-(t - t0) * 9) * Math.cos((t - t0) * 30));
      show(surv.g, t >= K.endS);
      show(zom.g, t >= K.endZ);
      const ds = E.in(seg(t, K.endS - 0.3, K.endS)), dz = E.in(seg(t, K.endZ - 0.3, K.endZ));
      tf(surv.g, 330, lerp(1100, 1560, ds), (300 / 128) * (2 - sq(K.endS)), 0, (300 / 128) * sq(K.endS));
      tf(zom.g, 720, lerp(1100, 1580, dz), (380 / 128) * (2 - sq(K.endZ)), 0, (380 / 128) * sq(K.endZ));
      surv.pose(t, { mood: 'scared', live: true, seed: 15 });
      zom.pose(t, { mood: 'happy', live: true, seed: 16 });
      sp.forEach((s, i) => popIn(s, t, K.endCta + 0.1 * i, [170, 900, 940][i], [520, 600, 1250][i]));
    },
  };
}

// ---- render -----------------------------------------------------------------------------------------------
let update = () => {};
window.DUR = DUR;
window.EV = EV;
window.render = (t) => {
  update(t);
  const k = 1 + punchAt(t);
  cam.setAttribute('transform', `translate(${W / 2} ${H / 2}) scale(${k.toFixed(4)}) translate(${-W / 2} ${-H / 2})`);
};
window.TEXTS = (t) => {
  window.render(t);
  return TEXTS.filter((x) => t >= x.t0 && t < x.t1).map((x) => {
    const b = x.el.getBoundingClientRect();
    return { id: x.id, text: x.text, x0: b.left, y0: b.top, x1: b.right, y1: b.bottom };
  });
};

(async () => {
  await document.fonts.load("900 40px 'Archivo Variable'");
  await document.fonts.load("600 16px 'Archivo Variable'");
  await new Promise((res) => {
    const im = new Image();
    im.onload = im.onerror = res;
    im.src = 'topo.svg';
  });
  update = build();
  EV.sort((a, b) => a.t - b.t);
  const q = new URLSearchParams(location.search);
  window.render(+(q.get('t') ?? 0));
  window.READY = true;
})();
