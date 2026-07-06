'use client';

/**
 * Monetization & YPP gates panel for /admin/analytics.
 *
 * Fetches GET /api/admin/youtube/monetization (adminFetch/Bearer) and renders
 * the two YouTube Partner Program tiers as subscriber + watch-hour progress
 * bars with ETAs, plus an estimated-revenue line. The revenue line degrades
 * gracefully: the current OAuth grant lacks the monetary scope so revenue
 * arrives as { ok:false } — we show a "re-auth" note instead of crashing.
 *
 * All the gate math lives in the pure, unit-tested lib/ypp-gates; this is
 * presentation only.
 */

import { useEffect, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import type { YppGates, TierProgress, GateAxis } from '@/lib/ypp-gates';

type RevenueResult =
  | { ok: true; data: { estimatedRevenue: number; days: number } }
  | { ok: false; error: string };

interface Payload {
  success: boolean;
  configured: boolean;
  subscribers: number | null;
  watchHours365: number | null;
  pace: { netSubsPerDay: number; watchHoursPerDay: number } | null;
  gates: YppGates | null;
  revenue: RevenueResult;
}

const nf = new Intl.NumberFormat('en-US');
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** "~N weeks" (or "~N days" under a fortnight) for a day count. */
function etaLabel(days: number | null): string | null {
  if (days == null) return null;
  if (days <= 0) return null;
  if (days < 14) return `~${days} day${days === 1 ? '' : 's'}`;
  return `~${Math.round(days / 7)} weeks`;
}

export function MonetizationPanel() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await adminFetch('/api/admin/youtube/monetization');
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
        if (alive) setPayload(body as Payload);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section
      aria-labelledby="monetization-heading"
      className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
    >
      <h2 id="monetization-heading" className="text-sm font-semibold text-gray-900 dark:text-white">
        Monetization &amp; YPP gates
      </h2>

      {loading && <p className="mt-3 text-sm text-gray-500">Loading…</p>}
      {error && (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </div>
      )}

      {payload && !loading && (
        <div className="mt-3 space-y-4">
          {!payload.configured && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
              Connect YouTube Analytics OAuth to track watch-hours — showing subscriber count only.
            </div>
          )}

          {payload.gates ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <TierCard
                title="Tier 1 · Fan-Funding"
                sub="Super Thanks · memberships · Shopping"
                tier={payload.gates.tier1}
              />
              <TierCard
                title="Tier 2 · Ad-Revenue"
                sub="mid/pre-roll ads (AdSense)"
                tier={payload.gates.tier2}
              />
            </div>
          ) : (
            <p className="text-sm text-gray-400">Channel stats unavailable right now.</p>
          )}

          <RevenueLine revenue={payload.revenue} />
        </div>
      )}
    </section>
  );
}

function TierCard({ title, sub, tier }: { title: string; sub: string; tier: TierProgress }) {
  const eta = etaLabel(tier.etaDays);
  const bindingIsSubs = !tier.subs.met; // subs is the headline gap when unmet
  return (
    <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            {title} {tier.met && <span aria-label="unlocked">✅</span>}
          </p>
          <p className="text-[11px] text-gray-400">{sub}</p>
        </div>
        {!tier.met && eta && (
          <span className="shrink-0 text-xs font-medium text-orange-600 dark:text-orange-400">
            {eta} to {bindingIsSubs ? `${nf.format(tier.subs.target)} subs` : `${nf.format(tier.hours.target)} hrs`}
          </span>
        )}
      </div>
      <div className="mt-3 space-y-3">
        <ProgressBar label="Subscribers" axis={tier.subs} unit="subs" />
        <ProgressBar label="Watch-hours (365d)" axis={tier.hours} unit="hrs" />
      </div>
    </div>
  );
}

function ProgressBar({ label, axis, unit }: { label: string; axis: GateAxis; unit: string }) {
  const pct = Math.round(axis.pct);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-gray-600 dark:text-gray-300">
          {label} {axis.met && <span aria-hidden>✅</span>}
        </span>
        <span className="tabular-nums text-gray-500 dark:text-gray-400">
          {nf.format(axis.current)} / {nf.format(axis.target)} {unit} · {pct}%
        </span>
      </div>
      <div
        className="mt-1 h-2 rounded bg-gray-100 dark:bg-gray-700"
        role="progressbar"
        aria-label={`${label} progress`}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-2 rounded ${axis.met ? 'bg-green-500/80' : 'bg-orange-500/70'}`}
          style={{ width: `${axis.pct}%` }}
        />
      </div>
    </div>
  );
}

function RevenueLine({ revenue }: { revenue: RevenueResult }) {
  if (revenue.ok) {
    return (
      <p className="text-sm text-gray-700 dark:text-gray-200">
        Estimated revenue (last {revenue.data.days}d):{' '}
        <strong className="tabular-nums">{usd.format(revenue.data.estimatedRevenue)}</strong>{' '}
        <span className="text-xs text-gray-400">· estimate, not final earnings</span>
      </p>
    );
  }
  return (
    <p className="text-sm text-gray-400">
      Revenue needs the monetary scope — re-auth adding{' '}
      <code className="rounded bg-gray-100 px-1 text-[11px] dark:bg-gray-700">yt-analytics-monetary.readonly</code>{' '}
      to show earnings.
    </p>
  );
}
