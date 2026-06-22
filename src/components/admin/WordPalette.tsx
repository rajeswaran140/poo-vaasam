'use client';

/**
 * WordPalette — Composer writing aid backed by the Lexicon (P2).
 * Collapsed by default; on first open it loads the lexicon, then offers `fresh`
 * words to click into the lyrics, and lints the current draft for overused
 * (`retire`-flagged) words. Pure selection/lint logic lives in @/lib/word-palette.
 */

import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { adminFetch } from '@/lib/client-auth';
import { LEXICON_REGISTERS, LEXICON_THEMES } from '@/types/lexicon';
import { buildPalette, analyzeDraft, type PaletteWord } from '@/lib/word-palette';

export function WordPalette({ lyrics, onInsertWord }: { lyrics: string; onInsertWord: (word: string) => void }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [words, setWords] = useState<PaletteWord[]>([]);
  const [register, setRegister] = useState('');
  const [theme, setTheme] = useState('');
  const [includeNeutral, setIncludeNeutral] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminFetch('/api/admin/lexicon');
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || 'Failed');
      setWords(Array.isArray(d.data) ? d.data : []);
      setLoaded(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load lexicon');
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !loaded && !loading) load();
  };

  const palette = useMemo(
    () => buildPalette(words, { register: register || undefined, theme: theme || undefined, includeNeutral }),
    [words, register, theme, includeNeutral]
  );
  const draft = useMemo(() => analyzeDraft(lyrics, words), [lyrics, words]);

  return (
    <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50/40 dark:border-gray-700 dark:bg-gray-800/30">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200"
      >
        <span>🎨 Word palette</span>
        <span className="flex items-center gap-2 text-xs font-normal text-gray-500">
          {loaded && draft.overused.length > 0 && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700">{draft.overused.length} overused</span>
          )}
          {loaded && draft.freshUsed.length > 0 && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700">{draft.freshUsed.length} fresh used</span>
          )}
          <span aria-hidden>{open ? '▲' : '▼'}</span>
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-orange-200 px-3 py-3 dark:border-gray-700">
          {loading && <p className="text-xs text-gray-500">Loading lexicon…</p>}

          {loaded && (
            <>
              {/* Overused-words lint */}
              {draft.overused.length > 0 && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
                  ⚠ Overused in your draft — consider swapping:{' '}
                  <span className="font-tamil font-medium">{draft.overused.map((x) => x.word).join(', ')}</span>
                </div>
              )}

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Select value={register} onChange={setRegister} placeholder="All registers" options={LEXICON_REGISTERS} />
                <Select value={theme} onChange={setTheme} placeholder="All themes" options={LEXICON_THEMES} />
                <label className="flex items-center gap-1 text-xs text-gray-500">
                  <input type="checkbox" checked={includeNeutral} onChange={(e) => setIncludeNeutral(e.target.checked)} /> include neutral
                </label>
                <a href="/admin/lexicon" className="ml-auto text-xs text-orange-700 hover:underline dark:text-orange-400">Manage →</a>
              </div>

              {/* Fresh-word chips — click to insert into the lyrics */}
              {palette.length === 0 ? (
                <p className="text-xs text-gray-400">
                  No fresh words match. {words.length === 0 ? 'Add some in the Lexicon.' : 'Widen the filters or include neutral.'}
                </p>
              ) : (
                <div className="flex max-h-48 flex-wrap gap-1.5 overflow-auto">
                  {palette.map((p) => (
                    <button
                      key={p.word}
                      type="button"
                      onClick={() => onInsertWord(p.word)}
                      title={`${p.gloss}${p.romanization ? ` · ${p.romanization}` : ''} — click to insert`}
                      className="rounded-full border border-orange-300 bg-white px-2.5 py-1 font-tamil text-sm text-gray-800 hover:bg-orange-100 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-700"
                    >
                      {p.word}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-gray-400">{palette.length} words · click to insert at the cursor</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Select({ value, onChange, placeholder, options }: { value: string; onChange: (v: string) => void; placeholder: string; options: readonly string[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900">
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
