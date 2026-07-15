'use client';

/**
 * Catalogue Outlier Finder on /admin/youtube — ranks Raj's OWN songs by a
 * robust, multi-signal "Outlier Score" (relative to the channel's own norm) so
 * the proven winners can be amplified (Shorts, FB, WhatsApp, site) and their
 * title/thumbnail packaging cloned. Below the ranking, a theme rollup answers
 * "which KIND of song does my audience reward?" for choosing the next release.
 *
 * Thin presentation over GET /api/admin/youtube/outliers — all scoring/ranking/
 * theme-joining is done + tested server-side. Loads on mount (needs only the
 * Data API); when Analytics is off it ranks on the signals it has and says so.
 */

import { useState, useEffect, useCallback, Fragment } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { DataToolbar } from '@/components/admin/DataToolbar';
import type { ExportColumn } from '@/lib/data-export';
import { SONG_THEME_LABELS, type SongTheme } from '@/config/song-themes';

interface Breakdown {
  key: string;
  value: number;
  z: number;
  weight: number;
}
interface Outlier {
  videoId: string;
  title: string;
  theme: string | null;
  score: number;
  rank: number;
  isOutlier: boolean;
  breakdown: Breakdown[];
}
interface ThemeSummary {
  theme: string;
  count: number;
  meanScore: number;
  meanSignals: Record<string, number>;
  outlierCount: number;
}
interface OutliersResponse {
  success: boolean;
  asOf: string;
  window: number;
  threshold: number;
  analyticsConfigured: boolean;
  themesJoined: boolean;
  signalsAvailable: string[];
  channel: { subscriberCount: number; videoCount: number; ranked: number };
  outliers: Outlier[];
  themeSummary: ThemeSummary[];
  caveats: string[];
}

const numberFmt = new Intl.NumberFormat('en-US');
const sig = (o: Outlier, key: string): number | null =>
  o.breakdown.find((b) => b.key === key)?.value ?? null;
const fmtInt = (n: number | null) => (n == null ? '—' : numberFmt.format(Math.round(n)));
const fmt1 = (n: number | null) => (n == null ? '—' : n.toFixed(1));
const fmtRatio = (n: number | null) => (n == null ? '—' : `${n.toFixed(2)}×`);
const fmtScore = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2);

function themeLabel(theme: string | null): string {
  if (!theme || theme === '(untagged)') return 'untagged';
  return SONG_THEME_LABELS[theme as SongTheme] ?? theme;
}

/** Human labels for the "Why?" breakdown. */
const SIGNAL_LABELS: Record<string, string> = {
  viewsPerDay: 'Reach velocity (views/day)',
  subsPer1k: 'Subscriber conversion',
  retention: 'Retention',
  ctr: 'Click-through',
  engagement: 'Engagement (comments)',
  growth30d: 'Long-tail growth',
};

const COLUMNS: ExportColumn<Outlier>[] = [
  { header: 'Rank', get: (r) => r.rank },
  { header: 'Song', get: (r) => r.title },
  { header: 'Theme', get: (r) => r.theme ?? '' },
  { header: 'Score', get: (r) => r.score.toFixed(3) },
  { header: 'Outlier', get: (r) => (r.isOutlier ? 'yes' : '') },
  { header: 'Views/day', get: (r) => sig(r, 'viewsPerDay') ?? '' },
  { header: 'Subs/1k', get: (r) => sig(r, 'subsPer1k') ?? '' },
  { header: 'Retention%', get: (r) => sig(r, 'retention') ?? '' },
  { header: 'Comments/1k', get: (r) => sig(r, 'engagement') ?? '' },
  { header: 'LongTail', get: (r) => sig(r, 'growth30d') ?? '' },
];

