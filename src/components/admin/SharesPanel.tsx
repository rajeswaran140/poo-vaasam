'use client';

/**
 * Song share leaderboard on /admin/youtube — per-song shares (YouTube's native
 * Share button) + a shares-per-1k-views RATE. Toggle between ranking by absolute
 * shares (reach) and by rate (share-worthiness).
 *
 * Every song above the views floor is measured, not just the biggest ones — the
 * rate ranking is only meaningful if a modest, heavily-forwarded song can
 * actually appear in it. A share count we failed to read shows as "—", never 0.
 */

import { useState, useEffect, useCallback } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { DataToolbar } from '@/components/admin/DataToolbar';
import type { ExportColumn } from '@/lib/data-export';

interface ShareRow {
  videoId: string;
  title: string;
  views: number;
  shares: number | null;
  sharesPer1k: number | null;
}

interface SharesResponse {
  rows: ShareRow[];
  candidatesConsidered: number;
  minViews: number;
  failedVideoIds: string[];
}

const numberFmt = new Intl.NumberFormat('en-US');
const fmt = (n: number | null) => (n === null ? '—' : numberFmt.format(n));

const COLUMNS: ExportColumn<ShareRow>[] = [
  { header: 'Song', get: (r) => r.title },
  { header: 'Views', get: (r) => r.views },
  { header: 'Shares', get: (r) => (r.shares === null ? '' : r.shares) },
  { header: 'Shares/1k', get: (r) => (r.sharesPer1k === null ? '' : r.sharesPer1k) },
];

/** Unknowns sort last in both modes — a failed read must never look like the quietest song. */
const rank = (a: ShareRow, b: ShareRow, by: 'shares' | 'rate'): number => {
  const av = by === 'rate' ? a.sharesPer1k : a.shares;
  const bv = by === 'rate' ? b.sharesPer1k : b.shares;
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  return bv - av;
};

export function SharesPanel({ ytaConfigured }: { ytaConfigured: boolean }) {
  const [data, setData] = useState<SharesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'shares' | 'rate'>('shares');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch('/api/admin/youtube/shares?days=90');
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Failed (${res.status})`);
      setData({
        rows: (json.rows ?? []) as ShareRow[],
        candidatesConsidered: json.candidatesConsidered ?? 0,
        minViews: json.minViews ?? 0,
        failedVideoIds: json.failedVideoIds ?? [],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ytaConfigured) load();
  }, [ytaConfigured, load]);

  if (!ytaConfigured) {
    return (
      <section aria-labelledby="shares-heading" className="space-y-2">
        <h2 id="shares-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Song shares
        </h2>
        <p className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20 p-4 text-sm text-amber-900 dark:text-amber-200">
          Connect YouTube Analytics (OAuth) to see per-song share counts.
        </p>
      </section>
    );
  }

  const sorted = data ? [...data.rows].sort((a, b) => rank(a, b, sortBy)) : [];

  return (
    <section aria-labelledby="shares-heading" className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <h2 id="shares-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Song shares <span className="text-sm font-normal text-gray-400">(90d)</span>
        </h2>
        {data && <DataToolbar title="Song shares (90d)" filename="tamilagaval-song-shares-90d" columns={COLUMNS} rows={sorted} />}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Shares via <strong>YouTube&apos;s own Share button</strong> (copy-link forwarding isn&apos;t counted, so this
        is a floor). <strong>Shares/1k</strong> = share-worthiness independent of reach — which songs people feel
        compelled to pass on. This measures outbound <em>intent</em>; for whether a share actually brought anyone
        back, see the WhatsApp referral coefficient above.
      </p>

      <div className="flex gap-2 text-xs">
        <span className="text-gray-400">Rank by:</span>
        <button type="button" onClick={() => setSortBy('shares')} className={sortBy === 'shares' ? 'font-semibold text-orange-600' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}>
          Total shares
        </button>
        <span className="text-gray-300">·</span>
        <button type="button" onClick={() => setSortBy('rate')} className={sortBy === 'rate' ? 'font-semibold text-orange-600' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}>
          Share rate (/1k)
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/20 px-3 py-2 text-xs text-red-800 dark:text-red-200">{error}</p>
      )}
      {loading && <p className="text-sm text-gray-500">Loading…</p>}

      {data && data.failedVideoIds.length > 0 && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          {data.failedVideoIds.length} song{data.failedVideoIds.length === 1 ? '' : 's'} shown as “—”: YouTube didn&apos;t
          return a share count (usually throttling). That is <strong>not</strong> a zero — re-run to retry.
        </p>
      )}

      {data && (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/60 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Song</th>
                  <th className="px-3 py-2 text-right">Views</th>
                  <th className="px-3 py-2 text-right">Shares</th>
                  <th className="px-3 py-2 text-right">Shares/1k</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {sorted.map((r, i) => (
                  <tr key={r.videoId}>
                    <td className="px-3 py-2 tabular-nums text-gray-400">{i + 1}</td>
                    <td className="px-3 py-2 font-tamil text-gray-900 dark:text-gray-100"><span className="line-clamp-1 max-w-[18rem]">{r.title}</span></td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500 dark:text-gray-400">{numberFmt.format(r.views)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{fmt(r.shares)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.sharesPer1k === null ? '—' : r.sharesPer1k}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400">
            {numberFmt.format(data.candidatesConsidered)} songs measured (every song with ≥{numberFmt.format(data.minViews)} views
            in the window, so a modest-but-forwarded song can still top the rate ranking).
          </p>
        </>
      )}
    </section>
  );
}
