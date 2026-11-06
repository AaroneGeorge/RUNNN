import { useEffect, useRef, type ReactNode } from 'react';
import type { Feature, FeatureCollection } from 'geojson';
import { Map as MapLibre, Marker, setWorkerUrl, type GeoJSONSource, type MapMouseEvent, type ErrorEvent, type StyleSpecification } from 'maplibre-gl';
// MapLibre 6 loads its worker from a sibling file; point it at the copy Vite emits.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import {
  bbox,
  boundaryCenter,
  boundaryPoints,
  circleToPolygon,
  type Boundary,
  type LatLng,
  type MapMarker,
} from '@kalikkam/shared';
import { useTheme } from '../lib/theme.ts';

setWorkerUrl(workerUrl);

/** Map tiles per theme, inked like the rest of the app: ink boundary (cream in dark mode), yellow corner points. */
const TONES = {
  light: { style: 'https://tiles.openfreemap.org/styles/positron', bg: '#eeebe3', mask: '#141414', maskOpacity: 0.1, line: '#141414', dot: '#ffc21a', dotStroke: '#141414' },
  // Dark mode: OpenFreeMap's dark tiles, a cream boundary, and a deeper shade outside the play area.
  dark: { style: 'https://tiles.openfreemap.org/styles/dark', bg: '#141311', mask: '#000000', maskOpacity: 0.38, line: '#f2efe7', dot: '#ffc21a', dotStroke: '#141414' },
} as const;
// If the tile server is unreachable the game must still work: plain background + our layers.
const fallbackStyle = (bg: string): StyleSpecification => ({
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': bg } }],
});
const KOCHI: LatLng = { lat: 9.9816, lng: 76.2756 };

const CIRCLE_FILL: Record<string, number> = { sos: 0.3, player: 0 };

export interface Draft {
  points?: LatLng[];
  circle?: { center: LatLng; radius: number };
}

interface Props {
  boundary: Boundary | null;
  markers?: MapMarker[];
  draft?: Draft | null;
  onTap?: (p: LatLng) => void;
  /** Change this value to re-fit the view to the boundary. */
  fitKey?: string;
  center?: LatLng | null;
  showLabels?: boolean;
  children?: ReactNode;
  className?: string;
  /** Fixed when the map is created; defaults to the theme in use (the map is rebuilt when it changes). */
  tone?: keyof typeof TONES;
  /** A route to draw (your run): pieces of line, each in its own colour, with an ink casing. */
  path?: { points: LatLng[]; color: string }[];
}

type FC = FeatureCollection;
const fc = (features: Feature[]): FC => ({ type: 'FeatureCollection', features });
const ring = (pts: LatLng[]) => {
  const r = pts.map((p) => [p.lng, p.lat]);
  if (r.length) r.push(r[0]);
  return r;
};

function maskData(b: Boundary | null): FC {
  if (!b) return fc([]);
  const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
  return fc([{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [world, ring(boundaryPoints(b)).reverse()] } }]);
}

function boundaryData(b: Boundary | null): FC {
  if (!b) return fc([]);
  return fc([{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ring(boundaryPoints(b)) } }]);
}

function circlesData(markers: MapMarker[]): FC {
  return fc(
    markers
      .filter((m) => m.radius && m.kind !== 'player')
      .map((m) => ({
        type: 'Feature',
        properties: { color: m.color ?? '#141414', fill: (CIRCLE_FILL[m.kind] ?? 0.15) * (m.faded ? 0.4 : 1), dash: m.faded ? 1 : 0 },
        geometry: { type: 'Polygon', coordinates: [ring(circleToPolygon(m, m.radius!, 40))] },
      })),
  );
}

function pathData(path: Props['path']): FC {
  return fc(
    (path ?? [])
      .filter((s) => s.points.length >= 2)
      .map((s) => ({ type: 'Feature', properties: { color: s.color }, geometry: { type: 'LineString', coordinates: s.points.map((p) => [p.lng, p.lat]) } })),
  );
}