export function OutlierFinderPanel({ ytaConfigured }: { ytaConfigured: boolean }) {
  const [data, setData] = useState<OutliersResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch('/api/admin/youtube/outliers');
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Failed (${res.status})`);
      setData(json as OutliersResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section aria-labelledby="outliers-heading" className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <h2 id="outliers-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Catalogue outliers
        </h2>
        {data && (
          <DataToolbar
            title="Catalogue outliers"
            filename="tamilagaval-catalogue-outliers"
            columns={COLUMNS}
            rows={data.outliers}
          />
        )}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Which of your songs punch <strong>above your own channel&apos;s norm</strong>. The score is a robust,
        multi-signal blend (views/day, subscriber conversion, retention, engagement) measured relative to the rest
        of the catalogue — so a genuine breakout stands out and one viral hit can&apos;t distort the yardstick.
        Use it to decide which songs to <strong>amplify</strong> (Shorts, WhatsApp, site) and whose title/thumbnail
        <strong> packaging to clone</strong> for the next upload. <span className="text-gray-400">Click any row to see
        <em> why</em> it scored.</span>
      </p>

      {!ytaConfigured && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          YouTube Analytics is off — songs are ranked on <strong>views/day + engagement</strong> only. Connect OAuth
          to add subscriber-conversion and retention to the score.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/20 px-3 py-2 text-xs text-red-800 dark:text-red-200">
          {error}
        </p>
      )}
      {loading && <p className="text-sm text-gray-500">Loading…</p>}

      {data && (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/60 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Song</th>
                  <th className="px-3 py-2 text-left">Theme</th>
                  <th className="px-3 py-2 text-right">Score</th>
                  <th className="px-3 py-2 text-right">Views/day</th>
                  <th className="px-3 py-2 text-right">Subs/1k</th>
                  <th className="px-3 py-2 text-right">Retention</th>
                  <th className="px-3 py-2 text-right">Cmnts/1k</th>
                  <th className="px-3 py-2 text-right" title="Recent 30d views/day ÷ lifetime views/day. >1× = durable long tail; <1× = spiked then cooled.">Long-tail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {data.outliers.map((o) => (
                  <Fragment key={o.videoId}>
                    <tr
                      onClick={() => setExpanded((cur) => (cur === o.videoId ? null : o.videoId))}
                      className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/40 ${o.isOutlier ? 'bg-orange-50/60 dark:bg-orange-900/10' : ''}`}
                    >
                      <td className="px-3 py-2 tabular-nums text-gray-400">
                        <span className="mr-1 text-gray-300 dark:text-gray-600" aria-hidden>{expanded === o.videoId ? '▾' : '▸'}</span>
                        {o.rank}
                      </td>
                      <td className="px-3 py-2 font-tamil text-gray-900 dark:text-gray-100">
                        <span className="line-clamp-1 max-w-[16rem]">{o.title}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-block rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 font-tamil text-xs text-gray-600 dark:text-gray-300">
                          {themeLabel(o.theme)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                        <span className={o.score >= 0 ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400'}>
                          {fmtScore(o.score)}
                        </span>
                        {o.isOutlier && (
                          <span className="ml-1.5 rounded-full bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-orange-600 dark:text-orange-300">
                            ★ outlier
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-400">{fmtInt(sig(o, 'viewsPerDay'))}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-400">{fmt1(sig(o, 'subsPer1k'))}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-400">{sig(o, 'retention') == null ? '—' : `${fmt1(sig(o, 'retention'))}%`}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-400">{fmt1(sig(o, 'engagement'))}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-400">{fmtRatio(sig(o, 'growth30d'))}</td>
                    </tr>
                    {expanded === o.videoId && (
                      <tr className="bg-gray-50/60 dark:bg-gray-900/30">
                        <td colSpan={9} className="px-4 py-3">
                          <WhyBreakdown o={o} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {data.outliers.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                      No songs to rank yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Theme rollup — which KIND of song performs, for release selection. */}
          {data.themeSummary.length > 0 && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                By theme — which kind of song wins {data.themesJoined ? '' : '(themes unavailable)'}
              </p>
              <div className="flex flex-wrap gap-2">
                {data.themeSummary.map((t) => (
                  <div key={t.theme} className="rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-2">
                    <p className="font-tamil text-sm text-gray-900 dark:text-gray-100">{themeLabel(t.theme)}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      <span className={`font-medium tabular-nums ${t.meanScore >= 0 ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400'}`}>
                        {fmtScore(t.meanScore)}
                      </span>{' '}
                      mean · {t.count} song{t.count === 1 ? '' : 's'}
                      {t.outlierCount > 0 && <> · {t.outlierCount} ★</>}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1 text-xs text-gray-400">
            <p>
              {numberFmt.format(data.channel.ranked)} songs ranked · window {data.window}d · outlier threshold{' '}
              {data.threshold} · score = robust SDs above the catalogue norm (weighted blend).
            </p>
            {data.caveats.map((c) => (
              <p key={c}>· {c}</p>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * The "Why?" breakdown for one song: each signal's CONTRIBUTION to the score =
 * its effective weight × its robust z (distance from the catalogue norm). By
 * construction these sum to the song's score, so the bars literally add up to
 * the number in the table — a diverging bar per signal, biggest driver first.
 */
function WhyBreakdown({ o }: { o: Outlier }) {
  if (o.breakdown.length === 0) {
    return (
      <p className="text-xs text-gray-500 dark:text-gray-400">
        This song sits at your catalogue norm on every measured signal — nothing pushes its score up or down.
      </p>
    );
  }
  const rows = o.breakdown
    .map((b) => ({ key: b.key, label: SIGNAL_LABELS[b.key] ?? b.key, z: b.z, contribution: b.weight * b.z }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.contribution)), 1e-9);

  return (
    <div className="space-y-2">
      <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
        Why {fmtScore(o.score)}? — each signal&apos;s push (weight × distance from your norm); the bars sum to the score
      </p>
      <ul className="space-y-1.5">
        {rows.map((r) => {
          const pos = r.contribution >= 0;
          const w = (Math.abs(r.contribution) / maxAbs) * 50; // % of each half-track
          return (
            <li key={r.key} className="flex items-center gap-2 text-xs">
              <span className="w-44 shrink-0 text-gray-700 dark:text-gray-300">{r.label}</span>
              <span className="w-14 shrink-0 text-right tabular-nums text-gray-400" title="how far above/below your catalogue norm">
                {r.z >= 0 ? '+' : ''}{r.z.toFixed(1)}σ
              </span>
              <div className="relative h-2 flex-1 rounded bg-gray-100 dark:bg-gray-800">
                <div className="absolute inset-y-0 left-1/2 w-px bg-gray-300 dark:bg-gray-600" />
                <div
                  className={`absolute inset-y-0 rounded ${pos ? 'bg-green-500' : 'bg-red-400'}`}
                  style={pos ? { left: '50%', width: `${w}%` } : { right: '50%', width: `${w}%` }}
                />
              </div>
              <span className={`w-14 shrink-0 text-right tabular-nums font-medium ${pos ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                {pos ? '+' : ''}{r.contribution.toFixed(2)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
