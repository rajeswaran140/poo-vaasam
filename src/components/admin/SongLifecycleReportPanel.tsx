'use client';

/**
 * Song Lifecycle Report panel for /admin/youtube.
 *
 * Pick a song → GET /api/admin/youtube/song-report → the full self-serve report:
 * a decline DIAGNOSIS banner, lifetime summary tiles, the weekly lifecycle table,
 * the traffic-source trend (the impression proxy, with the Studio-only caveat),
 * the subscribed-vs-stranger retention split, and device mix. All computation is
 * server-side in the pure (unit-tested) lib/youtube-song-report; this only renders.
 */

import { videoKind } from '@/lib/youtube-dashboard';
import { useVideoAnalysis } from '@/components/admin/useVideoAnalysis';
import type { SongReport, DeclineVerdict } from '@/lib/youtube-song-report';

interface ReportResult {
  success: boolean;
  report: SongReport;
}

const nf = new Intl.NumberFormat('en-US');
const pct = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n)}%`);
const pct1 = (n: number | null | undefined) => (n == null ? '—' : `${n.toFixed(1)}%`);

function secs(total: number): string {
  const m = Math.floor(total / 60);
  const s = Math.round(total % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Verdict → colour + label for the diagnosis banner. */
const VERDICT_STYLE: Record<DeclineVerdict, { klass: string; tag: string }> = {
  'reach-cooldown': {
    klass: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-200',
    tag: 'Healthy',
  },
  stable: {
    klass: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-200',
    tag: 'Stable',
  },
  'engagement-decline': {
    klass: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200',
    tag: 'Investigate',
  },
  indeterminate: {
    klass: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200',
    tag: 'Unclear',
  },
};

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">{value}</div>
      {sub && <div className="text-[11px] text-gray-500 dark:text-gray-400">{sub}</div>}
    </div>
  );
}

function deltaText(d: number | null): string {
  if (d == null) return '—';
  const r = Math.round(d);
  return `${r >= 0 ? '+' : ''}${r}%`;
}

export function SongLifecycleReportPanel({
  videos,
  ytaConfigured,
}: {
  videos: Array<{ id: string; title: string; durationSeconds: number }>;
  ytaConfigured: boolean;
}) {
  const { videoId, setVideoId, loading, error, result, analyze } = useVideoAnalysis<ReportResult>(
    videos,
    (id) => `/api/admin/youtube/song-report?${new URLSearchParams({ videoId: id }).toString()}`
  );

  if (!ytaConfigured) {
    return (
      <section aria-labelledby="lifecycle-heading" className="space-y-2">
        <h2 id="lifecycle-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Song lifecycle report
        </h2>
        <p className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20 p-4 text-sm text-amber-900 dark:text-amber-200">
          Connect YouTube Analytics (OAuth) to see a song&apos;s full lifecycle report.
        </p>
      </section>
    );
  }

  const r = result?.report;
  const v = VERDICT_STYLE[r?.diagnosis.verdict ?? 'indeterminate'];

  return (
    <section aria-labelledby="lifecycle-heading" className="space-y-3">
      <div>
        <h2 id="lifecycle-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Song lifecycle report
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          One song&apos;s full story: lifetime totals, weekly lifecycle, the traffic-source trend, the
          subscriber-vs-stranger split, and a plain-language decline diagnosis.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <span className="sr-only">Choose a song</span>
          <select
            value={videoId}
            onChange={(e) => setVideoId(e.target.value)}
            className="max-w-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm text-gray-900 dark:text-gray-100"
          >
            {videos.map((vid) => (
              <option key={vid.id} value={vid.id}>
                {vid.title}
                {videoKind(vid.durationSeconds) === 'short' ? ' · Short' : ''}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={analyze}
          disabled={loading || !videoId}
          className="rounded-lg bg-orange-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Run report'}
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/20 px-3 py-2 text-xs text-red-800 dark:text-red-200">
          {error}
        </p>
      )}

      {r && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm space-y-5">
          {/* Diagnosis banner */}
          <div className={`rounded-lg border px-4 py-3 ${v.klass}`}>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-black/10 dark:bg-white/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
                {v.tag}
              </span>
              <span className="text-sm font-semibold">{r.diagnosis.headline}</span>
            </div>
            <p className="mt-1 text-xs opacity-90">{r.diagnosis.detail}</p>
          </div>

          {/* Lifetime summary tiles */}
          {r.summary ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Tile label="Views" value={nf.format(r.summary.views)} sub={`${r.ageDays}d old`} />
              <Tile label="Watch hours" value={nf.format(Math.round(r.summary.watchHours))} />
              <Tile
                label="Avg view"
                value={pct1(r.summary.averageViewPercentage)}
                sub={`${secs(r.summary.averageViewDuration)} of ${secs(r.durationSeconds)}`}
              />
              <Tile label="Net subs" value={`+${nf.format(r.summary.netSubscribers)}`} sub={`${r.summary.subscribersLost} lost`} />
              <Tile label="Likes" value={nf.format(r.summary.likes)} />
              <Tile label="Comments" value={nf.format(r.summary.comments)} />
              <Tile label="Shares" value={nf.format(r.summary.shares)} />
              <Tile
                label="Share rate"
                value={r.summary.shareRatePer1k == null ? '—' : `${r.summary.shareRatePer1k.toFixed(1)}`}
                sub="per 1k views"
              />
            </div>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400">Lifetime totals unavailable right now.</p>
          )}

          {/* Weekly lifecycle */}
          {r.weekly.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">Weekly lifecycle</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
                      <th className="py-1 pr-3 font-medium">Week</th>
                      <th className="py-1 pr-3 font-medium">Dates</th>
                      <th className="py-1 pr-3 text-right font-medium">Views</th>
                      <th className="py-1 pr-3 text-right font-medium">Net subs</th>
                      <th className="py-1 text-right font-medium">Avg view %</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-800 dark:text-gray-200">
                    {r.weekly.map((w) => (
                      <tr key={w.week} className="border-t border-gray-100 dark:border-gray-800">
                        <td className="py-1 pr-3">W{w.week}</td>
                        <td className="py-1 pr-3 text-xs text-gray-500 dark:text-gray-400">
                          {w.from} → {w.to}
                        </td>
                        <td className="py-1 pr-3 text-right tabular-nums">{nf.format(w.views)}</td>
                        <td className="py-1 pr-3 text-right tabular-nums">+{w.subscribersGained}</td>
                        <td className="py-1 text-right tabular-nums">{pct(w.averageViewPercentage)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Traffic-source trend — impression proxy */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Traffic sources <span className="font-normal text-gray-500 dark:text-gray-400">— impression proxy</span>
            </h3>
            <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20 px-2 py-1 text-[11px] text-amber-900 dark:text-amber-200">
              {r.impressionsCaveat}
            </p>
            <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
              <span>
                Owned floor (subscriber + playlist):{' '}
                <strong className="text-gray-900 dark:text-gray-100">{Math.round(r.sourceTrend.ownedSharePct)}%</strong> ({r.sourceTrend.floor})
              </span>
              <span>
                Suggested trend:{' '}
                <strong className="text-gray-900 dark:text-gray-100">{deltaText(r.sourceTrend.suggestedDeltaPct)}</strong> recent vs prior 7d
              </span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
                  <th className="py-1 pr-3 font-medium">Source</th>
                  <th className="py-1 pr-3 text-right font-medium">Lifetime</th>
                  <th className="py-1 pr-3 text-right font-medium">Share</th>
                  <th className="py-1 text-right font-medium">7d trend</th>
                </tr>
              </thead>
              <tbody className="text-gray-800 dark:text-gray-200">
                {r.sourceTrend.rows.slice(0, 8).map((s) => (
                  <tr key={s.source} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="py-1 pr-3">{s.source}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{nf.format(s.lifetimeViews)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{Math.round(s.lifetimePct)}%</td>
                    <td
                      className={`py-1 text-right tabular-nums ${
                        s.deltaPct == null ? '' : s.deltaPct < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {deltaText(s.deltaPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Subscribed split + device mix */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">Loyalty split</h3>
              <ul className="space-y-1 text-sm text-gray-800 dark:text-gray-200">
                <li className="flex justify-between">
                  <span>Subscribers</span>
                  <span className="tabular-nums">
                    {nf.format(r.subscribedSplit.subscribedViews)} · {pct(r.subscribedSplit.subscribedRetention)} watched
                  </span>
                </li>
                <li className="flex justify-between">
                  <span>Non-subscribers</span>
                  <span className="tabular-nums">
                    {nf.format(r.subscribedSplit.unsubscribedViews)} · {pct(r.subscribedSplit.unsubscribedRetention)} watched
                  </span>
                </li>
                {r.subscribedSplit.retentionGap != null && (
                  <li className="pt-1 text-xs text-gray-500 dark:text-gray-400">
                    Subscribers watch {Math.round(r.subscribedSplit.retentionGap)} points more of the song.
                  </li>
                )}
              </ul>
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">Device mix</h3>
              <ul className="space-y-1 text-sm text-gray-800 dark:text-gray-200">
                {r.deviceMix.slice(0, 4).map((d) => (
                  <li key={d.device} className="flex justify-between">
                    <span>{d.device}</span>
                    <span className="tabular-nums">
                      {nf.format(d.views)} · {Math.round(d.pct)}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
