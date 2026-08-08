'use client';

/**
 * Flow suggestions + word inspector, beside the draft in the Lyric Critic.
 *
 * Both halves are PURE and instant — no LLM, no network on the render path.
 * That is deliberate: the critique is a considered, whole-draft act you invoke;
 * this is the thing you glance at mid-line. If it needed a round trip it would
 * be too slow to consult while writing, which is the only moment it helps.
 *
 * NEITHER HALF REWRITES. Flow names what a line does and why it matters; the
 * inspector reports how a word sings and offers words from the poet's own
 * lexicon. Insertion is always his click.
 */

import { useMemo, useRef, useState } from 'react';
import { analyzeProsody } from '@/lib/tamil-prosody';
import { flowSuggestions, flowHeadline } from '@/lib/lyric-flow-advice';
import { inspectSingability, lexiconCandidates } from '@/lib/lyric-word-inspect';
import type { LexiconWord } from '@/types/lexicon';

interface Props {
  lyrics: string;
  /** The word the poet last put the caret on, if any. */
  selectedWord: string;
  lexicon: LexiconWord[];
  theme?: string;
  register?: string;
  /** Called when a candidate is chosen — the parent decides how to apply it. */
  onUseWord?: (word: string) => void;
  /**
   * Fired the first time the panel is expanded. The lexicon is fetched then,
   * not on mount: nothing here is needed until the poet looks, and a mount-time
   * fetch also consumes one-shot mocks in unrelated tests.
   */
  onFirstOpen?: () => void;
}

export function LyricAssistPanel({ lyrics, selectedWord, lexicon, theme, register, onUseWord, onFirstOpen }: Props) {
  const [open, setOpen] = useState(false);
  const opened = useRef(false);

  const suggestions = useMemo(() => flowSuggestions(analyzeProsody(lyrics)), [lyrics]);
  const singability = useMemo(
    () => (selectedWord ? inspectSingability(selectedWord) : null),
    [selectedWord]
  );
  const candidates = useMemo(
    () => (selectedWord ? lexiconCandidates(selectedWord, lexicon, { theme, register }) : []),
    [selectedWord, lexicon, theme, register]
  );

  const headline = flowHeadline(suggestions);

  return (
    <section className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900/40">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => {
            if (!o && !opened.current) {
              opened.current = true;
              onFirstOpen?.();
            }
            return !o;
          });
        }}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Flow &amp; words</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {headline || 'all clear'}
        </span>
      </button>

      {open && (
        <div className="space-y-5 border-t border-gray-200 px-4 py-4 dark:border-gray-800">
          {/* ---- word inspector ---- */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Word
            </h4>
            {!selectedWord ? (
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Put the cursor on a word in your draft to inspect it.
              </p>
            ) : (
              <>
                <p className="mt-1 font-tamil text-lg text-gray-900 dark:text-gray-100">{selectedWord}</p>
                {singability && (
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                    {singability.syllables} syllable{singability.syllables === 1 ? '' : 's'}
                    {singability.note ? ` · ${singability.note}` : ''}
                  </p>
                )}
                {candidates.length > 0 ? (
                  <ul className="mt-3 space-y-2" data-testid="word-candidates">
                    {candidates.map((c) => (
                      <li key={c.word} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                        <button
                          type="button"
                          onClick={() => onUseWord?.(c.word)}
                          className="font-tamil text-base text-purple-700 underline-offset-2 hover:underline dark:text-purple-300"
                          title={`Use ${c.word}`}
                        >
                          {c.word}
                        </button>
                        <span className="text-gray-600 dark:text-gray-400">{c.gloss}</span>
                        <span className="text-xs text-gray-400 dark:text-gray-500">{c.because}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                    Nothing in your lexicon shares this word&apos;s theme, register or meter.
                  </p>
                )}
                <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                  Your own words, offered — not corrections. Nothing changes until you click.
                </p>
              </>
            )}
          </div>

          {/* ---- flow ---- */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Flow
            </h4>
            {suggestions.length === 0 ? (
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Nothing flagged — the lines sit on a consistent meter.
              </p>
            ) : (
              <ul className="mt-2 space-y-3" data-testid="flow-suggestions">
                {suggestions.map((s, i) => (
                  <li key={`${s.line ?? 'all'}-${i}`} className="text-sm">
                    <div className="flex flex-wrap items-baseline gap-2">
                      {s.line != null && (
                        <span className="text-xs text-gray-400 dark:text-gray-500">line {s.line + 1}</span>
                      )}
                      {s.quote && (
                        <span className="font-tamil text-gray-700 dark:text-gray-300">{s.quote}</span>
                      )}
                    </div>
                    <p className="text-gray-800 dark:text-gray-200">{s.observation}</p>
                    <p className="text-gray-500 dark:text-gray-400">{s.why}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
