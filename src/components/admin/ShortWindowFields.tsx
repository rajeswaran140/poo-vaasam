'use client';

/**
 * Where the short is cut from — two numbers, and a way back to "you decide".
 *
 * WHY IT IS NOT A SLIDER. The operator's method is to pick the section with the
 * best LYRICS, and a lyric sheet is read in minutes and seconds, not in pixels.
 * The waveform in the audition player is the right instrument for *finding* the
 * phrase by ear; these fields are the right one for *stating* it, and for the
 * common case where the timestamps are already known and nothing needs dragging.
 * Both feed the same state — the player's "Use for the short" button fills
 * these in, and they stay editable afterwards.
 *
 * Empty means the machine picks the loudest stretch. That is the default, and
 * clearing the fields must return to it rather than leaving a half-set window.
 *
 * ⚠️ NOTHING HERE TOUCHES AUDIO. It emits two numbers, like the trim panel.
 */

import { useEffect, useId, useState } from 'react';
import { Scissors, RotateCcw } from 'lucide-react';
import {
  SHORT_PICK_MIN_SECONDS,
  SHORT_PICK_MAX_SECONDS,
  SHORT_FB_REELS_MAX_SECONDS,
  SHORT_SECONDS,
} from '@/lib/master-short';

export interface ShortWindowValue {
  startSec: number;
  seconds: number;
}

interface Props {
  /** null ⇒ let the loudness pass choose. */
  value: ShortWindowValue | null;
  onChange: (next: ShortWindowValue | null) => void;
  disabled?: boolean;
  idPrefix?: string;
  /**
   * Drop the long explainer, for the library row where the same controls sit
   * inside a dense list. The fields and the "cutting X-Y" line stay: those are
   * the state, not the teaching.
   */
  compact?: boolean;
}

/** "1:36" → 96. Returns null for anything that is not a time. */
export function parseClock(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const mmss = t.match(/^(\d+):([0-5]?\d(?:\.\d+)?)$/);
  if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2]);
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  return null;
}

/** 96 → "1:36". The inverse of parseClock for whole tenths. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  // Tenths only when they carry information — "1:36" reads better than "1:36.0".
  const shown = Number.isInteger(rest) ? String(rest).padStart(2, '0') : rest.toFixed(1).padStart(4, '0');
  return `${m}:${shown}`;
}

export function ShortWindowFields({ value, onChange, disabled = false, idPrefix, compact = false }: Props) {
  const auto = useId();
  const startId = `${idPrefix ?? auto}-start`;
  const endId = `${idPrefix ?? auto}-end`;
  const noteId = `${idPrefix ?? auto}-note`;

  /**
   * START AND END, not start and length.
   *
   * A lyric sheet is read as "this line is at 1:36 and that one ends at 3:36".
   * Asking for a duration instead made the operator do the subtraction, and the
   * fixed list it was offered (30-60s in 5s steps) could not express a
   * two-minute clip at all.
   *
   * Both fields are held as RAW TEXT while being typed, and a window is emitted
   * only when both parse and make sense together. There is no hidden default:
   * a start with no end is an unfinished thought, not a 30-second clip.
   */
  const [startText, setStartText] = useState(value ? formatClock(value.startSec) : '');
  const [endText, setEndText] = useState(value ? formatClock(value.startSec + value.seconds) : '');

  // Re-seed when the window arrives from somewhere else — the player's "Use for
  // the short" button, or a different master's row. Keyed on the numbers rather
  // than the object so typing is never fought mid-keystroke.
  const vStart = value?.startSec ?? null;
  const vSeconds = value?.seconds ?? null;
  useEffect(() => {
    setStartText(vStart === null ? '' : formatClock(vStart));
    setEndText(vStart === null || vSeconds === null ? '' : formatClock(vStart + vSeconds));
  }, [vStart, vSeconds]);

  const start = parseClock(startText);
  const end = parseClock(endText);
  const span = start !== null && end !== null ? Math.round((end - start) * 10) / 10 : null;

  /** Why this pair cannot be used, or null when it can. */
  const problem =
    start === null && end === null ? null
    : start === null ? 'Enter a start time.'
    : end === null ? 'Enter an end time.'
    : span !== null && span <= 0 ? 'The end must come after the start.'
    : span !== null && span < SHORT_PICK_MIN_SECONDS ? `That is ${span}s — the shortest clip is ${SHORT_PICK_MIN_SECONDS}s.`
    : span !== null && span > SHORT_PICK_MAX_SECONDS ? `That is ${formatClock(span)} — the longest is ${formatClock(SHORT_PICK_MAX_SECONDS)}.`
    : null;

  // Emit on every change that produces a usable pair, and clear the window the
  // moment it stops being usable — a stale window surviving an edit is how the
  // wrong seconds get rendered.
  useEffect(() => {
    if (start !== null && end !== null && !problem && span !== null) {
      if (value?.startSec === start && value?.seconds === span) return;
      onChange({ startSec: start, seconds: span });
      return;
    }
    if (value) onChange(null);
    // onChange identity is not stable in the caller; the guard above makes a
    // re-run harmless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end, span, problem]);

  const field = (id: string, label: string, text: string, set: (v: string) => void) => (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-600 dark:text-gray-300">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        disabled={disabled}
        placeholder="auto"
        value={text}
        // Points at the reason this pair cannot be used, so a screen reader
        // reaches it from the field rather than hunting for it.
        aria-describedby={problem ? noteId : undefined}
        aria-invalid={problem ? true : undefined}
        onChange={(e) => set(e.target.value)}
        className="mt-1 w-24 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm tabular-nums text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
      />
    </div>
  );

  const longForFacebook = span !== null && !problem && span > SHORT_FB_REELS_MAX_SECONDS;

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-end gap-3">
        {field(startId, 'Start at', startText, setStartText)}
        {field(endId, 'End at', endText, setEndText)}
        {(startText || endText) && (
          <button
            type="button"
            onClick={() => { setStartText(''); setEndText(''); }}
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 disabled:opacity-60 dark:border-gray-700 dark:text-gray-200"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" /> Let it pick
          </button>
        )}
      </div>

      {problem ? (
        <p id={noteId} className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400">
          {problem}
        </p>
      ) : span !== null ? (
        <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">
          <Scissors className="mr-1 inline h-3 w-3" aria-hidden="true" />
          Cutting <strong>{formatClock(start!)}&ndash;{formatClock(end!)}</strong> — {formatClock(span)}.
          {longForFacebook && (
            <> Past {SHORT_FB_REELS_MAX_SECONDS}s, so YouTube Shorts and Instagram will take it but Facebook Reels will not.</>
          )}
        </p>
      ) : (
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          {compact ? (
            <>Blank ⇒ the loudest {SHORT_SECONDS}s is chosen for you.</>
          ) : (
            <>
              Leave both blank and the loudest {SHORT_SECONDS}&nbsp;seconds are chosen for you — which finds
              the chorus, not necessarily the lines you want. To choose: type the times from the lyric sheet,
              or press play on a saved master below, drag across the waveform to loop a phrase, then{' '}
              <strong>Use for the short</strong>.
            </>
          )}
        </p>
      )}
    </div>
  );
}
