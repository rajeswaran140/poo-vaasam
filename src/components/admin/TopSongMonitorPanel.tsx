'use client';

/**
 * Top-10 Song Monitor — Raj's four-metric decision tree on /admin/youtube.
 *
 * Auto-loads each top song's views + watch-time deltas (recent vs prior window)
 * and diagnoses distribution vs CTR vs satisfaction; a form logs the Studio-only
 * impressions + CTR (which the Analytics API can't return) so the CTR case can
 * be told apart too.
 */

import { useState, useEffect, useCallback } from 'react';
import { adminFetch } from '@/lib/client-auth';
import type { MonitorRow, SongDiagnosis } from '@/lib/top-song-monitor';
import { DataToolbar } from '@/components/admin/DataToolbar';
import { usePagination, PAGER_BTN } from '@/components/admin/Pager';
import type { ExportColumn } from '@/lib/data-export';

const DIAGNOSIS: Record<SongDiagnosis, { label: string; cls: string }> = {
  distribution: { label: 'Reduced reach', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  satisfaction: { label: 'Watch-time ↓', cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
  ctr: { label: 'CTR ↓', cls: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300' },
  stable: { label: 'Stable', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' },
  insufficient: { label: '—', cls: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
};

const numberFmt = new Intl.NumberFormat('en-US');
const delta = (d: number | null) => (d == null ? '' : `${d >= 0 ? '+' : ''}${d}%`);

const MONITOR_COLUMNS: ExportColumn<MonitorRow>[] = [
  { header: 'Song', get: (r) => r.title },
  { header: 'Views (7d)', get: (r) => r.views },
  { header: 'Δ views %', get: (r) => r.viewsDeltaPct ?? '' },
  { header: 'Avg watch (s)', get: (r) => r.avgViewDuration },
  { header: 'Δ watch %', get: (r) => r.watchDeltaPct ?? '' },
  { header: 'Impressions', get: (r) => r.impressions ?? '' },
  { header: 'CTR %', get: (r) => r.ctr ?? '' },
  { header: 'Diagnosis', get: (r) => DIAGNOSIS[r.diagnosis].label },
];

const deltaCls = (d: number | null) =>
  d == null ? 'text-gray-400' : d >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';

export function TopSongMonitorPanel({ ytaConfigured }: { ytaConfigured: boolean }) {
  const [rows, setRows] = useState<MonitorRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formVideo, setFormVideo] = useState('');
  const [impressions, setImpressions] = useState('');
  const [ctr, setCtr] = useState('');
  const [saving, setSaving] = useState(false);

  const { page, setPage, totalPages, pageRows, total } = usePagination(rows ?? [], 25);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch('/api/admin/youtube/top-song-monitor?days=7');
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Failed (${res.status})`);
      setRows(json.rows as MonitorRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ytaConfigured) load();
  }, [ytaConfigured, load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!formVideo) return;
    setSaving(true);
    setError(null);
    try {
      const res = await adminFetch('/api/admin/youtube/top-song-monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: formVideo, impressions: Number(impressions) || 0, ctr: Number(ctr) || 0 }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Save failed');
      setImpressions('');
      setCtr('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!ytaConfigured) {
    return (
      <section aria-labelledby="monitor-heading" className="space-y-2">
        <h2 id="monitor-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Top-10 song monitor
        </h2>
        <p className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20 p-4 text-sm text-amber-900 dark:text-amber-200">
          Connect YouTube Analytics (OAuth) to monitor your top songs&apos; reach vs engagement.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="monitor-heading" className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <h2 id="monitor-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Top-10 song monitor
        </h2>
        {rows && <DataToolbar title="Top-10 song monitor" filename="tamilagaval-top-song-monitor-7d" columns={MONITOR_COLUMNS} rows={rows} />}
      </div>
      <div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Views + watch-time per top song, last 7d vs the prior 7d, with a per-song diagnosis:
          reduced <strong>reach</strong> vs <strong>CTR</strong> vs <strong>watch-time</strong>. Impressions + CTR
          are Studio-only — log them below to unlock the CTR case.
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/40 p-3">
        <label className="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-300">
          Song
          <select value={formVideo} onChange={(e) => setFormVideo(e.target.value)} className="max-w-[16rem] rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-sm">
            <option value="">Choose…</option>
            {(rows ?? []).map((r) => (
              <option key={r.videoId} value={r.videoId}>{r.title}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-300">
          Impressions
          <input type="number" min={0} value={impressions} onChange={(e) => setImpressions(e.target.value)} placeholder="Studio #" className="w-28 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-300">
          CTR %
          <input type="number" min={0} max={100} step="0.1" value={ctr} onChange={(e) => setCtr(e.target.value)} placeholder="6.6" className="w-20 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-sm" />
        </label>
        <button type="submit" disabled={saving || !formVideo} className="rounded-lg bg-orange-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Log impressions'}
        </button>
      </form>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/20 px-3 py-2 text-xs text-red-800 dark:text-red-200">{error}</p>
      )}
      {loading && <p className="text-sm text-gray-500">Loading…</p>}

      {rows && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/60 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-3 py-2 text-left">Song</th>
                <th className="px-3 py-2 text-right">Views (7d)</th>
                <th className="px-3 py-2 text-right">Δ views</th>
                <th className="px-3 py-2 text-right">Avg watch</th>
                <th className="px-3 py-2 text-right">Δ watch</th>
                <th className="px-3 py-2 text-right">Impr / CTR</th>
                <th className="px-3 py-2 text-left">Diagnosis</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {pageRows.map((r) => (
                <tr key={r.videoId}>
                  <td className="px-3 py-2 font-tamil text-gray-900 dark:text-gray-100"><span className="line-clamp-1 max-w-[16rem]">{r.title}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums">{numberFmt.format(r.views)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${deltaCls(r.viewsDeltaPct)}`}>{delta(r.viewsDeltaPct)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.avgViewDuration}s</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${deltaCls(r.watchDeltaPct)}`}>{delta(r.watchDeltaPct)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500 dark:text-gray-400">
                    {r.impressions == null ? '—' : `${numberFmt.format(r.impressions)} / ${r.ctr}%`}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${DIAGNOSIS[r.diagnosis].cls}`}>{DIAGNOSIS[r.diagnosis].label}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalPages > 1 && (
            <nav className="flex items-center justify-end gap-2 border-t border-gray-100 dark:border-gray-800 px-3 py-2 text-xs text-gray-500 dark:text-gray-400" aria-label="Pagination">
              <span>Page {page + 1} of {totalPages} · {total} songs</span>
              <button type="button" className={PAGER_BTN} onClick={() => setPage(page - 1)} disabled={page === 0}>← Prev</button>
              <button type="button" className={PAGER_BTN} onClick={() => setPage(page + 1)} disabled={page >= totalPages - 1}>Next →</button>
            </nav>
          )}
        </div>
      )}
    </section>
  );
}
