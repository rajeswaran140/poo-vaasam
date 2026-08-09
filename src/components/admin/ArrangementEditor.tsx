'use client';

/**
 * Arrangement editor — who leads each section, what plays underneath, and where
 * the instrumental breaks fall.
 *
 * WHY THIS IS MANUAL. Break placement is the weakest thing a model does here:
 * nine breaks across four verses is a decision Raj hears instantly and a model
 * guesses at. His finished songs hand ONE melody between instruments across the
 * whole piece — Theme A stated seven times with flute, violin, flute, violin,
 * then both in duet. That is orchestration, and the tool's job is to make it
 * fast to express, not to invent it.
 *
 * Reuses `splitSections` (the same blocks the duet tagger works on) and the
 * variant's own instruments, so a break can never name something the style box
 * does not carry.
 */

import { useMemo, useState } from 'react';
import { Copy, Check, Plus, X } from 'lucide-react';
import { splitSections } from '@/lib/duet-tagging';
import {
  LAYER_ROLES,
  toArrangementBlock,
  balance,
  themeStatements,
  type ArrangedSection,
  type Layer,
} from '@/lib/arrangement';

interface Props {
  lyrics: string;
  /** Instruments the chosen variant carries — the only ones offerable. */
  instruments: string[];
  /** Hands the finished block up so the export pack uses it. */
  onArranged?: (block: string) => void;
}

/** Leads offered per section: the voices, then every instrument in the variant. */
function leadOptions(instruments: string[]): string[] {
  return ['Male Lead', 'Female Lead', 'Male and Female Together', 'Instrumental',
    ...instruments.map((i) => `${i} Lead`)];
}

const BREAK_KINDS = ['Break', 'Interlude', 'Intro', 'Outro'];

