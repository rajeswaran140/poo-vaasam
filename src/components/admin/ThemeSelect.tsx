'use client';

/**
 * Inline theme picker used in the /admin/songs table. Optimistic update,
 * PATCHes the API on change, reverts + alerts on failure. Tiny on purpose —
 * the page itself is a server component, this is just the editable cell.
 */

import { useState } from 'react';
import { SONG_THEMES, SONG_THEME_LABELS, type SongTheme } from '@/config/song-themes';
import { adminFetch } from '@/lib/client-auth';

interface Props {
  songId: string;
  /** Initial effective theme (after applying any override or falling back to the config map). */
  initialTheme: SongTheme;
  /** True when this song has an explicit DB override (vs the config default). */
  hasOverride: boolean;
}

export function ThemeSelect({ songId, initialTheme, hasOverride: hasOverrideInitial }: Props) {
  const [theme, setTheme] = useState<SongTheme>(initialTheme);
  const [hasOverride, setHasOverride] = useState(hasOverrideInitial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (newTheme: SongTheme) => {
    setError(null);
    const previous = theme;
    setTheme(newTheme);
    setSaving(true);
    try {
      const res = await adminFetch(`/api/admin/songs/${songId}/theme`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: newTheme }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
      setHasOverride(true);
    } catch (err) {
      setTheme(previous);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={theme}
        onChange={(e) => save(e.target.value as SongTheme)}
        disabled={saving}
        aria-label="Theme"
        className={`rounded border px-2 py-1 text-xs font-tamil ${
          hasOverride ? 'border-orange-300 bg-orange-50' : 'border-gray-300 bg-white'
        } disabled:opacity-60`}
        title={hasOverride ? 'DB override active' : 'Default from config'}
      >
        {SONG_THEMES.map((t) => (
          <option key={t} value={t}>{SONG_THEME_LABELS[t]}</option>
        ))}
      </select>
      {saving && <span className="text-[10px] text-gray-400">…</span>}
      {error && <span className="text-[10px] text-red-600" title={error}>!</span>}
    </div>
  );
}
