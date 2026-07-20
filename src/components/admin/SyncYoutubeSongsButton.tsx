'use client';

import { useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import showToast from '@/lib/toast';

interface Missing {
  id: string;
  title: string;
  watchUrl: string;
}

/**
 * "Sync songs from YouTube" — reads the channel, lists uploads that have no
 * on-site page (dry-run gate), and creates YouTube-only pages for the ones you
 * tick. Read-only on YouTube; no S3; no lyrics. Redeploy to publish.
 */
export function SyncYoutubeSongsButton() {
  const [scanning, setScanning] = useState(false);
  const [creating, setCreating] = useState(false);
  const [missing, setMissing] = useState<Missing[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function scan() {
    setScanning(true);
    setMissing(null);
    try {
      const res = await adminFetch('/api/admin/content/sync-youtube-songs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const list: Missing[] = data.missing ?? [];
        setMissing(list);
        setSelected(new Set(list.map((m) => m.id)));
        if (list.length === 0) showToast.success('Every channel song already has a page 🎉');
      } else {
        showToast.error(data.error || 'Scan failed');
      }
    } catch {
      showToast.error('Could not scan the channel');
    } finally {
      setScanning(false);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function create() {
    setCreating(true);
    try {
      const res = await adminFetch('/api/admin/content/sync-youtube-songs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false, videoIds: [...selected] }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const n: number = data.created?.length ?? 0;
        const f: number = data.failed?.length ?? 0;
        showToast.success(`Created ${n} page${n === 1 ? '' : 's'}${f ? `, ${f} failed` : ''}. Redeploy to publish.`);
        const made = new Set<string>((data.created ?? []).map((c: { videoId: string }) => c.videoId));
        setMissing((prev) => (prev ? prev.filter((m) => !made.has(m.id)) : prev));
      } else {
        showToast.error(data.error || 'Create failed');
      }
    } catch {
      showToast.error('Could not create pages');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        onClick={scan}
        disabled={scanning || creating}
        title="Read the YouTube channel and list songs that have no on-site page yet (read-only; no S3; no lyrics)."
        className="px-4 py-3 bg-white border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-50 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {scanning ? 'Scanning…' : '🔄 Sync songs from YouTube'}
      </button>

      {missing && missing.length > 0 && (
        <div className="w-80 max-w-[80vw] rounded-lg border border-gray-200 bg-white p-4 shadow-sm text-left">
          <p className="mb-2 text-sm font-medium text-gray-900">
            {missing.length} channel song{missing.length === 1 ? '' : 's'} without a page
          </p>
          <ul className="max-h-72 space-y-1.5 overflow-y-auto">
            {missing.map((m) => (
              <li key={m.id}>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.has(m.id)}
                    onChange={() => toggle(m.id)}
                    className="h-4 w-4 shrink-0 accent-blue-600"
                  />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://i.ytimg.com/vi/${m.id}/default.jpg`}
                    alt=""
                    width={48}
                    height={27}
                    className="shrink-0 rounded"
                  />
                  <span className="font-tamil text-sm text-gray-800 line-clamp-2">{m.title}</span>
                </label>
              </li>
            ))}
          </ul>
          <button
            onClick={create}
            disabled={creating || selected.size === 0}
            className="mt-3 w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? 'Creating…' : `Create ${selected.size} page${selected.size === 1 ? '' : 's'}`}
          </button>
          <p className="mt-2 text-xs text-gray-500">Read-only on YouTube · no S3 · redeploy to publish</p>
        </div>
      )}
    </div>
  );
}
