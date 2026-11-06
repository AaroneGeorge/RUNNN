// Small-area geodesy helpers. Games happen inside a few hundred metres, so
// spherical maths is plenty accurate.

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

export function distance(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b in degrees, 0 = north, clockwise. */
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
  return { lat: toDeg(φ2), lng: toDeg(λ2) };
}

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
  if (b.type === 'circle') return distance(p, b.center) <= b.radius;
  return pointInPolygon(p, b.points);
}

export function circleToPolygon(center: LatLng, radius: number, n = 48): LatLng[] {
  const pts: LatLng[] = [];
  for (let i = 0; i < n; i++) pts.push(offset(center, radius, (360 / n) * i));
  return pts;
}

export function boundaryPoints(b: Boundary): LatLng[] {
  return b.type === 'circle' ? circleToPolygon(b.center, b.radius) : b.points;
}

export function boundaryCenter(b: Boundary): LatLng {
  if (b.type === 'circle') return b.center;
  const n = b.points.length;
  const s = b.points.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: s.lat / n, lng: s.lng / n };
}

/** Approximate area in m² (equirectangular projection around the centre). */
export function boundaryArea(b: Boundary): number {
  if (b.type === 'circle') return Math.PI * b.radius ** 2;
  const c = boundaryCenter(b);
  const kx = R * Math.cos(toRad(c.lat)) * (Math.PI / 180);
  const ky = R * (Math.PI / 180);
  let a = 0;
  const pts = b.points;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].lng * kx, yi = pts[i].lat * ky;
    const xj = pts[j].lng * kx, yj = pts[j].lat * ky;
    a += xj * yi - xi * yj;
  }
  return Math.abs(a / 2);
}

export function bbox(b: Boundary): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  const pts = boundaryPoints(b);
  return {
    minLat: Math.min(...pts.map((p) => p.lat)),
    maxLat: Math.max(...pts.map((p) => p.lat)),
    minLng: Math.min(...pts.map((p) => p.lng)),
    maxLng: Math.max(...pts.map((p) => p.lng)),
  };
}

/** Shortest distance (m) from p to the boundary's edge. */
export function distanceToEdge(p: LatLng, b: Boundary): number {
  if (b.type === 'circle') return Math.abs(b.radius - distance(p, b.center));
  const c = boundaryCenter(b);
  const kx = R * Math.cos(toRad(c.lat)) * (Math.PI / 180);
  const ky = R * (Math.PI / 180);
  const px = p.lng * kx, py = p.lat * ky;
  let best = Infinity;
  const pts = b.points;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const ax = pts[j].lng * kx, ay = pts[j].lat * ky;
    const bx = pts[i].lng * kx, by = pts[i].lat * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}

/**
 * Random point inside the boundary, at least `margin` metres from its edge.
 * Falls back to the centre if the area is too small for the margin.
 */
export function randomPointIn(b: Boundary, rng: () => number = Math.random, margin = 0): LatLng {
  const box = bbox(b);
  for (let i = 0; i < 500; i++) {
    const p = {
      lat: box.minLat + rng() * (box.maxLat - box.minLat),
      lng: box.minLng + rng() * (box.maxLng - box.minLng),
    };
    if (inBoundary(p, b) && (margin === 0 || distanceToEdge(p, b) >= margin)) return p;
  }
  return boundaryCenter(b);
}

export function isValidBoundary(b: unknown): b is Boundary {
  if (!b || typeof b !== 'object') return false;
  const o = b as Record<string, unknown>;
  const okPt = (p: unknown) =>
    !!p &&
    typeof (p as LatLng).lat === 'number' &&
    typeof (p as LatLng).lng === 'number' &&
    Math.abs((p as LatLng).lat) <= 90 &&
    Math.abs((p as LatLng).lng) <= 180;
  if (o.type === 'circle') return okPt(o.center) && typeof o.radius === 'number' && o.radius >= 20 && o.radius <= 3000;
  if (o.type === 'polygon')
    return Array.isArray(o.points) && o.points.length >= 3 && o.points.length <= 64 && o.points.every(okPt);
  return false;
}
