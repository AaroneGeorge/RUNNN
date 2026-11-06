import { describe, expect, it } from 'vitest';
import {
  bearing,
  boundaryArea,
  distance,
  distanceToEdge,
  hunterCount,
  inBoundary,
  isValidBoundary,
  levelForXp,
  normalizeConfig,
  offset,
  parseBibQr,
  randomPointIn,
  type Boundary,
} from '../src/index.ts';

const park = { lat: 51.5, lng: -0.12 };

describe('geo', () => {
  it('measures distance and bearing', () => {
    const north = offset(park, 100, 0);
    expect(distance(park, north)).toBeCloseTo(100, 0);
    expect(((bearing(park, north) + 180) % 360) - 180).toBeCloseTo(0, 0);
    const east = offset(park, 50, 90);
    expect(bearing(park, east)).toBeCloseTo(90, 0);
  });

  it('handles circles and polygons', () => {
    const circle: Boundary = { type: 'circle', center: park, radius: 100 };
    expect(inBoundary(offset(park, 90, 45), circle)).toBe(true);
    expect(inBoundary(offset(park, 110, 45), circle)).toBe(false);
    expect(distanceToEdge(offset(park, 90, 0), circle)).toBeCloseTo(10, 0);

    const square: Boundary = {
      type: 'polygon',
      points: [park, offset(park, 100, 0), offset(offset(park, 100, 0), 100, 90), offset(park, 100, 90)].map(
        (p) => ({ lat: p.lat, lng: p.lng }),
      ),
    };
    const mid = offset(offset(park, 50, 0), 50, 90);
    expect(inBoundary(mid, square)).toBe(true);
    expect(inBoundary(offset(park, 10, 180), square)).toBe(false);
    expect(boundaryArea(square)).toBeCloseTo(10_000, -2);
    expect(distanceToEdge(mid, square)).toBeCloseTo(50, 0);
    for (let i = 0; i < 50; i++) expect(inBoundary(randomPointIn(square), square)).toBe(true);
  });

  it('validates boundaries', () => {
    expect(isValidBoundary({ type: 'circle', center: park, radius: 100 })).toBe(true);
    expect(isValidBoundary({ type: 'circle', center: park, radius: 5 })).toBe(false);
    expect(isValidBoundary({ type: 'polygon', points: [park, park] })).toBe(false);
    expect(isValidBoundary({ type: 'polygon', points: Array(65).fill(park) })).toBe(false);
    expect(isValidBoundary(null)).toBe(false);
  });
});

describe('games', () => {
  it('clamps configs', () => {
    const c = normalizeConfig('chase', { holdSecs: 99, radarRange: '12', durationSecs: 'x', junk: 1 });
    expect(c.holdSecs).toBe(10);
    expect(c.radarRange).toBe(12);
    expect(c.durationSecs).toBe(1200);
    expect('junk' in c).toBe(false);
  });

  it('always deals at least one hunter and fewer hunters than runners', () => {
    for (let n = 2; n <= 60; n++) {
      for (let i = 0; i < 40; i++) {
        const h = hunterCount(n);
        expect(h).toBeGreaterThanOrEqual(1);
        if (n >= 3) expect(h).toBeLessThan(n - h);
      }
    }
  });
});

describe('community', () => {
  it('follows the XP curve', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(99)).toBe(1);
    expect(levelForXp(100)).toBe(2);
    expect(levelForXp(300)).toBe(3);
    expect(levelForXp(999)).toBe(4);
  });

  it('parses bib QRs', () => {
    expect(parseBibQr('RN1:104:ABCDEFGH')).toEqual({ bib: '104', sig: 'ABCDEFGH' });
    expect(parseBibQr('104')).toBeNull();
  });
});
