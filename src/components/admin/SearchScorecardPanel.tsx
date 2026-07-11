'use client';

/**
 * Search Scorecard — the manual query-discovery layer on /admin/youtube.
 *
 * For a song's tracked query set, shows each query's latest HUMAN-observed
 * position + Opportunity Score/gap (sorted biggest-opportunity first), and a
 * small form to log a fresh spot-check. Positions are what YOU observed in the
 * real (personalized) app — never a search.list API rank.
 */

import { useState, useEffect, useCallback } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { SONG_QUERY_SETS, querySetFor } from '@/config/song-search-queries';
import type { ScorecardRow } from '@/lib/search-observation-store';

export function SearchScorecardPanel() {
  const [videoId, setVideoId] = useState(SONG_QUERY_SETS[0]?.videoId ?? '');
  const [label, setLabel] = useState('');
  const [rows, setRows] = useState<ScorecardRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formQuery, setFormQuery] = useState('');
  const [position, setPosition] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [region, setRegion] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    setError(null);
    setRows(null);
    try {
      const res = await adminFetch(`/api/admin/youtube/search-observations?videoId=${encodeURIComponent(id)}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Failed (${res.status})`);
      setRows(json.scorecard as ScorecardRow[]);
      setLabel(String(json.label ?? ''));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(videoId);
  }, [videoId, load]);

  const set = querySetFor(videoId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!formQuery) return;
    setSaving(true);
    setError(null);
    try {
      const res = await adminFetch('/api/admin/youtube/search-observations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          query: formQuery,
          position: notFound ? null : Number(position) || null,
          region: region.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Save failed');
      setPosition('');
      setNotFound(false);
      await load(videoId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="scorecard-heading" className="space-y-3">
      <div>
        <h2 id="scorecard-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Search scorecard
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Log the position you actually see in YouTube search for each tracked query. Sorted by
          opportunity gap — biggest wins first. (Observed position, not an API rank.)
        </p>
      </div>

      {SONG_QUERY_SETS.length > 1 && (
        <select
          value={videoId}
          onChange={(e) => setVideoId(e.target.value)}
          className="max-w-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm text-gray-900 dark:text-gray-100"
        >
          {SONG_QUERY_SETS.map((s) => (
            <option key={s.videoId} value={s.videoId}>{s.label}</option>
          ))}
        </select>
      )}

      {/* Log a spot-check */}
      {set && (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/40 p-3">
          <label className="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-300">
            Query
            <select
              value={formQuery}
              onChange={(e) => setFormQuery(e.target.value)}
              className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-sm"
            >
              <option value="">Choose…</option>
              {set.queries.map((q) => (
                <option key={q.query} value={q.query}>{q.query}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-300">
            Position
            <input
              type="number"
              min={1}
              value={position}
              disabled={notFound}
              onChange={(e) => setPosition(e.target.value)}
              placeholder="#"
              className="w-20 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-sm disabled:opacity-50"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
            <input type="checkbox" checked={notFound} onChange={(e) => setNotFound(e.target.checked)} /> Not found
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-300">
            Region
            <input
              type="text"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="e.g. LK / IN / CA"
              className="w-28 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={saving || !formQuery}
            className="rounded-lg bg-orange-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Log'}
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/20 px-3 py-2 text-xs text-red-800 dark:text-red-200">
          {error}
        </p>
      )}

      {loading && <p className="text-sm text-gray-500">Loading…</p>}

      {rows && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
          <table className="min-w-full text-sm">
            <caption className="sr-only">{label} search scorecard</caption>
            <thead className="bg-gray-50 dark:bg-gray-800/60 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-3 py-2 text-left">Query</th>
                <th className="px-3 py-2 text-left">Intent</th>
                <th className="px-3 py-2 text-right">Position</th>
                <th className="px-3 py-2 text-right">Opportunity</th>
                <th className="px-3 py-2 text-right">Gap</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {rows.map((r) => (
                <tr key={r.query} className={r.gap >= 0.6 ? 'bg-amber-50/60 dark:bg-amber-900/10' : ''}>
                  <td className="px-3 py-2 font-tamil text-gray-900 dark:text-gray-100">{r.query}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">
                    {r.intent.replace(/_/g, ' ')}
                    {r.conversion === 'high' ? ' · ★' : ''}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.position == null ? <span className="text-gray-400">not found</span> : `#${r.position}`}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{r.opportunity.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{r.gap.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
