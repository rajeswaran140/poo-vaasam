'use client';

/**
 * The extra images of a slideshow — every image AFTER the cover.
 *
 * WHY IT EXISTS. The multi-image render (several covers, hard cuts) was built
 * in the route and the worker in PR #346 and never given a screen: nothing in
 * the studio sent `covers`, so it could not be used at all.
 *
 * The cover is image 1 and always starts at 0:00 — the worker records it as
 * the job's cover and YouTube takes it as the thumbnail — so it is not listed
 * here. This lists image 2 onward: a file, and the time it cuts in.
 *
 * Controlled, and it owns no uploads: the parent uploads the file (it already
 * has the cover's upload path, its busy state and its row-level error) and
 * hands the stored key back in `slides`.
 */

import { Plus, X } from 'lucide-react';
import { MAX_SLIDESHOW_COVERS, MIN_SEGMENT_SECONDS } from '@/lib/master-video';
import { parseClock } from '@/components/admin/ShortWindowFields';

export interface Slide {
  /** S3 key once the image is uploaded; null until then. */
  key: string | null;
  /** The file's own name, shown back so the operator can tell images apart. */
  name: string | null;
  /** What was typed in "starts at" — kept as text so a half-typed time is not lost. */
  at: string;
}

/** The cut list as the route wants it, or null while any image is unfinished. */
export function slidesToCovers(
  coverKey: string,
  slides: readonly Slide[]
): Array<{ coverKey: string; startSec: number }> | null {
  const covers = [{ coverKey, startSec: 0 }];
  for (const s of slides) {
    const startSec = parseClock(s.at);
    if (!s.key || startSec === null) return null;
    covers.push({ coverKey: s.key, startSec });
  }
  return covers;
}

interface Props {
  slides: readonly Slide[];
  onChange: (slides: Slide[]) => void;
  /** Upload this file for the image at `index`; the parent stores the key. */
  onPickImage: (index: number, file: File) => void;
  disabled?: boolean;
  idPrefix: string;
}

export function SlideshowFields({ slides, onChange, onPickImage, disabled = false, idPrefix }: Props) {
  const canAdd = slides.length + 1 < MAX_SLIDESHOW_COVERS;
  const patch = (i: number, over: Partial<Slide>) =>
    onChange(slides.map((s, j) => (j === i ? { ...s, ...over } : s)));

  return (
    <div className="w-full">
      {slides.length > 0 && (
        <ul className="mb-2 space-y-1.5">
          {slides.map((s, i) => {
            const n = i + 2; // the cover is image 1
            const badTime = s.at.trim() !== '' && parseClock(s.at) === null;
            return (
              <li key={i} className="flex flex-wrap items-center gap-2 text-xs">
                <label htmlFor={`${idPrefix}-img-${i}`} className="font-medium text-gray-600 dark:text-gray-300">
                  Image {n}
                </label>
                <input
                  id={`${idPrefix}-img-${i}`}
                  type="file"
                  accept="image/*"
                  disabled={disabled}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onPickImage(i, f);
                  }}
                  className="text-xs"
                />
                {s.name && <span className="text-gray-500 dark:text-gray-400">{s.name}</span>}
                <label htmlFor={`${idPrefix}-at-${i}`} className="text-gray-600 dark:text-gray-300">
                  Image {n} starts at
                </label>
                <input
                  id={`${idPrefix}-at-${i}`}
                  type="text"
                  inputMode="numeric"
                  placeholder="1:30"
                  value={s.at}
                  disabled={disabled}
                  aria-invalid={badTime}
                  onChange={(e) => patch(i, { at: e.target.value })}
                  className={`w-16 rounded border px-1.5 py-0.5 text-xs text-gray-900 dark:bg-gray-900 dark:text-gray-100 ${
                    badTime ? 'border-red-500' : 'border-gray-300 dark:border-gray-700'
                  }`}
                />
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(slides.filter((_, j) => j !== i))}
                  aria-label={`Remove image ${n}`}
                  className="rounded p-0.5 text-gray-500 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled || !canAdd}
          onClick={() => onChange([...slides, { key: null, name: null, at: '' }])}
          className="inline-flex items-center gap-1 rounded border border-orange-300 px-2 py-1 text-xs font-medium text-orange-700 disabled:opacity-50 dark:border-orange-700 dark:text-orange-300"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add image
        </button>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {slides.length === 0
            ? 'Optional — more images make the video a slideshow. The cover stays first, from 0:00.'
            : `The cover shows from 0:00. Times as 1:30 or seconds, in order; each image stays at least ${MIN_SEGMENT_SECONDS}s. Up to ${MAX_SLIDESHOW_COVERS} images.`}
        </span>
      </div>
    </div>
  );
}
