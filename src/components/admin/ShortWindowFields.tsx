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

import { useId } from 'react';
import { Scissors, RotateCcw } from 'lucide-react';
import { SHORT_PICK_MIN_SECONDS, SHORT_PICK_MAX_SECONDS, SHORT_SECONDS } from '@/lib/master-short';

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

export function ShortWindowFields({ value, onChange, disabled = false, idPrefix }: Props) {
  const auto = useId();
  const startId = `${idPrefix ?? auto}-start`;
  const lenId = `${idPrefix ?? auto}-length`;

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={startId} className="block text-xs font-medium text-gray-600 dark:text-gray-300">
            Start at
          </label>
          <input
            id={startId}
            type="text"
            inputMode="numeric"
            disabled={disabled}
            placeholder="auto"
            defaultValue={value ? formatClock(value.startSec) : ''}
            // Keyed on the value so the player's handoff re-seeds the field,
            // while typing is never fought mid-keystroke by a controlled value.
            key={value ? `s-${value.startSec}` : 's-auto'}
            onBlur={(e) => {
              const parsed = parseClock(e.target.value);
              if (parsed === null) {
                // An unreadable or emptied field means "you decide" — the whole
                // window goes, rather than leaving a start with no length.
                onChange(null);
                return;
              }
              onChange({ startSec: parsed, seconds: value?.seconds ?? SHORT_SECONDS });
            }}
            className="mt-1 w-24 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          />
        </div>
        <div>
          <label htmlFor={lenId} className="block text-xs font-medium text-gray-600 dark:text-gray-300">
            Length
          </label>
          <select
            id={lenId}
            disabled={disabled || !value}
            value={value?.seconds ?? SHORT_SECONDS}
            onChange={(e) => {
              if (!value) return;
              onChange({ ...value, seconds: Number(e.target.value) });
            }}
            className="mt-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          >
            {[30, 35, 40, 45, 50, 55, 60].map((n) => (
              <option key={n} value={n}>{n}s</option>
            ))}
          </select>
        </div>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 disabled:opacity-60 dark:border-gray-700 dark:text-gray-200"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" /> Let it pick
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        {value ? (
          <>
            <Scissors className="mr-1 inline h-3 w-3" aria-hidden="true" />
            Cutting <strong>{formatClock(value.startSec)}&ndash;{formatClock(value.startSec + value.seconds)}</strong>{' '}
            ({value.seconds}s). A window must be {SHORT_PICK_MIN_SECONDS}&ndash;{SHORT_PICK_MAX_SECONDS} seconds.
          </>
        ) : (
          <>
            Leave this blank and the loudest {SHORT_SECONDS}&nbsp;seconds are chosen for you — which finds the
            chorus, not necessarily the lines you want. To choose: press play on a saved master below, drag
            across the waveform to loop a phrase, then <strong>Use for the short</strong>. Or type the start
            time here if you already know it.
          </>
        )}
      </p>
    </div>
  );
}
