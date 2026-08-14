'use client';

/**
 * Interactive metronome.
 *
 * The teaching job matters as much as the clicking: the bar is drawn as its
 * accent pattern (`● ○ ○ ● ○ ○`) with the counting syllables underneath, so
 * switching between 3/4 and 6/8 shows the difference on screen at the same
 * moment it changes in the ear. Both are six pulses; only the GROUPING differs,
 * and that is the whole lesson.
 *
 * Timing lives in the shared audio engine (look-ahead scheduling against the
 * AudioContext clock) — this component only renders and sets parameters. A
 * `setInterval` driving actual clicks would drift audibly within seconds.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { audioEngine } from '@/lib/music/audio-engine';
import {
  METERS,
  meterById,
  accentPattern,
  countingSyllables,
  clampBpm,
  MIN_BPM,
  MAX_BPM,
  DEFAULT_BPM,
  type MeterId,
} from '@/lib/music/meter';

const ACCENT_STYLE: Record<string, string> = {
  strong: 'bg-orange-500 border-orange-500',
  medium: 'bg-orange-300 border-orange-300 dark:bg-orange-700 dark:border-orange-700',
  weak: 'border-gray-400 dark:border-gray-600',
};

export function Metronome({ initialBpm = DEFAULT_BPM, initialMeter = '4/4' as MeterId }) {
  const [bpm, setBpm] = useState(initialBpm);
  const [meterId, setMeterId] = useState<MeterId>(initialMeter);
  const [running, setRunning] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [pulse, setPulse] = useState(-1);

  const meter = meterById(meterId) ?? METERS[1];
  const accents = accentPattern(meter);
  const counts = countingSyllables(meter);

  // Keep the latest values available to the effect without restarting the
  // metronome on every keystroke of the BPM box.
  const params = useRef({ bpm, meterId });
  params.current = { bpm, meterId };

  useEffect(() => audioEngine.onPulse(setPulse), []);

  // Stop the sound if the component goes away — navigating off the page must
  // not leave a metronome ticking under the next screen.
  useEffect(() => () => audioEngine.stopMetronome(), []);

  useEffect(() => {
    if (running) audioEngine.startMetronome(bpm, meter);
  }, [running, bpm, meter]);

  useEffect(() => {
    audioEngine.setVolume(volume);
  }, [volume]);

  const toggle = useCallback(async () => {
    if (running) {
      audioEngine.stopMetronome();
      setRunning(false);
      setPulse(-1);
    } else {
      // Silence anything else first — one tool at a time.
      audioEngine.stopAll();
      await audioEngine.startMetronome(params.current.bpm, meter);
      setRunning(true);
    }
  }, [running, meter]);

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={toggle}
          className={`rounded-md px-4 py-2 text-sm font-medium text-white ${running ? 'bg-red-600 hover:bg-red-700' : 'bg-orange-600 hover:bg-orange-700'}`}
        >
          {running ? '■ Stop' : '▶ Play'}
        </button>

        <div className="flex items-center gap-2">
          <label htmlFor="bpm" className="text-xs text-gray-500">BPM</label>
          <input
            id="bpm"
            type="range"
            min={MIN_BPM}
            max={MAX_BPM}
            value={bpm}
            onChange={(e) => setBpm(clampBpm(Number(e.target.value)))}
            className="w-40"
          />
          <input
            type="number"
            aria-label="tempo in BPM"
            min={MIN_BPM}
            max={MAX_BPM}
            value={bpm}
            onChange={(e) => setBpm(clampBpm(Number(e.target.value)))}
            className="w-16 rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900"
          />
        </div>

        <div className="flex items-center gap-1">
          {METERS.map((m) => (
            <button
              key={m.id}
              onClick={() => setMeterId(m.id)}
              className={`rounded-md px-2 py-1 text-sm ${
                meterId === m.id
                  ? 'bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900'
                  : 'border border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300'
              }`}
            >
              {m.id}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="vol" className="text-xs text-gray-500">Vol</label>
          <input id="vol" type="range" min={0} max={1} step={0.05} value={volume}
            onChange={(e) => setVolume(Number(e.target.value))} className="w-24" />
        </div>
      </div>

      {/* The bar, drawn as its accent pattern. */}
      <div>
        <div className="flex flex-wrap gap-2" role="group" aria-label={`${meter.id} pulse pattern`}>
          {accents.map((accent, i) => (
            <div key={i} className="flex w-8 flex-col items-center gap-1">
              <span
                data-testid={`pulse-${i}`}
                data-accent={accent}
                className={`h-7 w-7 rounded-full border-2 transition-transform ${ACCENT_STYLE[accent]} ${
                  pulse === i ? 'scale-125 ring-2 ring-orange-400' : ''
                }`}
              />
              <span className="text-[11px] text-gray-500">{counts[i]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Why this meter is not the other one. */}
      <p className="text-xs text-gray-600 dark:text-gray-300">
        <strong>{meter.id} · {meter.name}</strong> ({meter.tamil}) — {meter.description}
      </p>
      {meter.id === '6/8' && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          Compare with <strong>3/4</strong>: both have six pulses, but 3/4 accents every <em>second</em> pulse
          (three beats of two) and 6/8 every <em>third</em> (two beats of three). Switch between them while it
          plays — the pulses do not change, the grouping does.
        </p>
      )}
    </div>
  );
}
