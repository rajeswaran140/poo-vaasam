'use client';

/**
 * Live YouTube analytics panel for /admin/analytics — the Studio Overview
 * replacement.
 *
 * Reads three endpoints, all of which serve OUR OWN stored data rather than
 * calling Google, so the browser never waits on YouTube and a Google outage
 * degrades to stale-but-present numbers:
 *   GET /api/admin/youtube/overview?range=   window totals + period deltas
 *   GET /api/admin/youtube/realtime          approx subs + views last ~48h
 *   GET /api/admin/youtube/analytics-health  status dot + dead-man check
 *
 * Three honesty rules are baked into the rendering, because every one of them
 * is a way this panel could quietly lie:
 *
 *  1. RANGES THE DATA CANNOT SUPPORT ARE DISABLED, not silently zero-padded.
 *     A period-over-period delta needs TWICE the window in history and the
 *     channel's series only starts 2026-05-22, so 90d is not computable yet.
 *     The option renders disabled with the date it becomes available.
 *  2. A NULL DELTA IS SHOWN AS "—", NEVER AS 0% OR ∞. `deltaPct` is null when
 *     the previous period was zero; printing 0% there would read as "flat"
 *     when the truth is "no basis for comparison".
 *  3. THE 48h TILE STATES ITS REAL WINDOW. If snapshots gapped, the API
 *     returns the true elapsed hours and windowExact:false, and we relabel
 *     rather than calling a 61-hour delta "48 hours".
 *
 * Direction is never colour-only — every delta carries a ▲/▼ glyph, so the
 * meaning survives both colour-blindness and a monochrome screenshot.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { resolveWindow } from '@/lib/youtube-overview';
import {
  buildScale,
  buildPath,
  provisionalFrom,
  nearestIndex,
  describeSeries,
  type SeriesPoint,
} from '@/lib/sparkline';

const RANGES = ['7d', '28d', '90d'] as const;
type RangeKey = (typeof RANGES)[number];

const STORAGE_KEY = 'ta.analytics.range';

interface MetricDelta {
  value: number;
  previous: number;
  deltaPct: number | null;
}

interface Overview {
  range: { key: string; from: string; to: string; days: number };
  metrics: {
    views: MetricDelta;
    watchTimeHours: MetricDelta;
    subscribersNet: MetricDelta & { gained: number; lost: number };
    estimatedRevenue: { value: number; currency: string } | null;
    revenueUnavailableReason: string | null;
  };
  subscribers: { count: number; asOf: string; daysSinceAnchor: number } | null;
  insufficientHistory: boolean;
  missingDays: number;
  availableFrom: string | null;
  dataStart: string;
  dataThroughDate: string;
  isPartial: boolean;
}

interface Realtime {
  subscribersApprox: number | null;
  subscribersRounded: boolean;
  views48h: number | null;
  views48hAvailable: boolean;
  windowHours: number | null;
  windowExact: boolean;
  snapshotAt: string | null;
}

interface Health {
  status: 'ok' | 'warn' | 'error';
  snapshots: { status: string; ageMinutes: number | null; staleAfterMinutes: number };
  notes: string | null;
}

/**
 * Shape guards. This panel renders ABOVE the rest of /admin/analytics, so an
 * unexpected payload here would throw during render and unmount the entire
 * page — taking GA4 stats and the monetization panel down with it. We
 * therefore validate before trusting, and degrade to an error line instead.
 */
function isOverview(x: unknown): x is Overview {
  const o = x as Overview | undefined;
  return !!o && !!o.metrics && !!o.metrics.views && !!o.range;
}
function isRealtime(x: unknown): x is Realtime {
  return !!x && typeof (x as Realtime).views48hAvailable === 'boolean';
}
function isHealth(x: unknown): x is Health {
  return !!x && !!(x as Health).snapshots;
}

const nf = new Intl.NumberFormat('en-US');
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** 201404 → "201.4K". Keeps tiles readable without hiding the real figure in the title attr. */
function compact(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return nf.format(Math.round(n * 10) / 10);
}

function DeltaLine({ delta, days }: { delta: number | null; days: number }) {
  if (delta === null) {
    return (
      <p className="mt-1 text-xs text-gray-500">
        — no comparison (previous {days} days had none)
      </p>
    );
  }
  const up = delta >= 0;
  return (
    <p
      className={`mt-1 text-xs font-medium ${up ? 'text-emerald-700' : 'text-rose-700'}`}
      // Glyph carries the direction so colour is never the only signal.
    >
      <span aria-hidden="true">{up ? '▲' : '▼'}</span>{' '}
      {Math.abs(delta).toFixed(1)}% {up ? 'more than' : 'less than'} previous {days} days
    </p>
  );
}

