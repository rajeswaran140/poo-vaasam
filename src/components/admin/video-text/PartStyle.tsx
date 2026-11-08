'use client';

/**
 * One part's look (Title, Lyrics or Credits): size, Tamil font, English font
 * and where it sits, with a sample line written in the chosen fonts.
 */
import { useId, type ReactNode } from 'react';
import {
  ENGLISH_FONTS,
  TAMIL_FONTS,
  TRACK_SIZE_MAX,
  TRACK_SIZE_MIN,
  TEXT_COLORS,
  englishFont,
  tamilFont,
  textColor,
  type FontChoice,
} from '@/lib/video-text/fonts';
import type { EnglishFontId, TamilFontId, TrackStyle } from '@/types/videoText';

/** CSS for showing text in these fonts on the page (the DOM can use var(), unlike the canvas). */
export function cssFontFamily(tamil: FontChoice<string>, english: FontChoice<string>): string {
  const parts = [english.cssVar ? `var(${english.cssVar})` : '', tamil.cssVar ? `var(${tamil.cssVar})` : ''].filter(Boolean);
  return [...parts, '"Noto Sans", sans-serif'].join(', ');
}

const SAMPLE = 'தமிழ் Abc';
const SELECT =
  'min-w-0 max-w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900';

export interface PartStyleProps {
  label: string;
  /** The part's effective look (its own settings, else the project defaults). */
  value: Required<TrackStyle>;
  onChange(patch: TrackStyle): void;
  /** The position control (placement grid or Lower/Middle). */
  position: ReactNode;
}

export function PartStyle({ label, value, onChange, position }: PartStyleProps) {
  const ids = { size: useId(), tamil: useId(), english: useId(), box: useId(), fade: useId() };
  const ta = tamilFont(value.tamilFont);
  const en = englishFont(value.englishFont);
  return (
    <fieldset className="min-w-0 rounded-md border border-gray-200 px-3 pb-3 pt-1 dark:border-gray-700" data-testid={`part-${label}`}>
      <legend className="px-1 text-sm font-semibold text-gray-800 dark:text-gray-100">{label}</legend>
      <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <label htmlFor={ids.size} className="text-sm text-gray-700 dark:text-gray-200">
            Size
          </label>
          <input
            id={ids.size}
            type="range"
            min={TRACK_SIZE_MIN}
            max={TRACK_SIZE_MAX}
            step={0.05}
            value={value.size}
            onChange={(e) => onChange({ size: Number(e.target.value) })}
            className="w-32 min-w-0 max-w-full accent-orange-600"
          />
          <span className="w-10 text-xs tabular-nums text-gray-500 dark:text-gray-400">{Math.round(value.size * 100)}%</span>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <label htmlFor={ids.tamil} className="text-sm text-gray-700 dark:text-gray-200">
            Tamil font
          </label>
          <select
            id={ids.tamil}
            value={ta.id}
            onChange={(e) => onChange({ tamilFont: e.target.value as TamilFontId })}
            className={SELECT}
          >
            {TAMIL_FONTS.map((f) => (
              <option key={f.id} value={f.id} style={{ fontFamily: cssFontFamily(f, englishFont(undefined)) }}>
                {f.label} — {f.hint}
              </option>
            ))}
          </select>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <label htmlFor={ids.english} className="text-sm text-gray-700 dark:text-gray-200">
            English font
          </label>
          <select
            id={ids.english}
            value={en.id}
            onChange={(e) => onChange({ englishFont: e.target.value as EnglishFontId })}
            className={SELECT}
          >
            {ENGLISH_FONTS.map((f) => (
              <option key={f.id} value={f.id} style={{ fontFamily: cssFontFamily(tamilFont(undefined), f) }}>
                {f.label} — {f.hint}
              </option>
            ))}
          </select>
        </div>

        <div role="radiogroup" aria-label={`${label} colour`} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm text-gray-700 dark:text-gray-200" aria-hidden="true">
            Colour
          </span>
          {TEXT_COLORS.map((c) => {
            const on = value.color === c.id;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={c.label}
                title={c.label}
                onClick={() => onChange({ color: c.id })}
                className={`h-7 w-7 rounded-full border-2 ${on ? 'border-orange-600 ring-2 ring-orange-300' : 'border-gray-400 dark:border-gray-600'}`}
                style={{ backgroundColor: c.css }}
              />
            );
          })}
        </div>

        <label htmlFor={ids.box} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input
            id={ids.box}
            type="checkbox"
            checked={value.box}
            onChange={(e) => onChange({ box: e.target.checked })}
            className="h-4 w-4 accent-orange-600"
          />
          Box behind text
        </label>

        <label htmlFor={ids.fade} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input
            id={ids.fade}
            type="checkbox"
            checked={value.fade}
            onChange={(e) => onChange({ fade: e.target.checked })}
            className="h-4 w-4 accent-orange-600"
          />
          Fade in and out
        </label>

        {position}

        <span
          className="min-w-0 rounded bg-gray-900 px-2 py-0.5 text-lg dark:bg-black"
          style={{ fontFamily: cssFontFamily(ta, en), fontWeight: ta.weight, color: textColor(value.color).css }}
          data-testid={`sample-${label}`}
          aria-label={`Sample in ${ta.label} and ${en.label}`}
        >
          {SAMPLE}
        </span>
      </div>
    </fieldset>
  );
}