function draftData(d: Draft | null | undefined): { line: FC; pts: FC } {
  if (!d) return { line: fc([]), pts: fc([]) };
  if (d.circle) {
    return {
      line: fc([{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ring(circleToPolygon(d.circle.center, d.circle.radius, 64)) } }]),
      pts: fc([{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [d.circle.center.lng, d.circle.center.lat] } }]),
    };
  }
  const pts = d.points ?? [];
  const coords = pts.map((p) => [p.lng, p.lat]);
  if (pts.length >= 3) coords.push(coords[0]);
  return {
    line: fc(coords.length >= 2 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }] : []),
    pts: fc(pts.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } }))),
  };
}

interface MarkerRec {
  marker: Marker;
  /** Inner element we style; the outer one belongs to MapLibre (keeps its positioning classes). */
  el: HTMLDivElement;
  sig: string;
}

/** The map, in the colours of the theme in use. Switching themes rebuilds it with the other tiles. */
export function GameMap(props: Props) {
  const theme = useTheme();
  const tone = props.tone ?? theme;
  return <MapView key={tone} {...props} tone={tone} />;
}

function MapView({ boundary, markers = [], draft, onTap, fitKey, center, showLabels = true, children, className, tone = 'light', path }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const ready = useRef(false);
  const recs = useRef(new Map<string, MarkerRec>());
  const latest = useRef({ boundary, markers, draft, path });
  latest.current = { boundary, markers, draft, path };
  const tapRef = useRef(onTap);
  tapRef.current = onTap;
  const fitted = useRef<string | null>(null);

  // Create the map once.
  useEffect(() => {
    if (!box.current) return;
    const start = boundary ? boundaryCenter(boundary) : (center ?? KOCHI);
    const t = TONES[tone];
    const map = new MapLibre({
      container: box.current,
      style: t.style,
      center: [start.lng, start.lat],
      zoom: 16.5,
      attributionControl: { compact: true },
      pitchWithRotate: false,
      dragRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    mapRef.current = map;
    let fellBack = false;
    map.on('error', (e: ErrorEvent) => {
      if (!fellBack && !map.isStyleLoaded() && String(e.error?.message ?? '').match(/style|fetch|network|Failed/i)) {
        fellBack = true;
        map.setStyle(fallbackStyle(t.bg));
      }
    });
    map.on('style.load', () => {
      const add = (id: string, data: FC) => {
        if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data });
      };
      add('mask', fc([]));
      add('boundary', fc([]));
      add('circles', fc([]));
      add('draft-line', fc([]));
      add('draft-pts', fc([]));
      add('path', fc([]));
      map.addLayer({ id: 'mask', type: 'fill', source: 'mask', paint: { 'fill-color': t.mask, 'fill-opacity': t.maskOpacity } });
      map.addLayer({ id: 'boundary', type: 'line', source: 'boundary', paint: { 'line-color': t.line, 'line-width': 3, 'line-dasharray': [2, 1.5] } });
      map.addLayer({ id: 'circles-fill', type: 'fill', source: 'circles', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'fill'] } });
      map.addLayer({ id: 'circles-line', type: 'line', source: 'circles', paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.9 } });
      map.addLayer({ id: 'draft-line', type: 'line', source: 'draft-line', paint: { 'line-color': t.line, 'line-width': 3 } });
      const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
      map.addLayer({ id: 'path-casing', type: 'line', source: 'path', layout: round, paint: { 'line-color': '#141414', 'line-width': 7 } });
      map.addLayer({ id: 'path', type: 'line', source: 'path', layout: round, paint: { 'line-color': ['get', 'color'], 'line-width': 4 } });
      map.addLayer({
        id: 'draft-pts',
        type: 'circle',
        source: 'draft-pts',
        paint: { 'circle-radius': 7, 'circle-color': t.dot, 'circle-stroke-color': t.dotStroke, 'circle-stroke-width': 2 },
      });
      ready.current = true;
      applyLayers();
    });
    // Start the attribution collapsed (ⓘ) so it doesn't cover the action buttons.
    map.once('load', () => box.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'));
    map.on('click', (e: MapMouseEvent) => tapRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(box.current);
    return () => {
      ro.disconnect();
      ready.current = false;
      recs.current.clear();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyLayers() {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    const { boundary, markers, draft, path } = latest.current;
    (map.getSource('mask') as GeoJSONSource | undefined)?.setData(maskData(boundary));
    (map.getSource('boundary') as GeoJSONSource | undefined)?.setData(boundaryData(boundary));
    (map.getSource('circles') as GeoJSONSource | undefined)?.setData(circlesData(markers));
    const d = draftData(draft);
    (map.getSource('draft-line') as GeoJSONSource | undefined)?.setData(d.line);
    (map.getSource('draft-pts') as GeoJSONSource | undefined)?.setData(d.pts);
    (map.getSource('path') as GeoJSONSource | undefined)?.setData(pathData(path));
  }

  useEffect(applyLayers, [boundary, markers, draft, path]);

  // HTML markers (players + emoji objects).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const seen = new Set<string>();
    for (const m of markers) {
      const isPlayer = m.kind === 'player';
      if (!isPlayer && !m.emoji) continue;
      seen.add(m.id);
      const sig = `${m.kind}|${m.emoji}|${m.color}|${m.self}|${m.faded}|${showLabels ? m.label : ''}`;
      let rec = recs.current.get(m.id);
      if (!rec) {
        const outer = document.createElement('div');
        const el = document.createElement('div');
        outer.appendChild(el);
        rec = { el, sig: '', marker: new Marker({ element: outer, anchor: 'center' }).setLngLat([m.lng, m.lat]).addTo(map) };
        recs.current.set(m.id, rec);
      }
      if (rec.sig !== sig) {
        rec.sig = sig;
        const el = rec.el;
        el.innerHTML = '';
        if (isPlayer) {
          el.className = `pm${m.self ? ' self' : ''}${m.faded ? ' faded' : ''}`;
          el.style.setProperty('--c', m.color ?? '#fff');
          rec.marker.getElement().style.zIndex = m.self ? '5' : '2';
          el.textContent = m.emoji ?? '•';
          if (showLabels && m.label) {
            const l = document.createElement('div');
            l.className = 'pm-label';
            l.textContent = m.label;
            el.appendChild(l);
          }
        } else {
          el.className = 'om';
          el.style.opacity = m.faded ? '0.5' : '1';
          el.textContent = m.emoji ?? '';
          el.title = m.label ?? '';
        }
      }
      rec.marker.setLngLat([m.lng, m.lat]);
    }
    for (const [id, rec] of recs.current) {
      if (!seen.has(id)) {
        rec.marker.remove();
        recs.current.delete(id);
      }
    }
  }, [markers, showLabels]);

  // Fit to the boundary when asked.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !boundary || fitKey === undefined || fitted.current === fitKey) return;
    fitted.current = fitKey;
    const b = bbox(boundary);
    map.fitBounds(
      [
        [b.minLng, b.minLat],
        [b.maxLng, b.maxLat],
      ],
      { padding: 50, duration: 0, maxZoom: 18.5 },
    );
  }, [fitKey, boundary]);

  // Fly to an explicit centre (e.g. "locate me"). Pass a new object to re-centre on the same spot.
  useEffect(() => {
    if (center && mapRef.current) mapRef.current.easeTo({ center: [center.lng, center.lat], duration: 600 });
  }, [center]);

  return (
    <div className={`${/\b(absolute|fixed)\b/.test(className ?? '') ? '' : 'relative '}${className ?? ''}`}>
      {/* Inline style: maplibre's unlayered .maplibregl-map { position: relative } beats Tailwind classes. */}
      <div ref={box} style={{ position: 'absolute', inset: 0 }} />
      {children}
    </div>
  );
}
