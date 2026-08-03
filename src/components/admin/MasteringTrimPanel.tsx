'use client';

/**
 * Trim + fade controls, shown between "upload" and "master".
 *
 * WHY IT LIVES BEFORE THE RUN, not after. The worker applies this edit in a
 * lossless pre-pass ahead of the loudnorm passes, because integrated loudness
 * is an average over the programme — normalise first and trim afterwards and
 * the delivered file misses its target by up to ~2 LU while still being
 * recorded as correct. See src/lib/master-edit.ts.
 *
 * The waveform is decoded from the LOCAL File, not re-fetched from S3: the
 * admin has the bytes in hand at this point, so drawing costs one decode and no
 * round trip. If the file was lost to a remount, the panel degrades to numeric
 * entry rather than disappearing — the times are the actual input, the picture
 * is an aid.
 *
 * ⚠️ NOTHING HERE TOUCHES AUDIO. It emits numbers. The one place samples are
 * modified is the worker.
 */

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Scissors, RotateCcw } from 'lucide-react';
import { MasteringWaveform } from '@/components/admin/MasteringWaveform';
import { binPeaks, formatTime, normaliseLoop, shouldRenderWaveform, type LoopRegion } from '@/lib/waveform';
import {
  NO_EDIT,
  FADE_CURVES,
  MAX_FADE_SECONDS,
  MIN_MASTER_SECONDS,
  describeEdit,
  editedDurationSec,
  isNoOpEdit,
  type FadeCurve,
  type MasterEdit,
} from '@/lib/master-edit';

const WAVEFORM_BINS = 1200;

interface Props {
  /** The picked file; null once it has been lost to a remount. */
  file: File | null;
  /** Emitted on every change; null means "master the whole thing". */
  onChange: (edit: MasterEdit | null) => void;
  disabled?: boolean;
}

