import type { Feature, FeatureCollection } from 'geojson';
import { Map as MlMap, Marker, setWorkerUrl, type GeoJSONSource, type MapMouseEvent } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useEffect, useRef, useState } from 'react';
import { boundaryBox, offset, type Boundary, type LatLng, type MapMarker } from '@runnn/shared';
import { cx } from './ui.tsx';

// MapLibre 6 loads its tile worker from a URL; let Vite bundle it.
setWorkerUrl(workerUrl);

const STYLE = 'https://tiles.openfreemap.org/styles/positron';

function ring(b: Boundary): [number, number][] {
  if (b.type === 'polygon') {
    const pts = b.points.map((p) => [p.lng, p.lat] as [number, number]);
    return pts.length ? [...pts, pts[0]] : [];
  }
  const pts: [number, number][] = [];
  for (let i = 0; i <= 64; i++) {
    const p = offset(b.center, b.radius, (i / 64) * 360);
    pts.push([p.lng, p.lat]);
  }
  return pts;
}

function boundaryGeo(b: Boundary | null | undefined, draft: LatLng[] = []): FeatureCollection {
  const features: Feature[] = [];
  if (b) features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring(b)] } });
  if (draft.length) {
    features.push({
      type: 'Feature',
      properties: { draft: 1 },
      geometry: { type: 'LineString', coordinates: draft.map((p) => [p.lng, p.lat]) },
    });
    for (const p of draft)
      features.push({ type: 'Feature', properties: { vertex: 1 }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } });
  }
  return { type: 'FeatureCollection', features };
}

function markerEl(m: MapMarker): HTMLElement {
  const el = document.createElement('div');
  el.className = 'runnn-marker';
  update(el, m);
  return el;
}

function update(el: HTMLElement, m: MapMarker) {
  const size = m.me ? 34 : 28;
  el.style.cssText = `width:${size}px;height:${size}px;border-radius:999px;display:grid;place-items:center;font-size:${size * 0.5}px;
    background:${m.color};border:3px solid ${m.me ? 'var(--color-accent)' : '#fff'};box-shadow:0 2px 6px rgba(0,0,0,.3);
    ${m.sos ? 'outline:4px solid var(--color-alarm);outline-offset:2px;' : ''}`;
  el.textContent = m.emoji;
  el.title = m.label;
}

export interface GameMapProps {
  boundary?: Boundary | null;
  markers?: MapMarker[];
  center?: LatLng | null;
  /** Draft polygon corners while drawing. */
  draft?: LatLng[];
  onTap?: (p: LatLng) => void;
  /** Re-fit the view whenever this key changes. */
  fitKey?: string | number;
  follow?: LatLng | null;
  className?: string;
  interactive?: boolean;
  onMarker?: (id: string) => void;
}

export function GameMap({ boundary, markers = [], center, draft, onTap, fitKey, follow, className, interactive = true, onMarker }: GameMapProps) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const pins = useRef(new Map<string, Marker>());
  const [loaded, setLoaded] = useState(false);
  const tap = useRef(onTap);
  tap.current = onTap;
  const markerTap = useRef(onMarker);
  markerTap.current = onMarker;

  useEffect(() => {
    if (!box.current) return;
    const start = center ?? (boundary ? (boundary.type === 'circle' ? boundary.center : boundary.points[0]) : { lat: 51.5, lng: -0.12 });
    const m = new MlMap({
      container: box.current,
      style: STYLE,
      center: [start.lng, start.lat],
      zoom: 16,
      attributionControl: { compact: true },
      interactive,
      pitchWithRotate: false,
      dragRotate: false,
    });
    m.touchZoomRotate.disableRotation();
    m.on('load', () => {
      m.addSource('area', { type: 'geojson', data: boundaryGeo(null) });
      m.addLayer({ id: 'area-fill', type: 'fill', source: 'area', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#ffc21a', 'fill-opacity': 0.14 } });
      m.addLayer({
        id: 'area-line',
        type: 'line',
        source: 'area',
        filter: ['==', '$type', 'Polygon'],
        paint: { 'line-color': '#141414', 'line-width': 3, 'line-dasharray': [2, 1.5] },
      });
      m.addLayer({ id: 'draft-line', type: 'line', source: 'area', filter: ['==', '$type', 'LineString'], paint: { 'line-color': '#141414', 'line-width': 3 } });
      m.addLayer({
        id: 'draft-pts',
        type: 'circle',
        source: 'area',
        filter: ['==', '$type', 'Point'],
        paint: { 'circle-radius': 7, 'circle-color': '#ffc21a', 'circle-stroke-color': '#141414', 'circle-stroke-width': 3 },
      });
      setLoaded(true);
    });
    m.on('click', (e: MapMouseEvent) => tap.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
    map.current = m;
    const pinMap = pins.current;
    return () => {
      pinMap.forEach((p) => p.remove());
      pinMap.clear();
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Area + draft
  useEffect(() => {
    if (!loaded) return;
    (map.current?.getSource('area') as GeoJSONSource | undefined)?.setData(boundaryGeo(boundary, draft));
  }, [loaded, boundary, draft]);

  // Fit
  useEffect(() => {
    const m = map.current;
    if (!loaded || !m || !boundary) return;
    const { min, max } = boundaryBox(boundary);
    m.fitBounds(
      [
        [min.lng, min.lat],
        [max.lng, max.lat],
      ],
      { padding: 40, duration: 0, maxZoom: 18 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, fitKey]);

  // Recenter on request
  useEffect(() => {
    if (loaded && center && !boundary) map.current?.jumpTo({ center: [center.lng, center.lat] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, center?.lat, center?.lng]);

  useEffect(() => {
    if (loaded && follow) map.current?.easeTo({ center: [follow.lng, follow.lat], duration: 600 });
  }, [loaded, follow?.lat, follow?.lng]);

  // Markers
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const seen = new Set<string>();
    for (const mk of markers) {
      seen.add(mk.id);
      const existing = pins.current.get(mk.id);
      if (existing) {
        existing.setLngLat([mk.lng, mk.lat]);
        update(existing.getElement(), mk);
      } else {
        const el = markerEl(mk);
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          markerTap.current?.(mk.id);
        });
        pins.current.set(mk.id, new Marker({ element: el }).setLngLat([mk.lng, mk.lat]).addTo(m));
      }
    }
    for (const [id, pin] of pins.current)
      if (!seen.has(id)) {
        pin.remove();
        pins.current.delete(id);
      }
  }, [markers, loaded]);

  return <div ref={box} className={cx('h-full w-full overflow-hidden bg-sunk', className)} />;
}
