import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip as LeafletTooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPinOff, Navigation } from 'lucide-react';
import { useTheme } from '../theme/ThemeContext';
import { useChartTheme, readCssVar } from '../utils/chartTheme';
import { normalizeLevel } from '../constants/levels';
import { formatDistanceKm, formatDuration, formatSpeed } from '../utils/format';
import '../styles/pages/evidence.css';

const TILE_URLS = {
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatCoord(lat, lng) {
  if (lat === null || lng === null) return 'Coordinates unavailable';
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

/** Points along the great circle between a and b ([lat, lng]) so the line reads as a flight path. */
function greatCircle(a, b, n = 48) {
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;
  const lat1 = rad(a[0]);
  const lon1 = rad(a[1]);
  const lat2 = rad(b[0]);
  const lon2 = rad(b[1]);
  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2
      )
    );
  if (!d || !Number.isFinite(d)) return [a, b];
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    pts.push([deg(Math.atan2(z, Math.sqrt(x * x + y * y))), deg(Math.atan2(y, x))]);
  }
  return pts;
}

/** Fits the view to the given points and keeps the map sized to its container. */
function MapController({ points }) {
  const map = useMap();
  const key = JSON.stringify(points);

  useEffect(() => {
    if (!points.length) return;
    const same =
      points.length < 2 || (points[0][0] === points[1][0] && points[0][1] === points[1][1]);
    if (same) map.setView(points[0], 10, { animate: false });
    else map.fitBounds(points, { padding: [56, 56], maxZoom: 10, animate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);

  useEffect(() => {
    const el = map.getContainer();
    if (typeof ResizeObserver === 'undefined' || !el) return undefined;
    const ro = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);

  return null;
}

function useOnline() {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine !== false
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

function MapPlaceholder({ height, stats, prevLabel, curLabel, prev, cur, reason }) {
  return (
    <div className="ev-map ev-map--placeholder" style={{ height }} role="img" aria-label={`${prevLabel} to ${curLabel}: ${stats}`}>
      <div className="ev-map-ph__route" aria-hidden="true">
        <svg viewBox="0 0 240 60" className="ev-map-ph__svg" preserveAspectRatio="xMidYMid meet">
          <line x1="30" y1="40" x2="210" y2="20" className="ev-map-ph__line" />
          <circle cx="30" cy="40" r="7" className="ev-map-ph__prev" />
          <circle cx="210" cy="20" r="14" className="ev-map-ph__halo" />
          <circle cx="210" cy="20" r="7" className="ev-map-ph__cur" />
        </svg>
      </div>
      <div className="ev-map-ph__places">
        <div className="ev-map-ph__place">
          <span className="ev-map-ph__dot ev-map-ph__dot--prev" aria-hidden="true" />
          <div>
            <div className="ev-map-ph__city">{prevLabel}</div>
            <div className="ev-map-ph__coord">{formatCoord(prev[0], prev[1])}</div>
          </div>
        </div>
        <div className="ev-map-ph__place">
          <span className="ev-map-ph__dot ev-map-ph__dot--cur" aria-hidden="true" />
          <div>
            <div className="ev-map-ph__city">{curLabel}</div>
            <div className="ev-map-ph__coord">{formatCoord(cur[0], cur[1])}</div>
          </div>
        </div>
      </div>
      <div className="ev-map-chip ev-map-chip--static">
        <Navigation size={14} strokeWidth={1.75} aria-hidden="true" />
        <span>{stats}</span>
      </div>
      <div className="ev-map-ph__note">
        <MapPinOff size={14} strokeWidth={1.75} aria-hidden="true" />
        {reason}
      </div>
    </div>
  );
}

/**
 * TravelMap — previous vs current transaction location for impossible_travel evidence.
 * Props: details (impossible_travel rule details), level (risk level), height=280.
 */
export default function TravelMap({ details, level, height = 280 }) {
  const d = details || {};
  const { theme } = useTheme() || {};
  const mode = theme === 'dark' ? 'dark' : 'light';
  const t = useChartTheme();
  const online = useOnline();
  const lvl = normalizeLevel(level) || 'HIGH';

  const [tileFailed, setTileFailed] = useState(false);
  const loadedRef = useRef(false);
  const errorsRef = useRef(0);

  useEffect(() => {
    setTileFailed(false);
    loadedRef.current = false;
    errorsRef.current = 0;
  }, [mode]);

  const prev = [toNum(d.previous_latitude), toNum(d.previous_longitude)];
  const cur = [toNum(d.current_latitude), toNum(d.current_longitude)];
  const hasCoords = prev.every((v) => v !== null) && cur.every((v) => v !== null);

  const prevLabel = d.previous_city || 'Previous location';
  const curLabel = d.current_city || 'This location';
  const stats = `${formatDistanceKm(d.distance_km)} · ${formatDuration(d.elapsed_minutes)} · ${formatSpeed(d.speed_kmh)}`;

  const colors = useMemo(
    () => ({
      level: t.level[lvl] || t.brand,
      previous: readCssVar('--map-previous', t.text3) || t.text3,
      surface: t.surface,
    }),
    [t, lvl]
  );

  const path = useMemo(
    () => (hasCoords ? greatCircle(prev, cur) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasCoords, prev[0], prev[1], cur[0], cur[1]]
  );

  if (!hasCoords || !online || tileFailed) {
    const reason = !hasCoords
      ? 'Location coordinates are not available for this transaction.'
      : !online
        ? 'You are offline — map tiles cannot load.'
        : 'Map tiles could not be loaded.';
    return (
      <MapPlaceholder
        height={height}
        stats={stats}
        prevLabel={prevLabel}
        curLabel={curLabel}
        prev={prev}
        cur={cur}
        reason={reason}
      />
    );
  }

  const tileHandlers = {
    tileload: () => {
      loadedRef.current = true;
    },
    tileerror: () => {
      errorsRef.current += 1;
      if (!loadedRef.current && errorsRef.current >= 3) setTileFailed(true);
    },
  };

  return (
    <div
      className="ev-map"
      style={{ height }}
      role="region"
      aria-label={`Map: ${prevLabel} to ${curLabel}, ${stats}`}
    >
      <MapContainer
        bounds={[prev, cur]}
        boundsOptions={{ padding: [56, 56], maxZoom: 10 }}
        scrollWheelZoom={false}
        attributionControl
        zoomControl
        className="ev-map__leaflet"
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer key={mode} url={TILE_URLS[mode]} attribution={ATTRIBUTION} subdomains="abcd" maxZoom={19} eventHandlers={tileHandlers} />
        <MapController points={[prev, cur]} />
        <Polyline
          positions={path}
          pathOptions={{ color: colors.level, weight: 2.5, opacity: 0.9, dashArray: '6 8', lineCap: 'round' }}
        />
        <CircleMarker
          center={prev}
          radius={7}
          pathOptions={{ color: colors.surface, weight: 2, fillColor: colors.previous, fillOpacity: 1 }}
        >
          <LeafletTooltip permanent direction="top" offset={[0, -8]} className="ev-map-label">
            {prevLabel}
          </LeafletTooltip>
        </CircleMarker>
        <CircleMarker
          center={cur}
          radius={18}
          interactive={false}
          pathOptions={{ stroke: false, fillColor: colors.level, fillOpacity: 0.18 }}
        />
        <CircleMarker
          center={cur}
          radius={8}
          pathOptions={{ color: colors.surface, weight: 2, fillColor: colors.level, fillOpacity: 1 }}
        >
          <LeafletTooltip permanent direction="top" offset={[0, -10]} className="ev-map-label ev-map-label--current">
            {curLabel}
          </LeafletTooltip>
        </CircleMarker>
      </MapContainer>
      <div className="ev-map-chip" aria-hidden="true">
        <Navigation size={14} strokeWidth={1.75} />
        <span>{stats}</span>
      </div>
    </div>
  );
}
