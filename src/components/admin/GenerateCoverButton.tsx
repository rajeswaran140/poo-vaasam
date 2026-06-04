'use client';

/**
 * Admin action: generate an AI cover image for a song (POST
 * /api/admin/songs/[id]/cover). On success, refreshes the page so the new
 * featuredImage shows. Generation takes ~10-30s.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/client-auth';

export function GenerateCoverButton({ songId, hasCover }: { songId: string; hasCover?: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'generating' | 'done' | 'error'>(hasCover ? 'done' : 'idle');
  const [error, setError] = useState('');

  const generate = async () => {
    setState('generating');
    setError('');
    try {
      const res = await adminFetch(`/api/admin/songs/${songId}/cover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
      setState('done');
      router.refresh();
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const label =
    state === 'generating' ? 'Generating…' : state === 'done' ? 'Cover ✓' : state === 'error' ? 'Retry cover' : 'Cover';

  return (
    <button
      type="button"
      onClick={generate}
      disabled={state === 'generating'}
      title={error || (state === 'done' ? 'Cover set — click to regenerate' : 'Generate an AI cover image')}
      className="text-purple-600 hover:underline disabled:opacity-50"
    >
      {label}
    </button>
  );
}
