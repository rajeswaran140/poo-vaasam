'use client';

/**
 * Retention Intelligence panel for /admin/youtube.
 *
 * Pick a video → fetch its owner-scoped retention curve from
 * /api/admin/youtube/retention → show a hook verdict, the key checkpoint
 * holds, a benchmark comparison, and a lightweight sparkline of the curve.
 * The analysis math lives in the pure (unit-tested) lib/youtube-retention.
 */

import { useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import type { RetentionSummary, RetentionVerdict, RetentionPoint } from '@/lib/youtube-retention';

interface RetentionResult {
  success: boolean;
  videoId: string;
  hasData: boolean;
  benchmarkId: string | null;
  curve: RetentionPoint[];
  summary: RetentionSummary;
  verdict: RetentionVerdict;
  holdAtCheckpoint: number | null;
  benchmarkHoldAtCheckpoint: number | null;
}

const VERDICT_STYLE: Record<RetentionVerdict, { label: string; cls: string }> = {
  strong: { label: 'Strong hook', cls: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300' },
  average: { label: 'Average hook', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300' },
  weak: { label: 'Weak hook — fix the first 15s', cls: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300' },
  unknown: { label: 'Not enough data yet', cls: 'bg-gray-100 text-gray-700 dark:bg-gray-700/40 dark:text-gray-300' },
};

const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);

export function RetentionInsightPanel({
  videos,
  benchmark,
  ytaConfigured,
}: {
  videos: Array<{ id: string; title: string; durationSeconds: number }>;
  benchmark?: { id: string; title: string };
  ytaConfigured: boolean;
}) {
  const [videoId, setVideoId] = useState(videos[0]?.id ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RetentionResult | null>(null);

  async function analyze() {
    const video = videos.find((v) => v.id === videoId);
    if (!video) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const qs = new URLSearchParams({ videoId: video.id, duration: String(video.durationSeconds) });
      if (benchmark && benchmark.id !== video.id) qs.set('benchmarkId', benchmark.id);
      // adminFetch attaches the Cognito ID token as a Bearer header — required:
      // Amplify keeps the token in browser storage, so a cookie-only fetch isn't
      // reliably authenticated and the route 401s (this panel's "not working").
      const res = await adminFetch(`/api/admin/youtube/retention?${qs.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Request failed (${res.status})`);
      setResult(json as RetentionResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  if (!ytaConfigured) {
    return (
      <section aria-labelledby="retention-heading" className="space-y-2">
        <h2 id="retention-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">Retention intelligence</h2>
        <p className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20 p-4 text-sm text-amber-900 dark:text-amber-200">
          Connect YouTube Analytics (OAuth) to analyse per-video retention.
        </p>
      </section>
    );
  }

  const v = VERDICT_STYLE[result?.verdict ?? 'unknown'];

  return (
    <section aria-labelledby="retention-heading" className="space-y-3">
      <div>
        <h2 id="retention-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">Retention intelligence</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          The verdict is anchored on the <strong>10% checkpoint</strong>
          {benchmark ? <> vs your best-retention video, <em>{benchmark.title}</em></> : null}. The first 15s is the lever.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <span className="sr-only">Choose a video</span>
          <select
            value={videoId}
            onChange={(e) => setVideoId(e.target.value)}
            className="max-w-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm text-gray-900 dark:text-gray-100"
          >
            {videos.map((vid) => (
              <option key={vid.id} value={vid.id}>{vid.title}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={analyze}
          disabled={loading || !videoId}
          className="rounded-lg bg-orange-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
        >
          {loading ? 'Analysing…' : 'Analyse retention'}
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/20 px-3 py-2 text-xs text-red-800 dark:text-red-200">
          {error}
        </p>
      )}

      {result && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${v.cls}`}>{v.label}</span>
            {result.hasData && result.benchmarkHoldAtCheckpoint != null && result.holdAtCheckpoint != null && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                holds {pct(result.holdAtCheckpoint)} at 10% vs benchmark {pct(result.benchmarkHoldAtCheckpoint)}
              </span>
            )}
          </div>

          {!result.hasData ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No finalized retention data yet — a new upload needs ~1–3 days before the curve is available.
            </p>
          ) : (
            <>
              {/* checkpoint table */}
              <dl className="grid grid-cols-3 gap-3 sm:grid-cols-7">
                {([
                  ['First 15s', result.summary.hold15s],
                  ['First 30s', result.summary.hold30s],
                  ['5%', result.summary.hold5pct],
                  ['10%', result.summary.hold10pct],
                  ['25%', result.summary.hold25pct],
                  ['50%', result.summary.hold50pct],
                  ['End', result.summary.holdEnd],
                ] as const).map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-gray-50 dark:bg-gray-800/50 p-2 text-center">
                    <dt className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</dt>
                    <dd className="text-base font-bold tabular-nums text-gray-900 dark:text-gray-100">{pct(value)}</dd>
                  </div>
                ))}
              </dl>

              {/* sparkline of the curve */}
              <div aria-hidden className="flex h-16 items-end gap-px">
                {result.curve.map((p, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-t bg-orange-400/70 dark:bg-orange-500/60"
                    style={{ height: `${Math.max(2, Math.min(100, p.watchRatio * 100))}%` }}
                    title={`${Math.round(p.ratio * 100)}%: ${pct(p.watchRatio)}`}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
