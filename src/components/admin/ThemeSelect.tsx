'use client';

/**
 * Inline theme picker used in the /admin/songs table. Optimistic update,
 * PATCHes the API on change, reverts + announces on failure. A special
 * "Default" option clears any DB override and falls back to the static
 * config map in src/config/song-themes.ts (sends `theme: ''` to the API).
 *
 * Status announcements are wired through an `aria-live="polite"` region so
 * assistive tech hears "Saving…" / "Saved" / "Save failed: …" without the
 * visual `…`/`!` glyphs being the only signal.
 */

import { useId, useState } from 'react';
import { SONG_THEMES, SONG_THEME_LABELS, type SongTheme } from '@/config/song-themes';
import { adminFetch } from '@/lib/client-auth';

interface Props {
  songId: string;
  /** Resolved theme to show as the current selection (override wins, else config default). */
  initialTheme: SongTheme;
  /** True when this song has an explicit DB override (vs the config default). */
  hasOverride: boolean;
}

// Sentinel value for the dropdown's "fall back to config" entry. Distinct
// from any real SongTheme so it round-trips through <select>'s string value.
const RESET_VALUE = '__default__';
type PickerValue = SongTheme | typeof RESET_VALUE;

export function ThemeSelect({ songId, initialTheme, hasOverride: hasOverrideInitial }: Props) {
  const [theme, setTheme] = useState<SongTheme>(initialTheme);
  const [hasOverride, setHasOverride] = useState(hasOverrideInitial);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const statusId = useId();

  // Selected value in the <select>. When no override is active we surface the
  // "Default (configured)" sentinel so the orange highlight + label match.
  const selectValue: PickerValue = hasOverride ? theme : RESET_VALUE;

  const save = async (next: PickerValue) => {
    const previousTheme = theme;
    const previousHasOverride = hasOverride;
    const clearing = next === RESET_VALUE;

    // Optimistic UI update — pick the resolved theme for the highlight.
    if (!clearing) setTheme(next as SongTheme);
    setHasOverride(!clearing);
    setSaving(true);
    setStatus('Saving…');

    try {
      const res = await adminFetch(`/api/admin/songs/${songId}/theme`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: clearing ? '' : next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
      setStatus(clearing ? 'Reset to default' : 'Saved');
    } catch (err) {
      setTheme(previousTheme);
      setHasOverride(previousHasOverride);
      setStatus(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={selectValue}
        onChange={(e) => save(e.target.value as PickerValue)}
        disabled={saving}
        aria-label="Theme"
        aria-describedby={statusId}
        className={`rounded border px-2 py-1 text-xs font-tamil ${
          hasOverride ? 'border-orange-300 bg-orange-50' : 'border-gray-300 bg-white'
        } disabled:opacity-60`}
        title={hasOverride ? 'DB override active — pick "Default" to clear' : 'Default from config'}
      >
        <option value={RESET_VALUE}>
          {hasOverride ? '↻ Default (clear override)' : `Default · ${SONG_THEME_LABELS[theme]}`}
        </option>
        {SONG_THEMES.map((t) => (
          <option key={t} value={t}>{SONG_THEME_LABELS[t]}</option>
        ))}
      </select>
      {/* aria-live region — invisible but announced to assistive tech.
          The decorative …/! glyphs visually mirror the same state. */}
      <span id={statusId} role="status" aria-live="polite" className="sr-only">
        {status ?? ''}
      </span>
      {saving && <span aria-hidden className="text-[10px] text-gray-400">…</span>}
      {!saving && status?.startsWith('Save failed') && (
        <span aria-hidden className="text-[10px] text-red-600" title={status}>!</span>
      )}
    </div>
  );
}
