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
import { parseClock, formatClock } from '@/components/admin/ShortWindowFields';

export interface Slide {
  /** S3 key once the image is uploaded; null until then. */
  key: string | null;
  /** The file's own name, shown back so the operator can tell images apart. */
  name: string | null;
  /** What was typed in "starts at" — kept as text so a half-typed time is not lost. */
  at: string;
  /**
   * True while `at` was filled in FOR the operator and they have not touched
   * it. Only these are re-spread when the list changes — a typed time is
   * theirs and is never moved.
   */
  auto?: boolean;
}

/** Spacing between images when the song's length is not known. */
const UNKNOWN_LENGTH_STEP_SECONDS = 30;

/**
 * Fill in the start time of every image the operator has not timed themselves.
 *
 * ⚠️ WHY. An image used to need a start time TYPED before anything could be
 * rendered, and nothing said so: Raj uploaded his images and found the render
 * button dead (2026-10-01). Uploading an image should be enough. The images
 * are spread evenly across the song — cover + N images cut it into N+1 equal
 * stretches — and every one of those times stays editable.
 */
export function spreadSlides(slides: readonly Slide[], durationSec: number | null | undefined): Slide[] {
  const images = slides.length + 1; // the cover is image 1
  const known = typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec > 0;
  return slides.map((s, i) => {
    if (s.auto === false) return s;
    const at = known ? Math.round((durationSec * (i + 1)) / images) : (i + 1) * UNKNOWN_LENGTH_STEP_SECONDS;
    return { ...s, at: formatClock(at), auto: true };
  });
}

/**
 * Why the list cannot be rendered yet, in the operator's words — or null.
 *
 * Shown beside the images, because the render buttons are disabled while this
 * is non-null and a greyed-out button explains nothing.
 */
export function slidesProblem(slides: readonly Slide[]): string | null {
  for (const [i, s] of slides.entries()) {
    const n = i + 2;
    if (!s.key) return `Image ${n} has no file yet — choose one, or remove it with ×.`;
    if (s.at.trim() === '') return `Image ${n} needs a start time, like 1:30.`;
    if (parseClock(s.at) === null) return `Image ${n}: “${s.at.trim()}” is not a time — use 1:30, or plain seconds.`;
  }
  return null;
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
  /** The song's length, when known — start times are spread across it. */
  durationSec?: number | null;
}

export function SlideshowFields({ slides, onChange, onPickImage, disabled = false, idPrefix, durationSec }: Props) {
  const canAdd = slides.length + 1 < MAX_SLIDESHOW_COVERS;
  const patch = (i: number, over: Partial<Slide>) =>
    onChange(slides.map((s, j) => (j === i ? { ...s, ...over } : s)));
  const problem = slidesProblem(slides);

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
                  // Typed ⇒ theirs: it is never re-spread again.
                  onChange={(e) => patch(i, { at: e.target.value, auto: false })}
                  className={`w-16 rounded border px-1.5 py-0.5 text-xs text-gray-900 dark:bg-gray-900 dark:text-gray-100 ${
                    badTime ? 'border-red-500' : 'border-gray-300 dark:border-gray-700'
                  }`}
                />
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(spreadSlides(slides.filter((_, j) => j !== i), durationSec))}
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
          onClick={() => onChange(spreadSlides([...slides, { key: null, name: null, at: '', auto: true }], durationSec))}
          className="inline-flex items-center gap-1 rounded border border-orange-300 px-2 py-1 text-xs font-medium text-orange-700 disabled:opacity-50 dark:border-orange-700 dark:text-orange-300"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add image
        </button>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {slides.length === 0
            ? 'Optional — more images make a slideshow, in the video, the short and the whole-song vertical. The cover stays first, from 0:00.'
            : `The cover shows from 0:00. Start times are filled in for you, evenly across the song — change any of them (1:30 or seconds, in order). Each image stays at least ${MIN_SEGMENT_SECONDS}s. Up to ${MAX_SLIDESHOW_COVERS} images. A short shows whichever of them fall inside its window.`}
        </span>
      </div>
      {/* WHY THE RENDER BUTTONS ARE DISABLED. They are, while this is shown —
          and a greyed-out button on its own says nothing. */}
      {problem && (
        <p role="status" className="mt-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
          {problem} The render buttons stay off until then.
        </p>
      )}
    </div>
  );
}
