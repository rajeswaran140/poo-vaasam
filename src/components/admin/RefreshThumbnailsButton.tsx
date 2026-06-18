'use client';

/**
 * Admin "Refresh thumbnails" button. Re-mirrors the channel's video thumbnails
 * from YouTube (overwriting the once-only S3 cache) so /videos reflects a
 * thumbnail you changed on YouTube — e.g. swapped to a Tamil custom thumbnail.
 * The new images show via CloudFront within a few minutes.
 */

import { useState } from 'react';
import { ImageDown } from 'lucide-react';
import { adminFetch } from '@/lib/client-auth';

export function RefreshThumbnailsButton() {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    setMsg(null);
    try {
      const res = await adminFetch('/api/admin/youtube/refresh-thumbnails', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
      setMsg(`Refreshed ${body.refreshed}/${body.total}${body.failed ? ` (${body.failed} failed)` : ''} — live in ~5 min`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-md border border-orange-300 bg-white px-2.5 py-1 text-xs font-medium text-orange-800 hover:bg-orange-50 disabled:opacity-60 dark:border-orange-700 dark:bg-gray-900 dark:text-orange-300 dark:hover:bg-gray-800"
        title="Re-pull thumbnails from YouTube (use after changing a thumbnail there)"
      >
        <ImageDown className={`h-3 w-3 ${loading ? 'animate-pulse' : ''}`} aria-hidden />
        {loading ? 'Refreshing…' : 'Refresh thumbnails'}
      </button>
      {msg && <p className="mt-1 text-xs text-green-700 dark:text-green-400">{msg}</p>}
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
