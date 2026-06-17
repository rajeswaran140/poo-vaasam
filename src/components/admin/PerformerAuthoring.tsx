'use client';

/**
 * PerformerAuthoring — admin editor for the gated performer assets per song.
 * Lists songs with their status; expanding a row loads the current lyrics +
 * backing track (verified-admin GET) and lets the admin edit lyrics and upload
 * a new backing track (presigned POST → PRIVATE performer-tracks/ prefix), then
 * saves via PUT /api/admin/songs/[id]/performer.
 */

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { adminFetch } from '@/lib/client-auth';

export interface PerformerAdminRow {
  id: string;
  title: string;
  status: string;
  published: boolean;
  hasLyrics: boolean;
  hasTrack: boolean;
  durationSeconds?: number;
}

function fmt(s?: number): string {
  if (!s || s <= 0) return '—';
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

export function PerformerAuthoring({ rows }: { rows: PerformerAdminRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [state, setState] = useState<Record<string, { hasLyrics: boolean; hasTrack: boolean; durationSeconds?: number }>>(
    () => Object.fromEntries(rows.map((r) => [r.id, { hasLyrics: r.hasLyrics, hasTrack: r.hasTrack, durationSeconds: r.durationSeconds }]))
  );

  if (rows.length === 0) {
    return <p className="text-gray-500">No songs found.</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Set lyrics + a karaoke backing track per song. A song becomes performable (visible in /performers) once it has
        both — and is published.
      </p>
      <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            <tr>
              <th className="px-4 py-2">Song</th>
              <th className="px-4 py-2">Lyrics</th>
              <th className="px-4 py-2">Track</th>
              <th className="px-4 py-2">Performable</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {rows.map((r) => {
              const s = state[r.id];
              const performable = r.published && s.hasLyrics && s.hasTrack;
              return (
                <tr key={r.id} className="align-top">
                  <td className="px-4 py-3">
                    <p className="font-tamil font-medium text-gray-900 dark:text-gray-100">{r.title}</p>
                    <p className="text-xs text-gray-400">{r.status}{s.durationSeconds ? ` · ${fmt(s.durationSeconds)}` : ''}</p>
                    {open === r.id && (
                      <RowEditor
                        id={r.id}
                        onSaved={(next) => setState((prev) => ({ ...prev, [r.id]: { ...prev[r.id], ...next } }))}
                      />
                    )}
                  </td>
                  <td className="px-4 py-3">{s.hasLyrics ? '✅' : '—'}</td>
                  <td className="px-4 py-3">{s.hasTrack ? '✅' : '—'}</td>
                  <td className="px-4 py-3">{performable ? <span className="text-green-600">live</span> : <span className="text-gray-400">no</span>}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setOpen(open === r.id ? null : r.id)}
                      className="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-700"
                    >
                      {open === r.id ? 'Close' : 'Edit'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowEditor({
  id,
  onSaved,
}: {
  id: string;
  onSaved: (next: { hasLyrics: boolean; hasTrack: boolean; durationSeconds?: number }) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lyrics, setLyrics] = useState('');
  const [existingKey, setExistingKey] = useState('');
  const [duration, setDuration] = useState<number | undefined>(undefined);
  const [file, setFile] = useState<File | null>(null);

  // Load current assets on mount (verified-admin GET; lyrics aren't SSR'd).
  useEffect(() => {
    let active = true;
    adminFetch(`/api/admin/songs/${id}/performer`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        if (!active) return;
        setLyrics(typeof d.lyrics === 'string' ? d.lyrics : '');
        setExistingKey(typeof d.instrumentalKey === 'string' ? d.instrumentalKey : '');
        setDuration(typeof d.instrumentalDuration === 'number' ? d.instrumentalDuration : undefined);
      })
      .catch(() => { if (active) toast.error('Could not load current assets'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);

  const onPickFile = (f: File | null) => {
    setFile(f);
    if (!f) return;
    const url = URL.createObjectURL(f);
    const audio = new Audio(url);
    audio.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(audio.duration)) setDuration(Math.round(audio.duration));
      URL.revokeObjectURL(url);
    });
  };

  /** Presigned-POST the picked file to the private performer-tracks/ prefix. */
  const uploadTrack = async (f: File): Promise<string> => {
    const presignRes = await adminFetch('/api/admin/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: f.name, contentType: f.type || 'audio/mpeg', kind: 'instrumental', size: f.size }),
    });
    const presign = await presignRes.json();
    if (!presignRes.ok || !presign?.data?.uploadUrl) throw new Error(presign?.error || 'Upload URL failed');

    const form = new FormData();
    Object.entries(presign.data.fields as Record<string, string>).forEach(([k, v]) => form.append(k, v));
    form.append('file', f);
    const s3Res = await fetch(presign.data.uploadUrl, { method: 'POST', body: form });
    if (!s3Res.ok) throw new Error('S3 upload failed');
    return presign.data.key as string;
  };

  const save = async () => {
    setSaving(true);
    try {
      let instrumentalKey = existingKey;
      if (file) instrumentalKey = await uploadTrack(file);

      const res = await adminFetch(`/api/admin/songs/${id}/performer`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lyrics, instrumentalKey, instrumentalDuration: duration ?? null }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e?.error || `HTTP ${res.status}`);
      }
      setExistingKey(instrumentalKey);
      setFile(null);
      onSaved({ hasLyrics: !!lyrics.trim(), hasTrack: !!instrumentalKey.trim(), durationSeconds: duration });
      toast.success('Saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="mt-3 text-xs text-gray-400">Loading…</p>;

  return (
    <div className="mt-3 max-w-2xl space-y-3 rounded-lg border border-orange-100 bg-orange-50/40 p-3 dark:border-gray-700 dark:bg-gray-800/40">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">Lyrics (gated — performers only)</label>
        <textarea
          value={lyrics}
          onChange={(e) => setLyrics(e.target.value)}
          rows={10}
          className="w-full rounded-md border border-gray-300 p-2 font-tamil text-sm dark:border-gray-600 dark:bg-gray-900"
          placeholder="பல்லவி…"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
          Backing track (MP3) {existingKey && !file ? <span className="text-green-600">· current track set</span> : null}
        </label>
        <input type="file" accept="audio/*" onChange={(e) => onPickFile(e.target.files?.[0] ?? null)} className="text-xs" />
        {duration ? <p className="mt-1 text-xs text-gray-400">Duration: {fmt(duration)}</p> : null}
      </div>
      <button
        onClick={save}
        disabled={saving}
        className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
