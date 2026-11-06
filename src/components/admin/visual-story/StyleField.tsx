'use client';

/**
 * The story's Style, under the title: one line added to every picture and
 * clip request and given to the storyboard draft, so the look stays the same
 * from shot to shot. Edit saves it with PATCH { style }; an empty save clears
 * it. Pictures and clips already made keep the look they were made with.
 */

import { useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { MAX_STYLE_CHARS } from '@/lib/visual-story-style';

const BUTTON = 'min-h-11 rounded-md border px-3 py-1 text-sm lg:min-h-0';

export function StyleField({ vsId, style, onChanged }: { vsId: string; style: string; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(style);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/visual-story/${vsId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ style: draft.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setError(body?.error || 'Could not save the style.');
        return;
      }
      setEditing(false);
      onChanged();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-700 dark:text-gray-300">
          Style:{' '}
          {style ? <span className="font-medium">{style}</span> : <span className="text-gray-500 dark:text-gray-400">none set</span>}
        </span>
        <button
          type="button"
          onClick={() => {
            setDraft(style);
            setError(null);
            setEditing(true);
          }}
          className={`${BUTTON} border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-300`}
        >
          {style ? 'Edit style' : 'Set style'}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={save} aria-label="Story style" className="space-y-2">
      <label className="block text-sm text-gray-700 dark:text-gray-300">
        Style
        <input
          type="text"
          value={draft}
          maxLength={MAX_STYLE_CHARS}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. warm cinematic film, golden-hour light, 35mm"
          className="mt-1 block w-full max-w-xl rounded-md border border-gray-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-800"
        />
      </label>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Used for new pictures, clips and drafts; ones already made keep their look. Leave it empty for no style.
      </p>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className={`${BUTTON} border-blue-600 bg-blue-600 font-medium text-white disabled:opacity-50`}>
          {saving ? 'Saving…' : 'Save style'}
        </button>
        <button type="button" onClick={() => setEditing(false)} className={`${BUTTON} border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-300`}>
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </form>
  );
}
