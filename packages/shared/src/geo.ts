export interface LatLng {
  lat: number;
  lng: number;
}

export type Boundary =
  | { type: 'polygon'; points: LatLng[] }
  | { type: 'circle'; center: LatLng; radius: number };

const R = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in metres (haversine). */
export function distance(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b in degrees: 0 = north, clockwise. */
export function bearing(a: LatLng, b: LatLng): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Point `meters` away from p along `bearingDeg`. */
export function offset(p: LatLng, meters: number, bearingDeg: number): LatLng {
  const δ = meters / R;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(p.lat);
  const λ1 = toRad(p.lng);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: toDeg(φ2), lng: ((toDeg(λ2) + 540) % 360) - 180 };
}

/** Local flat projection around `origin`, metres east/north. Fine for a few km. */
export function toLocal(origin: LatLng, p: LatLng): { x: number; y: number } {
  return {
    x: toRad(p.lng - origin.lng) * R * Math.cos(toRad(origin.lat)),
    y: toRad(p.lat - origin.lat) * R,
  };
}

export function fromLocal(origin: LatLng, x: number, y: number): LatLng {
  return {
    lat: origin.lat + toDeg(y / R),
    lng: origin.lng + toDeg(x / (R * Math.cos(toRad(origin.lat)))),
  };
}

/** Ray casting. Works on lat/lng directly because play areas are tiny. */
export function pointInPolygon(p: LatLng, poly: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.lat > p.lat !== b.lat > p.lat) {
      const x = ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng;
      if (p.lng < x) inside = !inside;
    }
  }
  return inside;
}

export function inBoundary(p: LatLng, b: Boundary): boolean {
  return b.type === 'circle' ? distance(p, b.center) <= b.radius : pointInPolygon(p, b.points);
}

function segmentDistance(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance in metres from p to the nearest edge of the boundary (inside or outside). */
export function distanceToEdge(p: LatLng, b: Boundary): number {
  if (b.type === 'circle') return Math.abs(b.radius - distance(p, b.center));
  const local = b.points.map((q) => toLocal(p, q));
  const origin = { x: 0, y: 0 };
  let best = Infinity;
  for (let i = 0, j = local.length - 1; i < local.length; j = i++) {
    best = Math.min(best, segmentDistance(origin, local[j], local[i]));
  }
  return best;
}

export function boundaryCenter(b: Boundary): LatLng {
  if (b.type === 'circle') return b.center;
  const n = b.points.length;
  return {
    lat: b.points.reduce((s, p) => s + p.lat, 0) / n,
    lng: b.points.reduce((s, p) => s + p.lng, 0) / n,
  };
}

export function boundaryBox(b: Boundary): { min: LatLng; max: LatLng } {
  if (b.type === 'circle') {
    const n = offset(b.center, b.radius, 0);
    const e = offset(b.center, b.radius, 90);
    const s = offset(b.center, b.radius, 180);
    const w = offset(b.center, b.radius, 270);
    return { min: { lat: s.lat, lng: w.lng }, max: { lat: n.lat, lng: e.lng } };
  }
  const lats = b.points.map((p) => p.lat);
  const lngs = b.points.map((p) => p.lng);
  return {
    min: { lat: Math.min(...lats), lng: Math.min(...lngs) },
    max: { lat: Math.max(...lats), lng: Math.max(...lngs) },
  };
}

/** Uniform random point inside the boundary, at least `margin` metres from the edge when possible. */
export function randomPointIn(b: Boundary, rng: () => number = Math.random, margin = 0): LatLng {
  if (b.type === 'circle') {
    const r = Math.max(0, b.radius - margin) * Math.sqrt(rng());
    return offset(b.center, r, rng() * 360);
  }
  const { min, max } = boundaryBox(b);
  for (let i = 0; i < 200; i++) {
    const p = { lat: min.lat + (max.lat - min.lat) * rng(), lng: min.lng + (max.lng - min.lng) * rng() };
    if (pointInPolygon(p, b.points) && (margin === 0 || distanceToEdge(p, b) >= margin)) return p;
  }
  return boundaryCenter(b);
}

/** Area in square metres (equirectangular shoelace). */
export function boundaryArea(b: Boundary): number {
  if (b.type === 'circle') return Math.PI * b.radius * b.radius;
  const o = boundaryCenter(b);
  const pts = b.points.map((p) => toLocal(o, p));
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  return Math.abs(s) / 2;
}

const isLatLng = (x: unknown): x is LatLng =>
  !!x &&
  typeof x === 'object' &&
  Number.isFinite((x as LatLng).lat) &&
  Number.isFinite((x as LatLng).lng) &&
  Math.abs((x as LatLng).lat) <= 90 &&
  Math.abs((x as LatLng).lng) <= 180;

/** Server-side guard for organiser-drawn areas: 3–64 points, or a circle of 20–3000 m. */
export function isValidBoundary(x: unknown): x is Boundary {
  if (!x || typeof x !== 'object') return false;
  const b = x as Boundary;
  if (b.type === 'circle') {
    return isLatLng(b.center) && Number.isFinite(b.radius) && b.radius >= 20 && b.radius <= 3000;
  }
  if (b.type === 'polygon') {
    if (!Array.isArray(b.points) || b.points.length < 3 || b.points.length > 64) return false;
    if (!b.points.every(isLatLng)) return false;
    const area = boundaryArea(b);
    return area >= 200 && area <= 30_000_000;
  }
  return false;
}

/** Strip anything extra from a boundary that passed isValidBoundary. */
export function cleanBoundary(b: Boundary): Boundary {
  return b.type === 'circle'
    ? { type: 'circle', center: { lat: b.center.lat, lng: b.center.lng }, radius: Math.round(b.radius) }
    : { type: 'polygon', points: b.points.map((p) => ({ lat: p.lat, lng: p.lng })) };
}
