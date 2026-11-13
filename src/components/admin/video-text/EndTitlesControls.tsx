'use client';

/**
 * End titles: from the playhead to the end of the video the picture fades to
 * black or white and the logo (first line) and credits (next line) show
 * centred, like a film's end titles. The
 * song plays on; the video keeps its length. Drawing and timing are in
 * lib/video-text/end-titles.ts.
 */
import type { RefObject } from 'react';
import { END_TITLES_FADE_SEC, endTitlesAt, validateEndTitles } from '@/lib/video-text/end-titles';
import type { EndTitles } from '@/types/videoText';
import { formatMark } from './CutMarks';

const SMALL_BUTTON =
  'rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800';

export interface EndTitlesControlsProps {
  endTitles: EndTitles | null;
  durationSec: number;
  playheadSec: number;
  onChange(endTitles: EndTitles | null): void;
  onSeek(sec: number): void;
  disabled?: boolean;
  /** The preview's video: the start is read from its clock. */
  video?: RefObject<HTMLVideoElement | null>;
  /** Whether a logo is saved (the end titles show it above the credits). */
  hasLogo: boolean;
  /** Whether there are credits to show. */
  hasCredits: boolean;
}

export function EndTitlesControls({ endTitles, durationSec, playheadSec, onChange, onSeek, disabled, video, hasLogo, hasCredits }: EndTitlesControlsProps) {
  const now = () => {
    const t = video?.current?.currentTime;
    return typeof t === 'number' && Number.isFinite(t) ? t : playheadSec;
  };
  const background = endTitles?.background ?? 'black';
  const startHere = () => {
    const next = endTitlesAt(now(), durationSec, background);
    if (next.atSec !== endTitles?.atSec || next.background !== endTitles?.background) onChange(next);
  };
  const setBackground = (bg: 'black' | 'white') => {
    if (endTitles && bg !== background) onChange({ ...endTitles, background: bg });
  };
  const problem = validateEndTitles(endTitles, durationSec);

  return (
    <div className="min-w-0 space-y-1" data-testid="end-titles-controls">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">End titles</span>
        <button type="button" className={SMALL_BUTTON} onClick={startHere} disabled={disabled} title="From here to the end: black, with the logo and credits">
          Start end titles here
        </button>
        {endTitles && (
          <>
            <span className="text-sm text-gray-700 dark:text-gray-200">{`From ${formatMark(endTitles.atSec)} to the end`}</span>
            <span role="radiogroup" aria-label="End screen colour" className="inline-flex overflow-hidden rounded-md border border-gray-300 dark:border-gray-700">
              {(['black', 'white'] as const).map((bg) => (
                <button
                  key={bg}
                  type="button"
                  role="radio"
                  aria-checked={background === bg}
                  disabled={disabled}
                  onClick={() => setBackground(bg)}
                  className={`px-2.5 py-1.5 text-xs font-medium ${background === bg ? 'bg-orange-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-200'}`}
                >
                  {bg === 'black' ? 'Black' : 'White'}
                </button>
              ))}
            </span>
            <button type="button" className={SMALL_BUTTON} onClick={() => onSeek(endTitles.atSec)}>
              Go to end titles
            </button>
            <button type="button" className={SMALL_BUTTON} onClick={() => onChange(null)} disabled={disabled}>
              Remove end titles
            </button>
          </>
        )}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {`Put the playhead where the ending starts (for example the last music) and press Start end titles here. The picture fades to ${background} over ${END_TITLES_FADE_SEC} second; your logo shows in the middle with the credits on the line under it until the video ends, and the song keeps playing.`}
      </p>
      {endTitles && !hasLogo && !hasCredits && (
        <p className="text-sm text-amber-700 dark:text-amber-400">There is no logo or credits yet, so the end titles are a plain screen. Add credits above, or upload a logo.</p>
      )}
      {problem && <p className="text-sm text-red-700 dark:text-red-400">{problem}</p>}
    </div>
  );
}
