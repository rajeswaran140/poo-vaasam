'use client';

/**
 * Admin — Lyrics gate manager.
 *
 * Lists every song and lets you (a) toggle whether its lyrics show on the public
 * /lyrics pages (behind the email gate) and (b) edit the lyrics body inline.
 * The public pages are built at deploy time, so a newly cleared song goes live
 * on the next deploy. Backed by /api/admin/lyrics (adminFetch = Cognito Bearer).
 */

import { useCallback, useEffect, useState } from 'react';
import { ScrollText, RefreshCw, Eye, EyeOff, Pencil, X, Check } from 'lucide-react';
import { adminFetch } from '@/lib/client-auth';

interface SongRow {
  id: string;
  title: string;
  titleSlug: string;
  hasBody: boolean;
  showLyrics: boolean;
  status: string;
}

export default function AdminLyricsPage() {
  const [rows, setRows] = useState<SongRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // song id being mutated
  const [editing, setEditing] = useState<string | null>(null); // song id being edited
  const [draft, setDraft] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch('/api/admin/lyrics');
      const json = await res.json();
      if (json.success) setRows(json.data);
      else setError(json.error || 'Failed to load songs');
    } catch {
      setError('Failed to load songs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patch = async (id: string, patch: { showLyrics?: boolean; body?: string }) => {
    setBusy(id);
    setError(null);
    try {
      const res = await adminFetch('/api/admin/lyrics', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      });
      const json = await res.json();
      if (json.success) {
        await load();
        return true;
      }
      setError(json.error || 'Update failed');
      return false;
    } catch {
      setError('Update failed');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const openEditor = async (row: SongRow) => {
    setEditing(row.id);
    setDraft('');
    // Load the current lyrics body from the admin API (?id=<id>) so the editor
    // starts from the existing words rather than blank.
    try {
      const res = await adminFetch(`/api/admin/lyrics?id=${encodeURIComponent(row.id)}`);
      const json = await res.json().catch(() => ({}));
      if (json?.success && json.song) setDraft(json.song.body || '');
    } catch {
      /* start with an empty editor */
    }
  };

  const saveEditor = async (id: string) => {
    const ok = await patch(id, { body: draft });
    if (ok) setEditing(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ScrollText className="h-7 w-7 text-purple-600" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Lyrics · பாடல் வரிகள்
            {rows.length > 0 && (
              <span className="ml-2 text-sm font-normal text-gray-500">({rows.length} songs)</span>
            )}
          </h1>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-700"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
        Toggle “Show on lyrics page” to publish a song’s lyrics behind the email
        gate on <code className="rounded bg-gray-100 px-1 dark:bg-gray-800">/lyrics</code>. Public
        pages are built at deploy time — a change goes live on the next deploy.
      </p>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center dark:border-gray-800 dark:bg-gray-900">
          <ScrollText className="mx-auto mb-3 h-12 w-12 text-gray-300" />
          <p className="text-gray-500">No songs found.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500 dark:bg-gray-800/50">
              <tr>
                <th className="px-4 py-3 font-medium">Song</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Lyrics</th>
                <th className="px-4 py-3 font-medium">On lyrics page</th>
                <th className="px-4 py-3 text-right font-medium">Edit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {rows.map((s) => (
                <tr key={s.id} className="align-top hover:bg-gray-50 dark:hover:bg-gray-800/40">
                  <td className="px-4 py-3">
                    <div className="font-tamil font-medium text-gray-900 dark:text-gray-100">{s.title}</div>
                    <div className="text-xs text-gray-400">{s.titleSlug || '—'}</div>
                    {editing === s.id && (
                      <div className="mt-3">
                        <textarea
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          rows={10}
                          className="w-full min-w-[20rem] rounded-lg border border-gray-300 bg-white p-3 font-tamil text-sm text-gray-900 focus:border-purple-500 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                          placeholder="பாடல் வரிகள்…"
                        />
                        <div className="mt-2 flex gap-2">
                          <button
                            onClick={() => saveEditor(s.id)}
                            disabled={busy === s.id}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-40"
                          >
                            <Check className="h-3.5 w-3.5" /> Save lyrics
                          </button>
                          <button
                            onClick={() => setEditing(null)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300"
                          >
                            <X className="h-3.5 w-3.5" /> Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{s.status}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        s.hasBody ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {s.hasBody ? 'Has lyrics' : 'No lyrics'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => patch(s.id, { showLyrics: !s.showLyrics })}
                      disabled={busy === s.id || (!s.hasBody && !s.showLyrics)}
                      title={!s.hasBody && !s.showLyrics ? 'Add lyrics first' : undefined}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-40 ${
                        s.showLyrics
                          ? 'border-green-200 text-green-700 hover:bg-green-50'
                          : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {s.showLyrics ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                      {s.showLyrics ? 'Shown' : 'Hidden'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => (editing === s.id ? setEditing(null) : openEditor(s))}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300"
                    >
                      <Pencil className="h-3.5 w-3.5" /> {editing === s.id ? 'Close' : 'Edit lyrics'}
                    </button>
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
