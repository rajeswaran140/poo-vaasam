'use client';

/**
 * Monitoring equaliser for the saved-masters player.
 *
 * ⚠️ THIS NEVER ALTERS THE FILE. It shapes browser playback so a master can be
 * auditioned as a phone speaker, earbuds, or with 4 kHz lifted to expose
 * harshness. The mastering module's promise is "loudness only, never tone", and
 * the standing decision is that tone lives upstream at take selection — so the
 * one thing this component must never do is let Raj mistake a shaped monitor
 * for the delivered master.
 *
 * Two guarantees carry that, and both are load-bearing:
 *   1. It starts FLAT, so the first thing heard is always the real file.
 *   2. Whenever it is NOT flat, a warning states so and names the bands.
 *
 * Implementation notes worth keeping:
 * PRESENTATIONAL ONLY. It owns no AudioContext: `createMediaElementSource` can
 * be called just once per media element, so the player owns the graph and this
 * renders controls over it. Two components each building their own graph is
 * exactly the bug that refactor prevented.
 */

import { useCallback, useState } from 'react';
import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import {
  EQ_BANDS,
  EQ_PRESETS,
  EQ_MAX_GAIN_DB,
  EQ_MIN_GAIN_DB,
  flatGains,
  clampGain,
  isFlat,
  describeEq,
  type EqGains,
} from '@/lib/audio-eq';

interface Props {
  gains: EqGains;
  onChange: (gains: EqGains) => void;
  /** Set when the graph could not be built — e.g. a cross-origin source. */
  unavailable?: string | null;
}

export function MasteringEqualizer({ gains, onChange, unavailable = null }: Props) {
  const [open, setOpen] = useState(false);

  const setBand = useCallback(
    (id: string, db: number) => onChange({ ...gains, [id]: clampGain(db) }),
    [gains, onChange]
  );
  const reset = useCallback(() => onChange(flatGains()), [onChange]);

  const flat = isFlat(gains);

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-1.5 rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          Equaliser
        </button>
        {!flat && (
          <span
            role="status"
            className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
          >
            ⚠️ Not the master — {describeEq(gains)}
          </span>
        )}
      </div>

      {open && (
        <div className="mt-2 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900/40">
          <p className="mb-2 text-xs text-gray-600 dark:text-gray-300">
            <strong>Monitoring only.</strong> This changes what you hear, never the file. The saved
            WAV and its measured loudness are untouched.
          </p>

          {unavailable ? (
            <p className="text-xs text-rose-700 dark:text-rose-300">{unavailable}</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {EQ_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onChange({ ...p.gains })}
                    title={p.hint}
                    className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                  >
                    {p.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={reset}
                  disabled={flat}
                  className="ml-auto flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 disabled:opacity-40 dark:border-gray-700 dark:text-gray-200"
                >
                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                  Reset to flat
                </button>
              </div>

              <div className="mt-3 grid grid-cols-5 gap-2">
                {EQ_BANDS.map((band) => (
                  <label key={band.id} className="flex flex-col items-center gap-1 text-[11px]">
                    <input
                      type="range"
                      min={EQ_MIN_GAIN_DB}
                      max={EQ_MAX_GAIN_DB}
                      step={1}
                      value={gains[band.id] ?? 0}
                      onChange={(e) => setBand(band.id, Number(e.target.value))}
                      aria-label={band.label}
                      className="w-full"
                    />
                    <span className="text-gray-600 dark:text-gray-300">{band.label}</span>
                    <span className="tabular-nums text-gray-500 dark:text-gray-400">
                      {(gains[band.id] ?? 0) > 0 ? '+' : ''}
                      {gains[band.id] ?? 0} dB
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