export function MasteringTrimPanel({ file, onChange, disabled = false }: Props) {
  const startId = useId();
  const endId = useId();
  const fadeInId = useId();
  const fadeOutId = useId();
  const curveId = useId();

  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [duration, setDuration] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  /**
   * The trim window is held as two plain numbers, NOT a LoopRegion, because the
   * waveform is optional. A region needs a duration to be meaningful; these do
   * not, so the numeric inputs keep working when the file could not be decoded.
   * `endSec === null` means "run to the end of the file".
   */
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState<number | null>(null);
  const [fadeInSec, setFadeInSec] = useState(0);
  const [fadeOutSec, setFadeOutSec] = useState(0);
  const [curve, setCurve] = useState<FadeCurve>(NO_EDIT.curve);

  // Decode once per file. Mirrors MasteringPlayer's approach so both waveforms
  // are built from the same peak definition.
  useEffect(() => {
    if (!file) {
      setPeaks(null);
      setDuration(0);
      return;
    }
    if (!shouldRenderWaveform(file.size)) {
      setPeaks(null);
      setNote('This file is too large to draw; enter the times below instead.');
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const buf = await file.arrayBuffer();
        const Ctor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        const ctx = new Ctor();
        const decoded = await ctx.decodeAudioData(buf);
        if (!alive) return;
        setPeaks(binPeaks(decoded.getChannelData(0), WAVEFORM_BINS));
        setDuration(decoded.duration);
        setNote(null);
        void ctx.close();
      } catch {
        if (alive) setNote('Waveform could not be drawn for this file; enter the times below instead.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [file]);

  const edit: MasterEdit = useMemo(
    () => ({
      trimStartSec: startSec,
      // Only claim a tail trim when one was actually made: an end at (or past)
      // the duration is the same as no end, and sending it would mark the job
      // as edited and cost a pre-pass for nothing.
      trimEndSec: endSec !== null && (duration <= 0 || endSec < duration) ? endSec : null,
      fadeInSec,
      fadeOutSec,
      curve,
    }),
    [startSec, endSec, duration, fadeInSec, fadeOutSec, curve]
  );

  /** The region drawn on the waveform; only meaningful once a duration exists. */
  const region: LoopRegion | null = useMemo(() => {
    if (duration <= 0) return null;
    const end = Math.min(endSec ?? duration, duration);
    if (end - startSec <= 0) return null;
    if (startSec === 0 && end >= duration) return null;
    return { start: startSec, end };
  }, [startSec, endSec, duration]);

  const start = startSec;
  /** Where the master ends, for display. Clamped only when the length is known. */
  const end = duration > 0 ? Math.min(endSec ?? duration, duration) : (endSec ?? 0);

  useEffect(() => {
    onChange(isNoOpEdit(edit) ? null : edit);
  }, [edit, onChange]);

  const resultSec = duration > 0 ? editedDurationSec(edit, duration) : 0;
  const tooShort = duration > 0 && resultSec < MIN_MASTER_SECONDS;

  const reset = useCallback(() => {
    setStartSec(0);
    setEndSec(null);
    setFadeInSec(0);
    setFadeOutSec(0);
  }, []);

  /** Fade lengths: non-negative, capped. A blank box reads as zero, not NaN. */
  const fadeNum = (raw: string): number => {
    const v = Number.parseFloat(raw);
    if (!Number.isFinite(v) || v < 0) return 0;
    return Math.min(v, MAX_FADE_SECONDS);
  };

  /** Trim times: non-negative, and clamped to the file when its length is known. */
  const timeNum = (raw: string): number => {
    const v = Number.parseFloat(raw);
    if (!Number.isFinite(v) || v < 0) return 0;
    return duration > 0 ? Math.min(v, duration) : v;
  };

  const onDrag = useCallback(
    (a: number, b: number) => {
      if (disabled) return;
      const r = normaliseLoop(a, b, duration);
      if (!r) return;
      setStartSec(r.start);
      // A drag to the very end is "no end trim", so the job stays unedited on
      // that axis rather than pinning an end equal to the duration.
      setEndSec(r.end >= duration ? null : r.end);
    },
    [disabled, duration]
  );

  return (
    <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
          <Scissors className="h-4 w-4" aria-hidden="true" />
          Trim &amp; fade <span className="font-normal text-gray-500">(optional)</span>
        </h3>
        {!isNoOpEdit(edit) && (
          <button
            type="button"
            onClick={reset}
            disabled={disabled}
            className="flex items-center gap-1 text-xs text-gray-600 underline hover:text-gray-900 disabled:opacity-50 dark:text-gray-400 dark:hover:text-gray-100"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            Reset
          </button>
        )}
      </div>

      {peaks && duration > 0 ? (
        <>
          <MasteringWaveform
            peaks={peaks}
            duration={duration}
            position={0}
            loop={region}
            onSeek={() => {}}
            onLoopDrag={onDrag}
            height={56}
            // Not a transport: no playhead, nothing to seek. The two time boxes
            // below are the keyboard-operable control.
            interactive={false}
            ariaLabel={`Waveform of the take. Keeping ${formatTime(start)} to ${formatTime(end)}.`}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Drag across the waveform to choose the part you want to keep, or type the times below.
          </p>
        </>
      ) : (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {note ?? 'Reading the file…'}
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={startId} className="block text-xs font-medium text-gray-700 dark:text-gray-300">
            Keep from (seconds)
          </label>
          <input
            id={startId}
            type="number"
            min={0}
            {...(duration > 0 ? { max: duration } : {})}
            step={0.1}
            value={startSec}
            disabled={disabled}
            onChange={(e) => setStartSec(timeNum(e.target.value))}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm tabular-nums dark:border-gray-600 dark:bg-gray-800"
          />
        </div>
        <div>
          <label htmlFor={endId} className="block text-xs font-medium text-gray-700 dark:text-gray-300">
            Keep until (seconds) <span className="font-normal text-gray-500">— blank = end of file</span>
          </label>
          <input
            id={endId}
            type="number"
            min={0}
            {...(duration > 0 ? { max: duration } : {})}
            step={0.1}
            value={endSec ?? ''}
            disabled={disabled}
            onChange={(e) => setEndSec(e.target.value.trim() === '' ? null : timeNum(e.target.value))}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm tabular-nums dark:border-gray-600 dark:bg-gray-800"
          />
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={fadeInId} className="block text-xs font-medium text-gray-700 dark:text-gray-300">
            Fade in (seconds)
          </label>
          <input
            id={fadeInId}
            type="number"
            min={0}
            max={MAX_FADE_SECONDS}
            step={0.5}
            value={fadeInSec}
            disabled={disabled}
            onChange={(e) => setFadeInSec(fadeNum(e.target.value))}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm tabular-nums dark:border-gray-600 dark:bg-gray-800"
          />
        </div>
        <div>
          <label htmlFor={fadeOutId} className="block text-xs font-medium text-gray-700 dark:text-gray-300">
            Fade out (seconds)
          </label>
          <input
            id={fadeOutId}
            type="number"
            min={0}
            max={MAX_FADE_SECONDS}
            step={0.5}
            value={fadeOutSec}
            disabled={disabled}
            onChange={(e) => setFadeOutSec(fadeNum(e.target.value))}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm tabular-nums dark:border-gray-600 dark:bg-gray-800"
          />
        </div>
        <div>
          <label htmlFor={curveId} className="block text-xs font-medium text-gray-700 dark:text-gray-300">
            Fade shape
          </label>
          <select
            id={curveId}
            value={curve}
            disabled={disabled}
            onChange={(e) => setCurve(e.target.value as FadeCurve)}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
          >
            {FADE_CURVES.map((c) => (
              <option key={c} value={c}>
                {c === 'qsin' ? 'qsin — natural (default)' : c === 'tri' ? 'tri — linear' : c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-3 text-xs" aria-live="polite">
        {isNoOpEdit(edit) ? (
          <p className="text-gray-500 dark:text-gray-400">
            No edit — the whole file will be mastered.
          </p>
        ) : tooShort ? (
          <p className="text-red-600 dark:text-red-400">
            That leaves {resultSec.toFixed(1)}s, under the {MIN_MASTER_SECONDS}s minimum. Widen the selection.
          </p>
        ) : (
          <p className="text-gray-700 dark:text-gray-300">
            {describeEdit(edit, duration)}
            {duration > 0 && (
              <>
                {' — '}
                <span className="font-medium tabular-nums">
                  {formatTime(start)}–{formatTime(end)}
                </span>
                {', master will be '}
                <span className="font-medium tabular-nums">{formatTime(resultSec)}</span>
              </>
            )}
          </p>
        )}
        <p className="mt-1 text-gray-500 dark:text-gray-400">
          Applied before loudness normalisation, so the master still lands exactly on target. Your
          uploaded file is never modified.
        </p>
      </div>
    </div>
  );
}
