'use client';

/**
 * One part's look (Title, Lyrics or Credits): size, Tamil font, English font
 * and where it sits, with a sample line written in the chosen fonts.
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
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
import { GOOGLE_FONTS } from '@/lib/video-text/google-fonts';
import { googleFamilyName, loadGoogleFont } from '@/lib/video-text/google-font-loader';
import { GoogleFontSearch } from './GoogleFontSearch';
import type { EnglishFontId, TamilFontId, TrackStyle } from '@/types/videoText';

/** Google fonts with Tamil that are not already built in (those stay self-hosted). */
const GOOGLE_TAMIL = GOOGLE_FONTS.filter((f) => f.tamil && !TAMIL_FONTS.some((b) => b.label === f.family));

/** CSS for showing text in these fonts on the page (the DOM can use var(), unlike the canvas). */
export function cssFontFamily(tamil: FontChoice<string>, english: FontChoice<string>): string {
  const one = (c: FontChoice<string>, slot: 'tamil' | 'latin') =>
    c.google ? googleFamilyName(c.google, slot) : c.cssVar ? `var(${c.cssVar})` : '';
  const parts = [one(english, 'latin'), one(tamil, 'tamil')].filter(Boolean);
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
  const [searching, setSearching] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // A chosen Google font downloads now, so the sample (and the preview) show it.
  useEffect(() => {
    let live = true;
    setLoadError(null);
    const want = [
      ta.google && loadGoogleFont(ta.google, 'tamil'),
      en.google && loadGoogleFont(en.google, 'latin'),
    ].filter(Boolean) as Promise<string>[];
    Promise.all(want).catch(() => {
      if (live) setLoadError('This Google font did not load. Check the connection, or pick another font.');
    });
    return () => {
      live = false;
    };
  }, [ta.google, en.google]);
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
            <optgroup label="Built in">
              {TAMIL_FONTS.map((f) => (
                <option key={f.id} value={f.id} style={{ fontFamily: cssFontFamily(f, englishFont(undefined)) }}>
                  {f.label} — {f.hint}
                </option>
              ))}
            </optgroup>
            <optgroup label="Google fonts">
              {GOOGLE_TAMIL.map((f) => (
                <option key={f.family} value={`g:${f.family}`}>
                  {f.family}
                </option>
              ))}
            </optgroup>
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
            {en.google && (
              <option value={en.id}>
                {en.label} — Google font
              </option>
            )}
          </select>
          <button
            type="button"
            onClick={() => setSearching((v) => !v)}
            aria-expanded={searching}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            More fonts…
          </button>
        </div>

        {searching && (
          <GoogleFontSearch
            label={label}
            onPick={(id) => {
              onChange({ englishFont: id });
              setSearching(false);
            }}
            onClose={() => setSearching(false)}
          />
        )}

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
        {loadError && (
          <p role="alert" className="w-full text-xs text-red-600 dark:text-red-400">
            {loadError}
          </p>
        )}
      </div>
    </fieldset>
  );
}