export function ArrangementEditor({ lyrics, instruments, onArranged }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Sections derive from the lyric; edits are held as overrides so retyping the
  // lyric does not silently discard the arrangement for untouched sections.
  const base = useMemo<ArrangedSection[]>(
    () =>
      splitSections(lyrics).map((s) => ({
        kind: s.kind === 'chorus' ? 'Chorus' : 'Verse',
        detail: 'Male Lead',
        layers: [],
        lyrics: s.text,
      })),
    [lyrics]
  );
  const [overrides, setOverrides] = useState<Record<number, Partial<ArrangedSection>>>({});
  /** Instrumental sections the poet has inserted, keyed by the index they precede. */
  const [breaks, setBreaks] = useState<Record<number, ArrangedSection>>({});

  const sections = useMemo<ArrangedSection[]>(() => {
    const out: ArrangedSection[] = [];
    base.forEach((s, i) => {
      if (breaks[i]) out.push(breaks[i]);
      out.push({ ...s, ...overrides[i] });
    });
    if (breaks[base.length]) out.push(breaks[base.length]);
    return out;
  }, [base, overrides, breaks]);

  const block = useMemo(() => toArrangementBlock(sections), [sections]);
  const bal = useMemo(() => balance(sections), [sections]);
  const themes = useMemo(() => themeStatements(sections), [sections]);

  const set = (i: number, patch: Partial<ArrangedSection>) =>
    setOverrides((p) => ({ ...p, [i]: { ...p[i], ...patch } }));

  const setLayer = (i: number, li: number, patch: Partial<Layer>) => {
    const cur = (overrides[i]?.layers ?? base[i]?.layers ?? []).slice();
    cur[li] = { ...cur[li], ...patch };
    set(i, { layers: cur });
  };
  const addLayer = (i: number) => {
    const cur = (overrides[i]?.layers ?? base[i]?.layers ?? []).slice();
    cur.push({ instrument: instruments[0] ?? '', role: LAYER_ROLES[0] });
    set(i, { layers: cur });
  };
  const removeLayer = (i: number, li: number) => {
    const cur = (overrides[i]?.layers ?? base[i]?.layers ?? []).slice();
    cur.splice(li, 1);
    set(i, { layers: cur });
  };
  const addBreak = (at: number) =>
    setBreaks((p) => ({
      ...p,
      [at]: { kind: 'Break', detail: `${instruments[0] ?? 'Flute'} Phrase`, layers: [] },
    }));
  const removeBreak = (at: number) =>
    setBreaks((p) => {
      const n = { ...p };
      delete n[at];
      return n;
    });

  const selCls =
    'rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100';

  return (
    <section className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Arrangement</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {bal.total ? `${bal.instrumental} instrumental / ${bal.sung} sung` : 'paste lyrics first'}
        </span>
      </button>

      {open && bal.total > 0 && (
        <div className="space-y-4 border-t border-gray-200 px-4 py-4 dark:border-gray-800">
          {bal.note && (
            <p className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
              {bal.note}
            </p>
          )}

          {themes.length > 0 && (
            <div className="text-xs text-gray-600 dark:text-gray-400" data-testid="theme-statements">
              {themes.map((t) => (
                <div key={t.theme}>
                  <strong>{t.theme}</strong> — {t.leads.length} statements: {t.leads.join(' → ')}
                </div>
              ))}
            </div>
          )}

          <ol className="space-y-3">
            {base.map((s, i) => (
              <li key={i} className="rounded border border-gray-200 p-2 dark:border-gray-700">
                {breaks[i] && (
                  <div className="mb-2 flex flex-wrap items-center gap-2 rounded bg-purple-50 p-2 dark:bg-purple-950/30">
                    <select
                      value={breaks[i].kind}
                      aria-label={`break kind before section ${i + 1}`}
                      onChange={(e) => setBreaks((p) => ({ ...p, [i]: { ...p[i], kind: e.target.value } }))}
                      className={selCls}
                    >
                      {BREAK_KINDS.map((k) => (
                        <option key={k}>{k}</option>
                      ))}
                    </select>
                    <input
                      value={breaks[i].detail}
                      aria-label={`break detail before section ${i + 1}`}
                      onChange={(e) => setBreaks((p) => ({ ...p, [i]: { ...p[i], detail: e.target.value } }))}
                      className={`${selCls} w-56`}
                    />
                    <button type="button" onClick={() => removeBreak(i)} aria-label={`remove break before section ${i + 1}`}>
                      <X className="h-3.5 w-3.5 text-gray-500" />
                    </button>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-gray-400">{i + 1}</span>
                  <input
                    value={overrides[i]?.kind ?? s.kind}
                    aria-label={`section ${i + 1} kind`}
                    onChange={(e) => set(i, { kind: e.target.value })}
                    className={`${selCls} w-28`}
                  />
                  <select
                    value={overrides[i]?.detail ?? s.detail}
                    aria-label={`section ${i + 1} lead`}
                    onChange={(e) => set(i, { detail: e.target.value })}
                    className={selCls}
                  >
                    {leadOptions(instruments).map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                  {!breaks[i] && (
                    <button
                      type="button"
                      onClick={() => addBreak(i)}
                      aria-label={`add break before section ${i + 1}`}
                      className="inline-flex items-center gap-1 text-xs text-purple-700 dark:text-purple-300"
                    >
                      <Plus className="h-3 w-3" /> break before
                    </button>
                  )}
                </div>

                <p className="mt-1 truncate font-tamil text-xs text-gray-500 dark:text-gray-400">
                  {s.lyrics?.split('\n')[0]}
                </p>

                <div className="mt-2 space-y-1">
                  {(overrides[i]?.layers ?? s.layers).map((l, li) => (
                    <div key={li} className="flex flex-wrap items-center gap-1">
                      <select
                        value={l.instrument}
                        aria-label={`section ${i + 1} layer ${li + 1} instrument`}
                        onChange={(e) => setLayer(i, li, { instrument: e.target.value })}
                        className={selCls}
                      >
                        {instruments.map((n) => (
                          <option key={n}>{n}</option>
                        ))}
                      </select>
                      <select
                        value={l.role}
                        aria-label={`section ${i + 1} layer ${li + 1} role`}
                        onChange={(e) => setLayer(i, li, { role: e.target.value })}
                        className={selCls}
                      >
                        {LAYER_ROLES.map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </select>
                      <button type="button" onClick={() => removeLayer(i, li)} aria-label={`remove layer ${li + 1} from section ${i + 1}`}>
                        <X className="h-3.5 w-3.5 text-gray-500" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addLayer(i)}
                    aria-label={`add layer to section ${i + 1}`}
                    className="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400"
                  >
                    <Plus className="h-3 w-3" /> layer
                  </button>
                  <input
                    value={overrides[i]?.freeDirection ?? ''}
                    aria-label={`section ${i + 1} direction in your own words`}
                    placeholder="…or write the direction yourself (wins over layers)"
                    onChange={(e) => set(i, { freeDirection: e.target.value })}
                    className={`${selCls} mt-1 w-full`}
                  />
                </div>
              </li>
            ))}
          </ol>

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {bal.instrumental} instrumental · {bal.sung} sung · {Math.round(bal.ratio * 100)}%
            </span>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(block);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {
                  /* clipboard blocked — the text is selectable below */
                }
                onArranged?.(block);
              }}
              className="inline-flex items-center gap-1.5 rounded border border-gray-300 px-2.5 py-1 text-xs dark:border-gray-600 dark:text-gray-200"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy arrangement'}
            </button>
          </div>

          <pre
            className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-gray-200 bg-gray-50 p-2 font-tamil text-xs dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
            data-testid="arrangement-block"
          >
            {block}
          </pre>
        </div>
      )}
    </section>
  );
}
