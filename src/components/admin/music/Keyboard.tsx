'use client';

/**
 * Playable virtual keyboard.
 *
 * ⚠️ THE TONIC CONTROL IS THE POINT, not a decoration. Swara labels are
 * computed from the SELECTED TONIC (`swaraFor(midi, tonicMidi)`), so moving the
 * tonic from C to G re-labels every key: middle C stops being Sa and becomes
 * Ma₁. A keyboard that printed a fixed "C=Sa, D=Ri" strip would teach the exact
 * misconception this module is meant to correct.
 *
 * Layout: white keys tile left-to-right; black keys are absolutely positioned
 * against the white key before them. Evenly spacing twelve keys would be wrong,
 * because there is no black key between E–F or B–C.
 */

import { useCallback, useEffect, useState } from 'react';
import { audioEngine } from '@/lib/music/audio-engine';
import {
  buildKeyboard,
  whiteKeyCount,
  noteName,
  swaraFor,
  midiFor,
  isInScale,
  scaleNotes,
  NOTE_NAMES_SHARP,
  SCALES,
  RAGA_VS_SCALE_NOTE,
} from '@/lib/music/pitch';

/** Computer-keyboard row → offset from the keyboard's first note. */
const KEY_MAP: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12,
};

export function Keyboard({ octaves = 2, startOctave = 4 }: { octaves?: number; startOctave?: number }) {
  const [octave, setOctave] = useState(startOctave);
  const [tonicPc, setTonicPc] = useState(0); // C
  const [showSwara, setShowSwara] = useState(true);
  const [scaleId, setScaleId] = useState('');
  const [held, setHeld] = useState<number | null>(null);

  const startMidi = (octave + 1) * 12;
  const keys = buildKeyboard(startMidi, octaves);
  const whites = whiteKeyCount(keys);
  const tonicMidi = startMidi + tonicPc;
  const scale = SCALES.find((s) => s.id === scaleId);

  const play = useCallback((midi: number) => {
    audioEngine.resume().then(() => audioEngine.playNote(midi));
    setHeld(midi);
    setTimeout(() => setHeld((h) => (h === midi ? null : h)), 220);
  }, []);

  // Typing row plays notes. Ignored while a text field has focus, so the BPM
  // box and the lyric textarea elsewhere on the page keep working normally.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      const offset = KEY_MAP[e.key.toLowerCase()];
      if (offset === undefined || e.repeat || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      play(startMidi + offset);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [startMidi, play]);

  const playScale = (descending = false) => {
    if (!scale) return;
    audioEngine.stopAll();
    const notes = scaleNotes(scale, tonicMidi);
    audioEngine.playSequence(descending ? [...notes].reverse() : notes, 0.38);
  };

  const label = (midi: number) =>
    showSwara ? swaraFor(midi, tonicMidi).short : noteName(midi).replace(/\d/, '');

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="flex items-center gap-1">
          <label htmlFor="tonic" className="text-xs text-gray-500">Tonic (சுருதி)</label>
          <select
            id="tonic"
            value={tonicPc}
            onChange={(e) => setTonicPc(Number(e.target.value))}
            className="rounded-md border border-gray-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-900"
          >
            {NOTE_NAMES_SHARP.map((n, i) => (
              <option key={n} value={i}>{n}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1">
          <label htmlFor="octave" className="text-xs text-gray-500">Octave</label>
          <select id="octave" value={octave} onChange={(e) => setOctave(Number(e.target.value))}
            className="rounded-md border border-gray-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-900">
            {[2, 3, 4, 5].map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>

        <label className="flex items-center gap-1 text-xs text-gray-500">
          <input type="checkbox" checked={showSwara} onChange={(e) => setShowSwara(e.target.checked)} />
          show swara
        </label>

        <div className="flex items-center gap-1">
          <select value={scaleId} onChange={(e) => setScaleId(e.target.value)} aria-label="scale"
            className="rounded-md border border-gray-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-900">
            <option value="">no scale</option>
            {SCALES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {scale && (
            <>
              <button onClick={() => playScale(false)} className="rounded-md border border-gray-300 px-2 py-1 text-xs dark:border-gray-600">▲ Asc</button>
              <button onClick={() => playScale(true)} className="rounded-md border border-gray-300 px-2 py-1 text-xs dark:border-gray-600">▼ Desc</button>
            </>
          )}
        </div>
      </div>

      {/* The keyboard itself. */}
      <div className="relative h-40 select-none" style={{ width: `${whites * 2.5}rem` }} role="group" aria-label="virtual keyboard">
        {keys.filter((k) => !k.black).map((k) => {
          const inScale = scale ? isInScale(k.midi, scale, tonicMidi) : false;
          const isTonic = ((k.midi - tonicMidi) % 12 + 12) % 12 === 0;
          return (
            <button
              key={k.midi}
              onMouseDown={() => play(k.midi)}
              aria-label={`${noteName(k.midi)}${showSwara ? ` ${swaraFor(k.midi, tonicMidi).short}` : ''}`}
              className={`absolute top-0 flex h-40 w-10 flex-col items-center justify-end rounded-b border pb-2 text-[11px] ${
                held === k.midi ? 'bg-orange-200 dark:bg-orange-800' : 'bg-white dark:bg-gray-100'
              } ${isTonic ? 'border-orange-500 border-2' : 'border-gray-300'} ${
                scale && !inScale ? 'opacity-40' : ''
              }`}
              style={{ left: `${k.whiteIndex * 2.5}rem` }}
            >
              <span className="font-medium text-gray-700">{label(k.midi)}</span>
            </button>
          );
        })}
        {keys.filter((k) => k.black).map((k) => {
          const inScale = scale ? isInScale(k.midi, scale, tonicMidi) : false;
          const isTonic = ((k.midi - tonicMidi) % 12 + 12) % 12 === 0;
          return (
            <button
              key={k.midi}
              onMouseDown={() => play(k.midi)}
              aria-label={`${noteName(k.midi)}${showSwara ? ` ${swaraFor(k.midi, tonicMidi).short}` : ''}`}
              className={`absolute top-0 z-10 flex h-24 w-6 flex-col items-center justify-end rounded-b pb-1 text-[10px] text-white ${
                held === k.midi ? 'bg-orange-600' : 'bg-gray-800'
              } ${isTonic ? 'ring-2 ring-orange-500' : ''} ${scale && !inScale ? 'opacity-40' : ''}`}
              style={{ left: `${k.whiteIndex * 2.5 + 1.75}rem` }}
            >
              <span>{label(k.midi)}</span>
            </button>
          );
        })}
      </div>

      <p className="text-xs text-gray-500">
        Click a key, or use <code>A W S E D F T G Y H U J K</code>. The tonic is outlined —
        <strong> Sa moves with it</strong>. With tonic {NOTE_NAMES_SHARP[tonicPc]}, {NOTE_NAMES_SHARP[tonicPc]} is Sa
        and C is {swaraFor(midiFor('C', octave)!, tonicMidi).short}.
      </p>
      {scale?.note && <p className="text-xs text-gray-500">{scale.note}</p>}
      {scale && /am$|ragam|priya/i.test(scale.name) && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          {RAGA_VS_SCALE_NOTE}
        </p>
      )}
    </div>
  );
}
