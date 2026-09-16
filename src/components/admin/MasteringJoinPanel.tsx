'use client';

/**
 * Two-part assembly — attach a Part B and set the crossfade.
 *
 * A song generated in two sections has to be spliced BEFORE it is mastered.
 * Doing it the other way (master each half, crossfade afterwards) leaves neither
 * half on target, because integrated loudness is an average over a programme,
 * and the overlap spikes where two full-level sources sum. This panel exists so
 * the correct order is the only one available: the join runs in the same
 * pre-pass as trim/fade, upstream of every measurement.
 *
 * Deliberately NOT here: beat detection. Landing Part B's first downbeat on the
 * grid is the part that decides whether a seam works, and an automatic guess
 * that lands off-grid is worse than the admin nudging Part B's head trim by ear.
 * The panel gives the numbers; the judgement stays human.
 *
 * "Nudging by ear" needed something to nudge AGAINST, which is what the seam
 * preview adds: ~20 seconds around the join, rendered from the REAL join graph,
 * so a setting can be heard in seconds instead of by mastering the whole song
 * and listening to it. The panel owns the button and the audio element; the
 * request, the polling and the presigned URL belong to the caller.
 */

import { useId } from 'react';
import { Link2, Upload, Loader2, X, Headphones, AlertTriangle } from 'lucide-react';
import { MIN_OVERLAP_SECONDS, MAX_OVERLAP_SECONDS } from '@/lib/master-join';

export interface JoinPanelProps {
  /** Part B, once uploaded to the mastering workspace. */
  partB: { key: string; name: string } | null;
  onPick: (file: File) => void;
  onClear: () => void;
  overlapSec: number;
  onOverlapChange: (seconds: number) => void;
  /** Head trim on Part B, in seconds — how its entry is nudged onto the beat. */
  partBStartSec: number;
  onPartBStartChange: (seconds: number) => void;
  uploading: boolean;
  progressPct: number;
  disabled: boolean;
  /**
   * Render and fetch a preview of the CURRENT settings. Absent ⇒ no button:
   * the panel is also used where there is nothing to render with.
   */
  onPreviewSeam?: () => void;
  previewBusy?: boolean;
  /** Presigned URL of the rendered seam, once it lands. */
  previewUrl?: string | null;
  /**
   * What the two sides of the overlap measured, in words. The one thing that
   * decides whether nudging will help at all — a 2 LU step is not a placement
   * problem and no amount of trimming hides it.
   */
  previewNote?: string | null;
  previewMismatched?: boolean;
}

export function MasteringJoinPanel({
  partB, onPick, onClear,
  overlapSec, onOverlapChange,
  partBStartSec, onPartBStartChange,
  uploading, progressPct, disabled,
  onPreviewSeam, previewBusy = false, previewUrl = null,
  previewNote = null, previewMismatched = false,
}: JoinPanelProps) {
  const id = useId();

  return (
    <div className="mt-4 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
        Join a second part <span className="font-normal normal-case tracking-normal">(optional)</span>
      </h3>

      {!partB && !uploading && (
        <>
          <input
            id={`${id}-partb`}
            type="file"
            accept=".wav,audio/wav,audio/x-wav"
            className="peer sr-only"
            disabled={disabled}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) onPick(f);
            }}
          />
          <label
            htmlFor={`${id}-partb`}
            className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-600 transition hover:border-orange-400 hover:bg-orange-50/40 peer-focus-visible:ring-2 peer-focus-visible:ring-orange-500 dark:border-gray-700 dark:text-gray-300 dark:hover:border-orange-500 dark:hover:bg-orange-500/5"
          >
            <Upload className="h-4 w-4" aria-hidden="true" /> Add Part B (WAV)
          </label>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            The two parts are crossfaded and then mastered <strong>once</strong>, as one song.
            Mastering the halves separately and joining them afterwards leaves neither on target.
          </p>
        </>
      )}

      {uploading && (
        <p className="mt-2 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Uploading Part B… {progressPct}%
        </p>
      )}

      {partB && !uploading && (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-0 truncate font-medium text-gray-900 dark:text-gray-100">{partB.name}</span>
            <button
              type="button"
              onClick={onClear}
              disabled={disabled}
              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 disabled:opacity-50 dark:text-gray-400 dark:hover:text-gray-100"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" /> Remove
            </button>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-overlap`} className="block text-xs font-medium text-gray-600 dark:text-gray-300">
                Crossfade (seconds)
              </label>
              <input
                id={`${id}-overlap`}
                type="number"
                min={MIN_OVERLAP_SECONDS}
                max={MAX_OVERLAP_SECONDS}
                step={0.5}
                value={overlapSec}
                disabled={disabled}
                onChange={(e) => onOverlapChange(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm tabular-nums text-gray-900 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              />
            </div>
            <div>
              <label htmlFor={`${id}-bstart`} className="block text-xs font-medium text-gray-600 dark:text-gray-300">
                Part B starts at (seconds)
              </label>
              <input
                id={`${id}-bstart`}
                type="number"
                min={0}
                step={0.1}
                value={partBStartSec}
                disabled={disabled}
                onChange={(e) => onPartBStartChange(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm tabular-nums text-gray-900 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              />
            </div>
          </div>

          {onPreviewSeam && (
            <div className="mt-3 rounded-lg bg-gray-50 p-3 dark:bg-gray-800/40">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={onPreviewSeam}
                  disabled={disabled || previewBusy}
                  className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 px-3 py-1.5 text-xs font-medium text-emerald-800 transition hover:bg-emerald-50 disabled:opacity-60 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-900/20"
                >
                  {previewBusy
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    : <Headphones className="h-3.5 w-3.5" aria-hidden="true" />}
                  {previewBusy ? 'Rendering the seam…' : 'Hear the seam'}
                </button>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  About 20 seconds around the join, nothing else.
                </span>
              </div>

              {previewUrl && (
                <>
                  {/* Native controls on purpose: this is a 20-second loop to
                      nudge against, not an audition — a waveform and a meter
                      would be more to look at and no more to hear. Keyed on the
                      URL so a re-render swaps the file instead of leaving the
                      previous settings playing, which is the one way a preview
                      can lie about what it contains. */}
                  <audio
                    key={previewUrl}
                    src={previewUrl}
                    controls
                    loop
                    autoPlay
                    className="mt-3 w-full"
                    aria-label="The crossfade between Part A and Part B, looping"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Looping. Change a number above and press <strong>Hear the seam</strong> again —
                    each set of settings renders its own file, so this one keeps playing until the
                    next lands.
                  </p>
                </>
              )}

              {previewNote && (
                <p
                  className={`mt-2 text-xs ${
                    previewMismatched
                      ? 'font-medium text-amber-800 dark:text-amber-300'
                      : 'text-gray-600 dark:text-gray-300'
                  }`}
                >
                  {previewMismatched && <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden="true" />}
                  {previewNote}
                </p>
              )}
            </div>
          )}

          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Equal-power crossfade — holds the level flat across the seam. A linear one
            drops about 3&nbsp;dB in the middle of every join.
            <strong> Alignment matters more than length:</strong> nudge &ldquo;Part B starts at&rdquo; so its
            first downbeat lands on the beat, then set the crossfade.
            {' '}Do <strong>not</strong> fade out Part A&rsquo;s tail — the crossfade is already
            pulling it down, and both together dip at the seam.
          </p>
        </>
      )}
    </div>
  );
}
