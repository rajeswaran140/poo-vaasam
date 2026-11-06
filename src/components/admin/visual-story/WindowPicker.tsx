'use client';

/**
 * WindowPicker — start (m:ss) + length (30–420 s) of the slice of the song a
 * story covers. The end is shown, and the length is clamped so the window never
 * runs past the song. Emits INTEGER seconds only (shots tile the window with ===).
 */

import { useState } from 'react';
import { MIN_WINDOW_SEC, MAX_WINDOW_SEC } from '@/types/visualStory';

export interface WindowValue {
  startSec: number;
  lengthSec: number;
  /** False while the start or length text is not a usable value; the other numbers are then the last good ones. */
  valid: boolean;
}

interface Props {
  songSec: number;
  startSec: number;
  lengthSec: number;
  onChange: (v: WindowValue) => void;
}

export function formatMss(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "1:05", "65" or "1:05.7" → whole seconds; null when unparseable. */
export function parseMss(text: string): number | null {
  const m = /^\s*(?:(\d+):)?(\d+)(?:\.\d+)?\s*$/.exec(text);
  if (!m) return null;
  if (m[1] !== undefined && Number(m[2]) >= 60) return null;
  return (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]);
}

export function WindowPicker({ songSec, startSec, lengthSec, onChange }: Props) {
  const [startText, setStartText] = useState(formatMss(startSec));
  const [lengthText, setLengthText] = useState(String(lengthSec));
  const [startError, setStartError] = useState<string | null>(null);
  const [lengthBad, setLengthBad] = useState(false);
  const song = Math.floor(songSec);
  const maxLength = (start: number) => Math.min(MAX_WINDOW_SEC, song - start);

  const onStart = (text: string) => {
    setStartText(text);
    const parsed = parseMss(text);
    let error: string | null = null;
    if (parsed === null) error = 'Enter the start as m:ss, for example 0:45.';
    else if (parsed > song - MIN_WINDOW_SEC) {
      error = `The window needs ${MIN_WINDOW_SEC} s: start at ${formatMss(Math.max(0, song - MIN_WINDOW_SEC))} or earlier.`;
    }
    setStartError(error);
    if (error || parsed === null) {
      onChange({ startSec, lengthSec, valid: false });
      return;
    }
    const len = Math.min(lengthSec, maxLength(parsed));
    setLengthText(String(len));
    setLengthBad(false);
    onChange({ startSec: parsed, lengthSec: len, valid: true });
  };

  const onLength = (raw: string) => {
    const n = raw.trim() === '' ? NaN : Math.floor(Number(raw));
    if (!Number.isFinite(n)) {
      setLengthText(raw);
      setLengthBad(true);
      onChange({ startSec, lengthSec, valid: false });
      return;
    }
    const len = Math.min(n, maxLength(startSec));
    setLengthText(String(len));
    setLengthBad(len < MIN_WINDOW_SEC);
    onChange({ startSec, lengthSec: len, valid: !startError && len >= MIN_WINDOW_SEC });
  };

  const onLengthBlur = () => {
    const n = Number(lengthText);
    if (lengthText.trim() === '' || !Number.isFinite(n) || n < MIN_WINDOW_SEC) {
      const len = Math.min(MIN_WINDOW_SEC, maxLength(startSec));
      setLengthText(String(len));
      setLengthBad(false);
      onChange({ startSec, lengthSec: len, valid: !startError });
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-4">
        <label className="block text-sm text-gray-700 dark:text-gray-300">
          Start (m:ss)
          <input
            type="text"
            inputMode="numeric"
            value={startText}
            onChange={(e) => onStart(e.target.value)}
            aria-invalid={startError ? true : undefined}
            className="mt-1 block w-28 rounded-md border border-gray-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-800"
          />
        </label>
        <label className="block text-sm text-gray-700 dark:text-gray-300">
          Length ({MIN_WINDOW_SEC}–{MAX_WINDOW_SEC} s)
          <input
            type="number"
            min={MIN_WINDOW_SEC}
            max={Math.min(MAX_WINDOW_SEC, Math.max(0, song - startSec))}
            step={1}
            value={lengthText}
            onChange={(e) => onLength(e.target.value)}
            onBlur={onLengthBlur}
            className="mt-1 block w-28 rounded-md border border-gray-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-800"
          />
        </label>
        <p className="pb-1 text-sm text-gray-600 dark:text-gray-400">
          Ends {formatMss(startSec + lengthSec)} of {formatMss(song)}
        </p>
      </div>
      {lengthBad && !startError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Enter a length of {MIN_WINDOW_SEC}–{MAX_WINDOW_SEC} seconds.
        </p>
      )}
      {startError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {startError}
        </p>
      )}
    </div>
  );
}
