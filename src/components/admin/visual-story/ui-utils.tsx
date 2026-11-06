'use client';

/** Small helpers shared by the studio's components: money, shot keys, signed previews. */

import { useEffect, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import type { AspectRatio, Shot } from '@/types/visualStory';

export const usd = (n: number) => `$${n.toFixed(2)}`;

/** The bottom bar's Budget field, so an over-budget message can send the user to it. */
export const BUDGET_INPUT_ID = 'vs-budget';

/** Shown beside an over-budget message: brings the Budget field into view and focuses it. */
export function RaiseBudgetButton() {
  const go = () => {
    const el = document.getElementById(BUDGET_INPUT_ID) as HTMLInputElement | null;
    el?.scrollIntoView?.({ block: 'center' });
    el?.focus();
  };
  return (
    <button type="button" onClick={go} className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-300">
      Raise budget
    </button>
  );
}

/** `nnn-mmm`, the shot key the still and video routes take. */
export const shotKey = (s: Pick<Shot, 'sceneOrder' | 'shotOrder'>) =>
  `${String(s.sceneOrder).padStart(3, '0')}-${String(s.shotOrder).padStart(3, '0')}`;

/** A short-lived signed URL for a private workspace object, via the mastering download route. */
export function usePlayUrl(key: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    setUrl(null);
    void (async () => {
      try {
        const res = await adminFetch(`/api/admin/mastering/download?key=${encodeURIComponent(key)}&mode=play`);
        const body = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && body.success && body.url) setUrl(body.url as string);
      } catch {
        // A preview is a convenience; a failed presign leaves the box empty.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);
  return url;
}

const EMPTY_BOX =
  'flex items-center justify-center rounded border border-dashed border-gray-300 text-xs text-gray-600 dark:border-gray-600 dark:text-gray-400';

/**
 * Preview box sizes. `aspect` gives a large preview in the story's own shape
 * (a 9:16 picture is not cropped to a square); `fill` fills its parent. With
 * neither, the small square the reference photos and first frame use.
 */
export function previewBox(aspect?: AspectRatio, fill = false, small = false): string {
  if (fill) return 'h-full w-full';
  if (small && aspect === '9:16') return 'h-24 w-14';
  if (small && aspect === '16:9') return 'h-14 w-24';
  if (aspect === '9:16') return 'aspect-[9/16] w-28 sm:w-32';
  if (aspect === '16:9') return 'aspect-video w-48 sm:w-56';
  return 'h-16 w-16';
}

export function Thumb({
  s3Key, alt, aspect, fill, small,
}: { s3Key: string; alt: string; aspect?: AspectRatio; fill?: boolean; small?: boolean }) {
  const url = usePlayUrl(s3Key);
  const box = previewBox(aspect, fill, small);
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={alt} loading="lazy" className={`${box} rounded object-cover`} />
  ) : (
    <span className={`${box} ${EMPTY_BOX}`}>…</span>
  );
}

/** A video clip preview: muted, inline, only its metadata loaded until played. */
export function VideoThumb({ s3Key, label, aspect }: { s3Key: string; label: string; aspect?: AspectRatio }) {
  const url = usePlayUrl(s3Key);
  const box = aspect ? previewBox(aspect) : 'h-24 w-40';
  return url ? (
    <video src={url} aria-label={label} controls muted playsInline preload="metadata" className={`${box} rounded bg-black object-contain`} />
  ) : (
    <span className={`${box} ${EMPTY_BOX}`}>…</span>
  );
}
