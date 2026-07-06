'use client';

/**
 * Admin — Shared Stories
 *
 * The "Share Your Story" inbox: memories fans submitted via /share. Filter by
 * moderation status, mark a story REVIEWED / FEATURED / ARCHIVED, or delete it.
 * A ✓ in "Feature?" means the fan consented to their story being featured.
 */

import { useCallback, useEffect, useState } from 'react';
import { MessageSquareHeart, RefreshCw, Star, Eye, Archive, Trash2 } from 'lucide-react';
import { adminFetch } from '@/lib/client-auth';
import {
  STORY_STATUSES,
  STORY_THEME_LABELS,
  type Story,
  type StoryStatus,
  type StoryTheme,
} from '@/types/story';

interface Payload {
  data: Story[];
  total: number;
  counts: Record<StoryStatus, number>;
}

type StatusFilter = 'all' | StoryStatus;

const STATUS_STYLES: Record<StoryStatus, string> = {
  NEW: 'bg-blue-100 text-blue-700',
  REVIEWED: 'bg-gray-100 text-gray-700',
  FEATURED: 'bg-amber-100 text-amber-700',
  ARCHIVED: 'bg-gray-100 text-gray-400',
};

export default function StoriesPage() {
  const [status, setStatus] = useState<StatusFilter>('all');
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // story id being mutated

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch('/api/admin/stories');
      const json = await res.json();
      if (json.success) setPayload(json);
      else setError(json.error || 'Failed to load stories');
    } catch {
      setError('Failed to load stories');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setStoryStatus = async (id: string, next: StoryStatus) => {
    setBusy(id);
    try {
      const res = await adminFetch('/api/admin/stories', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: next }),
      });
      const json = await res.json();
      if (json.success) await load();
      else setError(json.error || 'Update failed');
    } catch {
      setError('Update failed');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this story permanently?')) return;
    setBusy(id);
    try {
      const res = await adminFetch(`/api/admin/stories?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (json.success) await load();
      else setError(json.error || 'Delete failed');
    } catch {
      setError('Delete failed');
    } finally {
      setBusy(null);
    }
  };

  const rows = (payload?.data ?? []).filter((s) => status === 'all' || s.status === status);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MessageSquareHeart className="w-7 h-7 text-purple-600" />
          <h1 className="text-2xl font-bold text-gray-900">
            Shared Stories
            {payload && <span className="ml-2 text-sm font-normal text-gray-500">({rows.length} shown)</span>}
          </h1>
        </div>
        <button onClick={load} className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-700">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Summary cards */}
      {payload && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="New" value={payload.counts.NEW} tone="blue" />
          <Stat label="Reviewed" value={payload.counts.REVIEWED} tone="gray" />
          <Stat label="Featured" value={payload.counts.FEATURED} tone="amber" />
          <Stat label="Archived" value={payload.counts.ARCHIVED} tone="gray" />
        </div>
      )}

      {/* Filter */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-500">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
            <option value="all">All</option>
            {STORY_STATUSES.map((s) => (
              <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>
            ))}
          </select>
        </label>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {/* Table */}
      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : !rows.length ? (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center">
          <MessageSquareHeart className="mx-auto mb-3 h-12 w-12 text-gray-300" />
          <p className="text-gray-500">No stories for this filter.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Theme</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Story</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Feature?</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((s) => (
                <tr key={s.id} className="align-top hover:bg-gray-50">
                  <td className="px-4 py-3 font-tamil text-gray-700 whitespace-nowrap">
                    {STORY_THEME_LABELS[s.theme as StoryTheme] ?? s.theme}
                  </td>
                  <td className="px-4 py-3 text-gray-800 whitespace-nowrap">{s.name}</td>
                  <td className="px-4 py-3 text-gray-600 max-w-md">
                    <p className="whitespace-pre-wrap font-tamil">{s.story}</p>
                  </td>
                  <td className="px-4 py-3">
                    {s.email ? (
                      <a href={`mailto:${s.email}`} className="text-purple-600 hover:underline">{s.email}</a>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {s.featureConsent ? <span className="text-green-600" title="Consented">✓</span> : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[s.status]}`}>
                      {s.status.charAt(0) + s.status.slice(1).toLowerCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{s.createdAt ? new Date(s.createdAt).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button onClick={() => setStoryStatus(s.id, 'REVIEWED')} disabled={busy === s.id} title="Mark reviewed" className="rounded-lg border border-gray-200 p-1.5 text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => setStoryStatus(s.id, 'FEATURED')} disabled={busy === s.id} title="Feature" className="rounded-lg border border-amber-200 p-1.5 text-amber-600 hover:bg-amber-50 disabled:opacity-40">
                        <Star className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => setStoryStatus(s.id, 'ARCHIVED')} disabled={busy === s.id} title="Archive" className="rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-50 disabled:opacity-40">
                        <Archive className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => remove(s.id)} disabled={busy === s.id} title="Delete" className="rounded-lg border border-red-200 p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-40">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'blue' | 'gray' | 'amber' }) {
  const tones = { blue: 'text-blue-700', gray: 'text-gray-700', amber: 'text-amber-700' };
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tones[tone]}`}>{value}</p>
    </div>
  );
}
