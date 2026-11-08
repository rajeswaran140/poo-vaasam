'use client';

/**
 * Search every Google font that has English letters, for one part's English
 * font. Results show in their own font (a tiny preview download each).
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { GOOGLE_CATEGORY_LABEL, GOOGLE_FONTS, googleFontId, type GoogleCategory, type GoogleFont } from '@/lib/video-text/google-fonts';
import { loadGoogleFontPreview } from '@/lib/video-text/google-font-loader';
import type { GoogleFontId } from '@/types/videoText';

const MAX_RESULTS = 12;
const ENGLISH = GOOGLE_FONTS.filter((f) => f.latin);

export function googleFontMatches(query: string, category: GoogleCategory | '', fonts: readonly GoogleFont[] = ENGLISH): GoogleFont[] {
  const q = query.trim().toLowerCase();
  const pool = fonts.filter((f) => !category || f.category === category);
  if (!q) return pool.slice(0, MAX_RESULTS);
  const starts = pool.filter((f) => f.family.toLowerCase().startsWith(q));
  const contains = pool.filter((f) => !f.family.toLowerCase().startsWith(q) && f.family.toLowerCase().includes(q));
  return [...starts, ...contains].slice(0, MAX_RESULTS);
}

function Result({ font, onPick }: { font: GoogleFont; onPick(id: GoogleFontId): void }) {
  const [family, setFamily] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadGoogleFontPreview(font).then((f) => live && setFamily(f), () => undefined);
    return () => {
      live = false;
    };
  }, [font]);
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(googleFontId(font.family))}
        className="w-full truncate rounded px-2 py-1 text-left text-base hover:bg-orange-50 dark:hover:bg-orange-950/40"
        style={family ? { fontFamily: `${family}, sans-serif`, fontWeight: font.weight } : undefined}
      >
        {font.family}
      </button>
    </li>
  );
}

export function GoogleFontSearch({ label, onPick, onClose }: { label: string; onPick(id: GoogleFontId): void; onClose(): void }) {
  const ids = { q: useId(), cat: useId() };
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<GoogleCategory | ''>('');
  const results = useMemo(() => googleFontMatches(query, category), [query, category]);
  return (
    <div
      role="group"
      aria-label={`${label}: Google fonts`}
      className="w-full min-w-0 space-y-2 rounded-md border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-900"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <label htmlFor={ids.q} className="sr-only">
          Search Google fonts
        </label>
        <input
          id={ids.q}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${ENGLISH.length.toLocaleString()} Google fonts`}
          className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900"
          autoFocus
        />
        <label htmlFor={ids.cat} className="sr-only">
          Kind of font
        </label>
        <select
          id={ids.cat}
          value={category}
          onChange={(e) => setCategory(e.target.value as GoogleCategory | '')}
          className="min-w-0 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900"
        >
          <option value="">All kinds</option>
          {(Object.keys(GOOGLE_CATEGORY_LABEL) as GoogleCategory[]).map((c) => (
            <option key={c} value={c}>
              {GOOGLE_CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">
          Close
        </button>
      </div>
      {results.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No Google font by that name.</p>
      ) : (
        <ul className="grid min-w-0 grid-cols-1 gap-x-2 sm:grid-cols-2" aria-label="Matching fonts">
          {results.map((f) => (
            <Result key={f.family} font={f} onPick={onPick} />
          ))}
        </ul>
      )}
    </div>
  );
}
