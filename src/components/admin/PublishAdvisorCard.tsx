'use client';

/**
 * Publish Advisor card on /admin/youtube — answers "should I upload now?" at a
 * glance: a verdict, the target slot, a confidence meter, and the reasons.
 * Thin presentation over GET /api/admin/youtube/publish-advisor (the verdict is
 * computed + tested server-side; nothing is decided here).
 */

import { useState, useEffect, useCallback } from 'react';
import { adminFetch } from '@/lib/client-auth';

type Verdict = 'ship-now' | 'on-schedule' | 'let-it-ride' | 'hold-fix-content';

interface Advice {
  verdict: Verdict;
  headline: string;
  recommendedDate: string | null;
  slotLabel: string | null;
  confidence: number;
  reasons: string[];
}
interface AdvisorResponse {
  success: boolean;
  asOf: string;
  advice: Advice;
  inputs: { recentViewsPerDay: number; viewsDeclining: boolean; subsToTier2: number | null; daysSinceLastUpload: number | null };
  caveats: string[];
}

const VERDICT: Record<Verdict, { label: string; border: string; badge: string; bar: string }> = {
  'ship-now': {
    label: 'Ship now',
    border: 'border-green-300 dark:border-green-800 bg-green-50/60 dark:bg-green-900/15',
    badge: 'bg-green-500/15 text-green-700 dark:text-green-300',
    bar: 'bg-green-500',
  },
  'on-schedule': {
    label: 'On schedule',
    border: 'border-blue-200 dark:border-blue-900/40 bg-blue-50/50 dark:bg-blue-900/15',
    badge: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
    bar: 'bg-blue-500',
  },
  'let-it-ride': {
    label: 'Let it ride',
    border: 'border-amber-200 dark:border-amber-900/40 bg-amber-50/60 dark:bg-amber-900/15',
    badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    bar: 'bg-amber-500',
  },
  'hold-fix-content': {
    label: 'Hold — fix content',
    border: 'border-red-200 dark:border-red-900/40 bg-red-50/60 dark:bg-red-900/15',
    badge: 'bg-red-500/15 text-red-700 dark:text-red-300',
    bar: 'bg-red-500',
  },
};

function prettyDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function PublishAdvisorCard({
  ytaConfigured,
  initial = null,
}: {
  ytaConfigured: boolean;
  /** Server-computed advice from the dashboard page — avoids a duplicate fetch on load. */
  initial?: AdvisorResponse | null;
}) {
  const [data, setData] = useState<AdvisorResponse | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch('/api/admin/youtube/publish-advisor');
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Failed (${res.status})`);
      setData(json as AdvisorResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Server already provided the advice → no duplicate fetch on first load.
    if (ytaConfigured && !initial) load();
  }, [ytaConfigured, initial, load]);

  if (!ytaConfigured) {
    return (
      <section aria-labelledby="advisor-heading" className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20 p-5 text-sm text-amber-900 dark:text-amber-200">
        <h2 id="advisor-heading" className="mb-1 font-semibold">Publish Advisor</h2>
        <p className="text-xs">Connect YouTube Analytics (OAuth) to get a &ldquo;should I upload now?&rdquo; recommendation.</p>
      </section>
    );
  }

  const v = data ? VERDICT[data.advice.verdict] : null;

  return (
    <section aria-labelledby="advisor-heading" className={`rounded-xl border p-5 shadow-sm ${v ? v.border : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900'}`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 id="advisor-heading" className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Publish Advisor
        </h2>
        <button
          type="button"
          onClick={load}
          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
        >
          ↻ refresh
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/20 px-3 py-2 text-xs text-red-800 dark:text-red-200">{error}</p>
      )}
      {loading && !data && <p className="text-sm text-gray-500">Reading the signals…</p>}

      {data && v && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${v.badge}`}>
              {v.label}
            </span>
            <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{data.advice.headline}</p>
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-3">
            {data.advice.recommendedDate && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Target</p>
                <p className="text-xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
                  {prettyDate(data.advice.recommendedDate)}
                </p>
                {data.advice.slotLabel && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">{data.advice.slotLabel}</p>
                )}
              </div>
            )}
            <div className="min-w-[10rem] flex-1">
              <div className="mb-1 flex items-baseline justify-between">
                <p className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Confidence</p>
                <p className="text-sm font-bold tabular-nums text-gray-700 dark:text-gray-300">{data.advice.confidence}%</p>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                <div className={`h-full rounded-full ${v.bar}`} style={{ width: `${data.advice.confidence}%` }} />
              </div>
            </div>
          </div>

          <ul className="mt-4 space-y-1.5">
            {data.advice.reasons.map((r) => (
              <li key={r} className="flex gap-2 text-sm text-gray-700 dark:text-gray-300">
                <span className="mt-0.5 text-gray-400" aria-hidden>·</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>

          {data.caveats.length > 0 && (
            <p className="mt-3 text-[11px] text-gray-400">
              {data.caveats.join(' ')}
            </p>
          )}
        </>
      )}
    </section>
  );
}