/**
 * Daily-views sparkline. Geometry lives in lib/sparkline (pure + tested); this
 * only renders it and handles the pointer.
 *
 * The provisional tail is DASHED because YouTube revises the last 2-3 days, and
 * a settling tail that dips is indistinguishable from a real decline unless the
 * chart says so.
 */
function Sparkline({ points, label }: { points: SeriesPoint[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 600;
  const H = 80;
  if (points.length < 2) return null;
  const scale = buildScale(points, W, H);
  const split = provisionalFrom(points);
  const solid = split < 0 ? buildPath(points, scale) : buildPath(points, scale, 0, split + 1);
  const dashed = split < 0 ? '' : buildPath(points, scale, split);
  const hoveredPoint = hover != null ? points[hover] : null;

  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
        <p className="text-xs text-gray-500" aria-hidden="true">
          {hoveredPoint
            ? `${hoveredPoint.date} — ${nf.format(Math.round(hoveredPoint.value))}`
            : `${Math.round(scale.min)}–${Math.round(scale.max)}`}
        </p>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-20 w-full touch-none"
        role="img"
        aria-label={describeSeries(points, label)}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          if (!r.width) return;
          setHover(nearestIndex(points, (e.clientX - r.left) / r.width));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {solid && (
          <path d={solid} fill="none" stroke="#7c3aed" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        )}
        {dashed && (
          <path
            d={dashed}
            fill="none"
            stroke="#7c3aed"
            strokeWidth="2"
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {hoveredPoint && (
          <circle cx={scale.x(hover as number)} cy={scale.y(hoveredPoint.value)} r="3" fill="#7c3aed" />
        )}
      </svg>
      {split >= 0 && (
        <p className="mt-1 text-xs text-gray-500">
          Dashed = last {points.length - split - 1} day(s) still settling; YouTube revises these.
        </p>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  exact,
  children,
}: {
  label: string;
  value: string;
  exact?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900" title={exact}>
        {value}
      </p>
      {children}
    </div>
  );
}

export function YouTubeLivePanel() {
  const [range, setRange] = useState<RangeKey>('28d');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [realtime, setRealtime] = useState<Realtime | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Restore the last range the operator chose.
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (saved && (RANGES as readonly string[]).includes(saved)) setRange(saved as RangeKey);
  }, []);

  const loadRealtime = useCallback(async () => {
    try {
      const r = await adminFetch(`/api/admin/youtube/realtime`);
      if (!r.ok) return;
      const j = await r.json();
      if (isRealtime(j)) setRealtime(j);
    } catch {
      /* leave the previous reading rather than blanking the tile */
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [o, h, t] = await Promise.all([
          adminFetch(`/api/admin/youtube/overview?range=${range}`),
          adminFetch(`/api/admin/youtube/analytics-health`),
          adminFetch(`/api/admin/youtube/timeseries?range=${range}&metric=views`),
        ]);
        if (!alive) return;
        if (o.ok) {
          const j = await o.json();
          if (isOverview(j)) setOverview(j);
          else setError('overview returned an unexpected shape');
        } else {
          setError((await o.json())?.error?.message ?? 'overview unavailable');
        }
        if (h.ok) {
          const j = await h.json();
          if (isHealth(j)) setHealth(j);
        }
        if (t.ok) {
          const j = await t.json();
          setSeries(Array.isArray(j?.points) ? j.points : []);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'failed to load');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [range]);

  // Realtime polls on its own cadence, paused when the tab is hidden so a
  // backgrounded dashboard doesn't poll all day. Cleared on unmount.
  useEffect(() => {
    loadRealtime();
    const tick = () => {
      if (!document.hidden) loadRealtime();
    };
    timer.current = setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      if (timer.current) clearInterval(timer.current);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [loadRealtime]);

  const onRange = (r: RangeKey) => {
    setRange(r);
    try {
      window.localStorage.setItem(STORAGE_KEY, r);
    } catch {
      /* private mode — the choice just won't persist */
    }
  };

  // An UNLOADED health check is unknown, not broken. Falling through to red +
  // "stale" meant every page load opened on a false alarm — the opposite of
  // what this dashboard is for.
  const dot = !health
    ? 'bg-gray-300'
    : health.status === 'ok'
      ? 'bg-emerald-500'
      : health.status === 'warn'
        ? 'bg-amber-500'
        : 'bg-rose-500';

  const healthLabel = !health
    ? 'checking…'
    : health.snapshots?.status === 'ok'
      ? 'data flowing'
      : health.snapshots?.status === 'never'
        ? 'no snapshots yet'
        : `snapshots stale (${health.snapshots?.ageMinutes ?? '?'} min)`;

  // Which ranges the stored history can actually support. Computed with the
  // SAME pure function the API uses, so the selector cannot disagree with the
  // payload it is about to request.
  const availability = new Map<RangeKey, { blocked: boolean; from: string | null }>();
  if (overview) {
    for (const r of RANGES) {
      const w = resolveWindow(r, overview.dataStart, overview.dataThroughDate);
      availability.set(r, { blocked: w.insufficientHistory, from: w.availableFrom });
    }
  }

  return (
    <section className="mb-8" aria-labelledby="yt-live-heading">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 id="yt-live-heading" className="text-lg font-semibold text-gray-900">
          YouTube · Live analytics
        </h2>
        <span className="flex items-center gap-1.5 text-xs text-gray-600">
          <span className={`inline-block h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
          {healthLabel}
        </span>
        <label className="ml-auto text-sm">
          <span className="sr-only">Date range</span>
          <select
            value={range}
            onChange={(e) => onRange(e.target.value as RangeKey)}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            {RANGES.map((r) => {
              const a = availability.get(r);
              const label = r === '7d' ? 'Last 7 days' : r === '28d' ? 'Last 28 days' : 'Last 90 days';
              return (
                <option key={r} value={r} disabled={a?.blocked ?? false}>
                  {label}
                  {a?.blocked ? ` — from ${a.from ?? 'later'}` : ''}
                </option>
              );
            })}
          </select>
        </label>
      </div>

      {health?.notes && (
        <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {health.notes}
        </p>
      )}

      {loading && !overview && <p className="text-sm text-gray-500">Loading…</p>}
      {error && (
        <p className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
      )}

      {overview?.insufficientHistory && (
        <p className="mb-3 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          Not enough history for a {overview.range.days}-day comparison — it needs {overview.range.days * 2} days
          and the series starts {overview.dataStart}.
          {overview.availableFrom && <> Available from <strong>{overview.availableFrom}</strong>.</>}
        </p>
      )}

      {overview && !overview.insufficientHistory && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-live="polite">
          <Tile
            label="Views"
            value={compact(overview.metrics.views.value)}
            exact={nf.format(overview.metrics.views.value)}
          >
            <DeltaLine delta={overview.metrics.views.deltaPct} days={overview.range.days} />
          </Tile>
          <Tile
            label="Watch time (hours)"
            value={compact(overview.metrics.watchTimeHours.value)}
            exact={nf.format(overview.metrics.watchTimeHours.value)}
          >
            <DeltaLine delta={overview.metrics.watchTimeHours.deltaPct} days={overview.range.days} />
          </Tile>
          <Tile
            label="Subscribers (net)"
            value={`+${nf.format(overview.metrics.subscribersNet.value)}`}
            exact={`+${overview.metrics.subscribersNet.gained} / −${overview.metrics.subscribersNet.lost}`}
          >
            <DeltaLine delta={overview.metrics.subscribersNet.deltaPct} days={overview.range.days} />
          </Tile>
          <Tile
            label="Estimated revenue"
            value={
              overview.metrics.estimatedRevenue
                ? usd.format(overview.metrics.estimatedRevenue.value)
                : '—'
            }
          >
            {!overview.metrics.estimatedRevenue && (
              <p className="mt-1 text-xs text-gray-500">
                {overview.metrics.revenueUnavailableReason ?? 'unavailable'}
              </p>
            )}
          </Tile>
        </div>
      )}

      {series.length >= 2 && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4">
          <Sparkline points={series} label="Daily views" />
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Subscribers {realtime?.subscribersRounded ? '(≈)' : ''}
          </p>
          <p
            className="mt-1 text-2xl font-semibold text-gray-900"
            title={
              realtime?.subscribersRounded
                ? 'YouTube rounds this to 3 significant figures above 1,000'
                : undefined
            }
          >
            {realtime?.subscribersApprox != null ? nf.format(realtime.subscribersApprox) : '—'}
          </p>
          {overview?.subscribers && (
            <p className="mt-1 text-xs text-gray-500">
              exact {nf.format(overview.subscribers.count)} as of {overview.subscribers.asOf}
            </p>
          )}
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Views · last {realtime?.windowHours && !realtime.windowExact ? `${realtime.windowHours}h` : '48h'}
          </p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">
            {realtime?.views48hAvailable && realtime.views48h != null ? nf.format(realtime.views48h) : '—'}
          </p>
          {!realtime?.views48hAvailable && (
            <p className="mt-1 text-xs text-gray-500">
              needs ~48h of snapshots before this can be computed
            </p>
          )}
        </div>
      </div>

      {overview && (
        <p className="mt-3 text-xs text-gray-500">
          Data through <strong>{overview.dataThroughDate}</strong>
          {overview.isPartial && ' · estimates, subject to revision (YouTube finalises 2–3 days late)'}
        </p>
      )}
    </section>
  );
}
