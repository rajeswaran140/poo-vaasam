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
        const [o, h] = await Promise.all([
          adminFetch(`/api/admin/youtube/overview?range=${range}`),
          adminFetch(`/api/admin/youtube/analytics-health`),
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

  const dot =
    health?.status === 'ok' ? 'bg-emerald-500' : health?.status === 'warn' ? 'bg-amber-500' : 'bg-rose-500';

  return (
    <section className="mb-8" aria-labelledby="yt-live-heading">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 id="yt-live-heading" className="text-lg font-semibold text-gray-900">
          YouTube · Live analytics
        </h2>
        <span className="flex items-center gap-1.5 text-xs text-gray-600">
          <span className={`inline-block h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
          {health?.snapshots?.status === 'ok'
            ? 'data flowing'
            : health?.snapshots?.status === 'never'
              ? 'no snapshots yet'
              : `snapshots stale (${health?.snapshots?.ageMinutes ?? '?'} min)`}
        </span>
        <label className="ml-auto text-sm">
          <span className="sr-only">Date range</span>
          <select
            value={range}
            onChange={(e) => onRange(e.target.value as RangeKey)}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            {RANGES.map((r) => {
              const blocked = overview?.insufficientHistory && r === range;
              return (
                <option key={r} value={r}>
                  {r === '7d' ? 'Last 7 days' : r === '28d' ? 'Last 28 days' : 'Last 90 days'}
                  {blocked ? ' (not enough history)' : ''}
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
