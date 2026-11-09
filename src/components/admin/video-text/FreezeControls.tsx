'use client';

/**
 * Freeze: from a frame to the end of the video the picture holds still while
 * the song plays on (so one short clip can carry a whole song). Step to the
 * frame with ◀ / ▶ (one frame each, the video pauses), then Freeze here.
 * The arithmetic is lib/video-text/freeze.ts; the worker takes the frame.
 */
import type { RefObject } from 'react';
import { frameAt, frameOfStart, freezeAt, lastFrame, seekTimeFor } from '@/lib/video-text/freeze';
import { cutRange } from '@/lib/video-text/cut';
import type { Cut, Freeze } from '@/types/videoText';
import { formatMark } from './CutMarks';

const SMALL_BUTTON =
  'rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800';

export interface FreezeControlsProps {
  freeze: Freeze | null;
  durationSec: number;
  fps: number;
  playheadSec: number;
  onChange(freeze: Freeze | null): void;
  onSeek(sec: number): void;
  disabled?: boolean;
  /** The preview's video: the frame is read from its clock, and stepping pauses it. */
  video?: RefObject<HTMLVideoElement | null>;
  /** In and Out, to say when the freeze falls outside the exported part. */
  cut?: Cut | null;
}

export function FreezeControls({ freeze, durationSec, fps, playheadSec, onChange, onSeek, disabled, video, cut = null }: FreezeControlsProps) {
  const range = cutRange(cut, durationSec);
  const now = () => {
    const t = video?.current?.currentTime;
    return typeof t === 'number' && Number.isFinite(t) ? t : playheadSec;
  };
  const step = (by: -1 | 1) => {
    video?.current?.pause();
    const next = Math.min(lastFrame(durationSec, fps), Math.max(0, frameAt(now(), fps) + by));
    onSeek(seekTimeFor(next, fps));
  };
  const freezeHere = () => {
    const next = freezeAt(now(), durationSec, fps);
    if (next.atSec !== freeze?.atSec) onChange(next);
  };

  return (
    <div className="min-w-0 space-y-1" data-testid="freeze-controls">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <button type="button" className={SMALL_BUTTON} onClick={() => step(-1)} aria-label="Back 1 frame" title="Back one frame (pauses)">
          ◀ 1 frame
        </button>
        <button type="button" className={SMALL_BUTTON} onClick={() => step(1)} aria-label="Forward 1 frame" title="Forward one frame (pauses)">
          1 frame ▶
        </button>
        <button type="button" className={SMALL_BUTTON} onClick={freezeHere} disabled={disabled} title="Hold the frame showing now until the end">
          Freeze here
        </button>
        {freeze && (
          <>
            <button type="button" className={SMALL_BUTTON} onClick={() => onSeek(seekTimeFor(frameOfStart(freeze.atSec, fps), fps))}>
              Go to freeze
            </button>
            <button type="button" className={SMALL_BUTTON} onClick={() => onChange(null)} disabled={disabled}>
              Remove freeze
            </button>
          </>
        )}
      </div>
      <p className="text-xs text-gray-600 dark:text-gray-300" data-testid="freeze-summary">
        {freeze ? (
          <>
            The picture freezes on the frame at <span className="font-semibold tabular-nums">{formatMark(freeze.atSec)}</span> and holds
            it to the end. The song keeps playing.
            {cut && freeze.atSec >= range.outSec && <> It is after Out, so the exported part is not frozen.</>}
            {cut && freeze.atSec <= range.inSec && <> It is at or before In, so the whole exported part is frozen.</>}
          </>
        ) : (
          <>No freeze: the video plays to the end. To hold a frame (e.g. the last frame of a short clip), step to it and press Freeze here.</>
        )}
      </p>
    </div>
  );
}
