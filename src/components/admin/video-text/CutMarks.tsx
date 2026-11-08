'use client';

/**
 * In and Out, Premiere-style: Mark In (I) and Mark Out (O) at the playhead,
 * Go to In (Shift+I) and Go to Out (Shift+O), and Clear. Make video exports
 * only the part between the marks; the text stays where it is on the song.
 * The arithmetic (frame snapping, minimum length) is cut.ts.
 */
import { useEffect, useRef, type RefObject } from 'react';
import { cutLength, cutRange, markIn, markOut } from '@/lib/video-text/cut';
import type { Cut } from '@/types/videoText';
import { isTyping } from './typing';

/** 13.367 → "0:13.37": hundredths, so marks a frame apart read differently. */
export function formatMark(sec: number): string {
  const hundredths = Math.max(0, Math.round(sec * 100));
  const m = Math.floor(hundredths / 6000);
  const s = (hundredths % 6000) / 100;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

export interface CutMarksProps {
  cut: Cut | null;
  durationSec: number;
  fps: number;
  playheadSec: number;
  onChange(cut: Cut | null): void;
  onSeek(sec: number): void;
  disabled?: boolean;
  /** The preview's video: a mark reads its clock at the press, so marking while it plays is exact. */
  video?: RefObject<HTMLVideoElement | null>;
}

/** The letter pressed, by physical key too: with a Tamil layout active `key` is not "i". */
function markKey(e: KeyboardEvent): 'i' | 'o' | null {
  if (e.code === 'KeyI') return 'i';
  if (e.code === 'KeyO') return 'o';
  const k = e.key.toLowerCase();
  return k === 'i' || k === 'o' ? k : null;
}

const SMALL_BUTTON =
  'rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800';

export function CutMarks({ cut, durationSec, fps, playheadSec, onChange, onSeek, disabled, video }: CutMarksProps) {
  const range = cutRange(cut, durationSec);
  // The latest values for the key handler.
  const live = useRef({ cut, playheadSec, disabled, video });
  live.current = { cut, playheadSec, disabled, video };
  const now = () => {
    const t = live.current.video?.current?.currentTime;
    return typeof t === 'number' && Number.isFinite(t) ? t : live.current.playheadSec;
  };

  const setIn = () => onChange(markIn(live.current.cut, now(), durationSec, fps));
  const setOut = () => onChange(markOut(live.current.cut, now(), durationSec, fps));
  const actions = useRef({ setIn, setOut, onSeek });
  actions.current = { setIn, setOut, onSeek };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (live.current.disabled || e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTyping(e.target)) return;
      const key = markKey(e);
      if (!key) return;
      e.preventDefault();
      const r = cutRange(live.current.cut, durationSec);
      if (e.shiftKey) actions.current.onSeek(key === 'i' ? r.inSec : r.outSec);
      else if (key === 'i') actions.current.setIn();
      else actions.current.setOut();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [durationSec]);

  return (
    <div className="min-w-0 space-y-1" data-testid="cut-marks">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <button type="button" className={SMALL_BUTTON} onClick={setIn} disabled={disabled} title="Mark In at the playhead (I)">
          Mark In <kbd className="ml-1 font-mono text-[10px] text-gray-500 dark:text-gray-400">I</kbd>
        </button>
        <button type="button" className={SMALL_BUTTON} onClick={setOut} disabled={disabled} title="Mark Out at the playhead (O)">
          Mark Out <kbd className="ml-1 font-mono text-[10px] text-gray-500 dark:text-gray-400">O</kbd>
        </button>
        {cut && (
          <>
            <button type="button" className={SMALL_BUTTON} onClick={() => onSeek(range.inSec)} title="Go to In (Shift+I)">
              Go to In
            </button>
            <button type="button" className={SMALL_BUTTON} onClick={() => onSeek(range.outSec)} title="Go to Out (Shift+O)">
              Go to Out
            </button>
            <button type="button" className={SMALL_BUTTON} onClick={() => onChange(null)} disabled={disabled}>
              Clear In and Out
            </button>
          </>
        )}
      </div>
      <p className="text-xs text-gray-600 dark:text-gray-300" data-testid="cut-summary">
        {cut ? (
          <>
            Make video exports <span className="font-semibold tabular-nums">{formatMark(range.inSec)}</span> to{' '}
            <span className="font-semibold tabular-nums">{formatMark(range.outSec)}</span> (
            <span className="tabular-nums">{formatMark(cutLength(cut, durationSec))}</span> long). Text outside the marks is
            left out.
          </>
        ) : (
          <>Make video exports the whole video. Set In and Out to export only part of it.</>
        )}
      </p>
    </div>
  );
}
