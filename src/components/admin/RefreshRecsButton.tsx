'use client';

/**
 * Admin "Refresh recommendations" button. POSTs to the recommendations route
 * (the only place the LLM runs), then refreshes the server component so the
 * dashboard re-renders the freshly cached recs. Keeps the AI call off the page
 * render path.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCw } from 'lucide-react';
import { adminFetch } from '@/lib/client-auth';

export function RefreshRecsButton({ hasExisting }: { hasExisting: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch('/api/admin/youtube/recommendations', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
      router.refresh(); // re-render the server component with the new cached recs
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
      >
        <RotateCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} aria-hidden />
        {loading ? 'Generating…' : hasExisting ? 'Refresh' : 'Generate recommendations'}
      </button>
      {error && <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
