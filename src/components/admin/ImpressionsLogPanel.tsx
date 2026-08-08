'use client';

/**
 * The IMPRESSIONS LOG on /admin/youtube — the one number no API can fetch.
 *
 * `impressions` and `impressionsClickThroughRate` are Studio-only; the Analytics
 * API returns HTTP 400 "Unknown identifier" for both. So every automated read of
 * reach here is a PROXY (suggested-video views), and every discussion of "are
 * impressions falling?" has had Raj reading Studio while the tooling read
 * something else. This panel closes that gap the only way it can be closed: he
 * types what Studio shows, dated, and from then on it can be trended and cited.
 *
 * The panel deliberately leads with the impressions-vs-CTR DIRECTION rather than
 * the raw count, because that pairing is what distinguishes a narrowing funnel
 * (impressions down, CTR up — better matched) from a real problem (both down).
 */

import { useState, useEffect, useCallback } from 'react';
import { adminFetch } from '@/lib/client-auth';

interface Row {
  entry: {
    scope: string;
    impressions: number;
    ctr: number;
    views?: number;
    windowDays: number;
    observedAt: string;
    note?: string;
  };
  impressionsChangePct: number | null;
  ctrChangePts: number | null;
  daysSincePrevious: number | null;
  reading: string;
}

const numberFmt = new Intl.NumberFormat('en-US');
const CHANNEL = 'CHANNEL';

export function ImpressionsLogPanel() {
  const [scope, setScope] = useState(CHANNEL);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [impressions, setImpressions] = useState('');
  const [ctr, setCtr] = useState('');
  const [views, setViews] = useState('');
  const [windowDays, setWindowDays] = useState('28');
  const [note, setNote] = useState('');

  const load = useCallback(async (s: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/youtube/impressions?scope=${encodeURIComponent(s)}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Failed (${res.status})`);
      setRows(json.rows as Row[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(scope);
  }, [load, scope]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await adminFetch('/api/admin/youtube/impressions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope,
          impressions: Number(impressions),
          ctr: Number(ctr),
          ...(views.trim() ? { views: Number(views) } : {}),
          windowDays: Number(windowDays) || 28,
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `Failed (${res.status})`);
      setImpressions('');
      setCtr('');
      setViews('');
      setNote('');
      await load(scope);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const latest = rows[0];

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Impressions log</h3>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        Impressions and CTR are <strong>Studio-only</strong> — no API can read them. Copy them from
        Studio → Analytics → Reach and record them here so they can be trended.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label htmlFor="imp-scope" className="text-sm text-gray-700 dark:text-gray-300">
          Scope
        </label>
        <input
          id="imp-scope"
          value={scope}
          onChange={(e) => setScope(e.target.value.trim() || CHANNEL)}
          placeholder="CHANNEL or an 11-char videoId"
          className="w-64 rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
        />
        <button
          type="button"
          onClick={() => setScope(CHANNEL)}
          className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-300"
        >
          Channel
        </button>
      </div>

      {latest && (
        <p className="mt-4 rounded bg-gray-50 p-3 text-sm text-gray-800 dark:bg-gray-900 dark:text-gray-200">
          {latest.reading}
        </p>
      )}

      <form onSubmit={save} className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <label className="text-sm">
          <span className="block text-gray-700 dark:text-gray-300">Impressions</span>
          <input
            required
            inputMode="numeric"
            value={impressions}
            onChange={(e) => setImpressions(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
          />
        </label>
        <label className="text-sm">
          <span className="block text-gray-700 dark:text-gray-300">CTR %</span>
          <input
            required
            inputMode="decimal"
            placeholder="4.2"
            value={ctr}
            onChange={(e) => setCtr(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
          />
        </label>
        <label className="text-sm">
          <span className="block text-gray-700 dark:text-gray-300">Views (optional)</span>
          <input
            inputMode="numeric"
            value={views}
            onChange={(e) => setViews(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
          />
        </label>
        <label className="text-sm">
          <span className="block text-gray-700 dark:text-gray-300">Window (days)</span>
          <input
            inputMode="numeric"
            value={windowDays}
            onChange={(e) => setWindowDays(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
          />
        </label>
        <label className="text-sm">
          <span className="block text-gray-700 dark:text-gray-300">Note</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
          />
        </label>
        <div className="col-span-2 sm:col-span-5">
          <button
            type="submit"
            disabled={saving}
            className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
          >
            {saving ? 'Saving…' : 'Record reading'}
          </button>
        </div>
      </form>

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">⚠️ {error}</p>}
      {loading && <p className="mt-3 text-sm text-gray-500">Loading…</p>}

      {!loading && rows.length === 0 && (
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
          No readings yet for this scope.
        </p>
      )}

      {rows.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-600 dark:border-gray-700 dark:text-gray-400">
                <th className="py-1 pr-3">Observed</th>
                <th className="py-1 pr-3 text-right">Impressions</th>
                <th className="py-1 pr-3 text-right">Δ</th>
                <th className="py-1 pr-3 text-right">CTR</th>
                <th className="py-1 pr-3 text-right">Δ pts</th>
                <th className="py-1 pr-3 text-right">Window</th>
                <th className="py-1">Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.entry.observedAt} className="border-b border-gray-100 dark:border-gray-700/50">
                  <td className="py-1 pr-3 text-gray-700 dark:text-gray-300">{r.entry.observedAt.slice(0, 10)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{numberFmt.format(r.entry.impressions)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">
                    {r.impressionsChangePct == null ? '—' : `${r.impressionsChangePct > 0 ? '+' : ''}${r.impressionsChangePct.toFixed(0)}%`}
                  </td>
                  <td className="py-1 pr-3 text-right tabular-nums">{r.entry.ctr.toFixed(1)}%</td>
                  <td className="py-1 pr-3 text-right tabular-nums">
                    {r.ctrChangePts == null ? '—' : `${r.ctrChangePts > 0 ? '+' : ''}${r.ctrChangePts.toFixed(1)}`}
                  </td>
                  <td className="py-1 pr-3 text-right tabular-nums">{r.entry.windowDays}d</td>
                  <td className="py-1 text-gray-600 dark:text-gray-400">{r.entry.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
