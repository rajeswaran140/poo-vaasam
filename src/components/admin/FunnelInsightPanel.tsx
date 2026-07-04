'use client';

/**
 * Viewer Conversion Funnel panel for /admin/youtube.
 *
 * Models the audience as a SaaS-style funnel (DISCOVERED → WATCHED →
 * WATCHED_2ND_SONG → RETURNED → SUBSCRIBED) at cohort level. Fetches the
 * computed model from /api/admin/youtube/funnel (adminFetch/Bearer); all the
 * math lives in the pure, unit-tested lib/youtube-funnel.
 */

import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import type { FunnelReport } from '@/lib/youtube-funnel';

const DAY_OPTIONS = [7, 28, 90] as const;
const numberFmt = new Intl.NumberFormat('en-US');

export function FunnelInsightPanel({ ytaConfigured }: { ytaConfigured: boolean }) {
  const [days, setDays] = useState<number>(28);
  const [report, setReport] = useState<FunnelReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/youtube/funnel?days=${d}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
      setReport(body as FunnelReport);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ytaConfigured) load(days);
  }, [ytaConfigured, days, load]);

  if (!ytaConfigured) {
    return (
      <section aria-labelledby="funnel-heading" className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm">
        <h2 id="funnel-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">Viewer Conversion Funnel</h2>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          Connect YouTube Analytics OAuth to model the DISCOVERED → SUBSCRIBED funnel.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="funnel-heading" className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="funnel-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Viewer Conversion Funnel
        </h2>
        <div className="flex gap-1" role="group" aria-label="Time window">
          {DAY_OPTIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              aria-pressed={days === d}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                days === d
                  ? 'bg-orange-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="text-sm text-gray-500">Loading funnel…</p>}
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
          {error}
        </div>
      )}

      {report && !loading && (
        <div className="space-y-5">
          {/* Stages */}
          <ol className="space-y-2">
            {report.stages.map((s, i) => (
              <li key={s.key} className="flex items-center gap-3">
                <span className="w-5 shrink-0 text-xs tabular-nums text-gray-400">{i + 1}</span>
                <div className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-950">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {s.label}
                      {s.proxy && <span className="ml-1 text-[10px] uppercase text-amber-600 dark:text-amber-400" title={s.note}>proxy</span>}
                    </span>
                    <span className="text-sm font-bold tabular-nums text-gray-900 dark:text-gray-100">
                      {numberFmt.format(s.value)} <span className="text-xs font-normal text-gray-500">{s.unit}</span>
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-gray-500 dark:text-gray-400">{s.note}</p>
                </div>
              </li>
            ))}
          </ol>

          {/* Leak diagnosis */}
          {report.leakiestStage && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200">
              <span className="font-semibold">Biggest leak — {report.leakiestStage.stageKey}:</span> {report.leakiestStage.reason}
            </div>
          )}

          {/* Conversions */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {report.conversions.map((c) => (
              <div key={c.key} className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                <p className="text-xs text-gray-500 dark:text-gray-400">{c.label}</p>
                <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-gray-100">
                  {c.ratePct == null ? '—' : c.key === 'watch_to_2nd_song' ? c.ratePct : `${c.ratePct}%`}
                </p>
              </div>
            ))}
          </div>

          {/* Top converters */}
          {report.topConverters.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Best subscriber-converting songs</p>
              <ul className="space-y-1 text-sm">
                {report.topConverters.map((v) => (
                  <li key={v.videoId} className="flex items-center justify-between gap-2 text-gray-700 dark:text-gray-300">
                    <span className="truncate font-mono text-xs">{v.videoId}</span>
                    <span className="tabular-nums text-gray-500">
                      {numberFmt.format(v.views)} views · <strong className="text-gray-800 dark:text-gray-200">{v.subsPer1000Views}</strong> subs/1k
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Recommendations */}
          <ul className="space-y-1 border-t border-gray-100 pt-3 dark:border-gray-800">
            {report.recommendations.map((rec, i) => (
              <li key={i} className="flex gap-2 text-sm text-gray-700 dark:text-gray-300">
                <span aria-hidden className="text-orange-500">▸</span>
                <span>{rec}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
