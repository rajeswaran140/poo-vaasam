'use client';

/**
 * The logo watermark: upload the one logo (saved, reused by every project),
 * then per project: show it or not, which corner, size (% of the video's
 * height), opacity and a hand move. Picking a corner puts it back exactly in
 * that corner.
 */
import { useId, useRef } from 'react';
import { LOGO_HEIGHT_PCT_MAX, LOGO_HEIGHT_PCT_MIN, LOGO_TYPES, logoStyleOf } from '@/lib/video-text/logo';
import type { LogoCorner, LogoStyle, TextStyle } from '@/types/videoText';
import { NumberBox } from './PartStyle';
import type { LogoState } from './useSavedLogo';

const CORNER_NAME: Record<LogoCorner, string> = {
  'top-left': 'Top left',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'bottom-right': 'Bottom right',
};
const CORNERS: LogoCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const pct = (fraction: number) => Math.round(fraction * 1000) / 10;
const SMALL_BUTTON =
  'rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800';

export interface LogoPanelProps {
  style: TextStyle;
  onChange(patch: LogoStyle): void;
  logo: LogoState;
  onUpload(file: File): void;
  uploading: boolean;
  uploadError: string | null;
  disabled?: boolean;
}

export function LogoPanel({ style, onChange, logo, onUpload, uploading, uploadError, disabled }: LogoPanelProps) {
  const ids = { file: useId(), show: useId(), size: useId(), sizeBox: useId(), opacity: useId(), opacityBox: useId(), mx: useId(), my: useId() };
  const fileInput = useRef<HTMLInputElement>(null);
  const look = logoStyleOf(style);
  const moved = look.offset.x !== 0 || look.offset.y !== 0;
  const setOffset = (axis: 'x' | 'y', percent: number) =>
    onChange({ offset: { ...look.offset, [axis]: Math.round(percent * 10) / 1000 } });
  const ready = logo.kind === 'ready';

  return (
    <fieldset className="min-w-0 rounded-md border border-gray-200 px-3 pb-3 pt-1 dark:border-gray-700" data-testid="logo-panel">
      <legend className="px-1 text-sm font-semibold text-gray-800 dark:text-gray-100">Logo</legend>
      <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-3">
        {logo.kind === 'loading' && <p className="text-sm text-gray-500 dark:text-gray-400">Loading the logo…</p>}
        {logo.kind === 'error' && <p className="text-sm text-red-600 dark:text-red-400">{logo.message}</p>}
        {logo.kind === 'none' && (
          <p className="text-sm text-gray-600 dark:text-gray-300">Upload your logo once — every video can then use it. A PNG with a see-through background looks best.</p>
        )}
        {ready && (
          <span className="inline-flex items-center rounded bg-gray-900 p-1 dark:bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element -- a 1-hour private S3 link, not an optimisable asset */}
            <img src={logo.logo.url} alt="Your saved logo" className="h-10 w-auto max-w-[10rem] object-contain" data-testid="logo-thumb" />
          </span>
        )}

        {logo.kind !== 'loading' && (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              id={ids.file}
              type="file"
              accept={LOGO_TYPES.join(',')}
              className="sr-only"
              aria-label={ready ? 'Replace logo' : 'Upload logo'}
              disabled={uploading || disabled}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) onUpload(f);
              }}
            />
            <button type="button" className={SMALL_BUTTON} disabled={uploading || disabled} onClick={() => fileInput.current?.click()}>
              {uploading ? 'Uploading…' : ready ? 'Replace logo…' : 'Upload logo…'}
            </button>
            {ready && <span className="text-xs text-gray-500 dark:text-gray-400">Replacing it changes the logo in every video made from now on.</span>}
          </div>
        )}

        {ready && (
          <label htmlFor={ids.show} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
            <input
              id={ids.show}
              type="checkbox"
              checked={look.show}
              onChange={(e) => onChange({ show: e.target.checked })}
              className="h-4 w-4 accent-orange-600"
            />
            Show the logo on this video
          </label>
        )}

        {ready && look.show && (
          <>
            <div role="radiogroup" aria-label="Logo corner" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm text-gray-700 dark:text-gray-200" aria-hidden="true">
                Corner
              </span>
              <div className="inline-flex flex-wrap overflow-hidden rounded-md border border-gray-300 dark:border-gray-700">
                {CORNERS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={look.corner === c}
                    onClick={() => onChange({ corner: c, offset: { x: 0, y: 0 } })}
                    className={`px-2.5 py-1.5 text-xs ${
                      look.corner === c
                        ? 'bg-orange-600 text-white'
                        : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800'
                    }`}
                  >
                    {CORNER_NAME[c]}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <label htmlFor={ids.size} className="text-sm text-gray-700 dark:text-gray-200">
                Logo size
              </label>
              <input
                id={ids.size}
                type="range"
                min={LOGO_HEIGHT_PCT_MIN}
                max={LOGO_HEIGHT_PCT_MAX}
                step={0.5}
                value={look.heightPct}
                onChange={(e) => onChange({ heightPct: Number(e.target.value) })}
                className="w-32 min-w-0 max-w-full accent-orange-600"
                aria-valuetext={`${look.heightPct}% of the video's height`}
              />
              <NumberBox
                id={ids.sizeBox}
                label="Logo size, % of the video's height"
                value={look.heightPct}
                min={LOGO_HEIGHT_PCT_MIN}
                max={LOGO_HEIGHT_PCT_MAX}
                step={0.5}
                onCommit={(n) => onChange({ heightPct: n })}
              />
              <span className="text-xs text-gray-500 dark:text-gray-400">% of video height</span>
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <label htmlFor={ids.opacity} className="text-sm text-gray-700 dark:text-gray-200">
                Opacity
              </label>
              <input
                id={ids.opacity}
                type="range"
                min={10}
                max={100}
                step={5}
                value={Math.round(look.opacity * 100)}
                onChange={(e) => onChange({ opacity: Number(e.target.value) / 100 })}
                className="w-32 min-w-0 max-w-full accent-orange-600"
                aria-valuetext={`${Math.round(look.opacity * 100)}%`}
              />
              <NumberBox
                id={ids.opacityBox}
                label="Logo opacity, %"
                value={Math.round(look.opacity * 100)}
                min={10}
                max={100}
                step={5}
                onCommit={(n) => onChange({ opacity: Math.round(n) / 100 })}
              />
              <span className="text-xs text-gray-500 dark:text-gray-400">% (100 = solid)</span>
            </div>

            <div role="group" aria-label="Logo moved by hand" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" data-testid="offset-logo">
              <span className="text-sm text-gray-700 dark:text-gray-200" aria-hidden="true">
                Move
              </span>
              <label htmlFor={ids.mx} className="text-xs text-gray-500 dark:text-gray-400">
                → right
              </label>
              <NumberBox id={ids.mx} label="Logo: move right, % of the video's width" value={pct(look.offset.x)} min={-100} max={100} step={0.5} onCommit={(n) => setOffset('x', n)} />
              <label htmlFor={ids.my} className="text-xs text-gray-500 dark:text-gray-400">
                ↓ down
              </label>
              <NumberBox id={ids.my} label="Logo: move down, % of the video's height" value={pct(look.offset.y)} min={-100} max={100} step={0.5} onCommit={(n) => setOffset('y', n)} />
              <span className="text-xs text-gray-500 dark:text-gray-400">%</span>
              {moved && (
                <button type="button" className={SMALL_BUTTON} onClick={() => onChange({ offset: { x: 0, y: 0 } })}>
                  Reset to corner
                </button>
              )}
            </div>
          </>
        )}

        {uploadError && (
          <p role="alert" className="w-full text-xs text-red-600 dark:text-red-400">
            {uploadError}
          </p>
        )}
      </div>
    </fieldset>
  );
}
