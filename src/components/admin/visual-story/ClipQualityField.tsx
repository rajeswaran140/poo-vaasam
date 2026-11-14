'use client';

/**
 * The story's clip quality, under Style: 1080p (sharpest) or 720p (cheaper)
 * for every clip Grok makes. Saved as soon as it is changed (PATCH
 * { clipQuality }); every price in the studio follows it. A clip with faces
 * ticked is 720p either way (xAI's limit). Clips already made keep theirs.
 */

import { useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { GROK_VIDEO_USD_PER_SEC } from '@/services/video/cost';
import type { ClipQuality } from '@/types/visualStory';

const perSec = (q: ClipQuality) => `$${GROK_VIDEO_USD_PER_SEC[q].toFixed(2)} a second`;

export function ClipQualityField({ vsId, quality, onChanged }: { vsId: string; quality: ClipQuality; onChanged: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (next: ClipQuality) => {
    if (saving || next === quality) return;
    setSaving(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/visual-story/${vsId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clipQuality: next }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setError(body?.error || 'Could not save the clip quality.');
        return;
      }
      onChanged();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label htmlFor={`clip-quality-${vsId}`} className="text-gray-700 dark:text-gray-300">
        Clip quality
      </label>
      <select
        id={`clip-quality-${vsId}`}
        value={quality}
        disabled={saving}
        onChange={(e) => void save(e.target.value as ClipQuality)}
        className="min-h-11 rounded-md border border-gray-300 px-2 py-1 text-sm lg:min-h-0 dark:border-gray-600 dark:bg-gray-800"
      >
        <option value="1080p">1080p, sharpest ({perSec('1080p')})</option>
        <option value="720p">720p, cheaper ({perSec('720p')})</option>
      </select>
      <span className="text-xs text-gray-500 dark:text-gray-400">Rows with faces ticked are 720p either way.</span>
      {error && (
        <p role="alert" className="w-full text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
