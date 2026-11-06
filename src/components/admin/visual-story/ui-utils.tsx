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

/**
 * Signed preview URLs, shared by every preview of the same file on the page.
 * A long story shows each picture twice (its card and the song timeline) and
 * may hold sixty; one presign per file, not per preview. The download route
 * signs play URLs for an hour, so a cached one is reused for 50 minutes; an
 * image that still fails (expired, or the page left open) asks for a fresh one
 * once — see usePlayUrlWithRetry.
 */
const PLAY_URL_REUSE_MS = 50 * 60_000;
const playUrls = new Map<string, { at: number; url: Promise<string | null> }>();

/** Test hook: the cache is module state and would otherwise leak across tests. */
export function __resetPlayUrlCacheForTests(): void {
  playUrls.clear();
}

function fetchPlayUrl(key: string, fresh = false): Promise<string | null> {
  const hit = playUrls.get(key);
  if (!fresh && hit && Date.now() - hit.at < PLAY_URL_REUSE_MS) return hit.url;
  const url = (async () => {
    try {
      const res = await adminFetch(`/api/admin/mastering/download?key=${encodeURIComponent(key)}&mode=play`);
      const body = await res.json().catch(() => ({}));
      return res.ok && body.success && body.url ? (body.url as string) : null;
    } catch {
      // A preview is a convenience; a failed presign leaves the box empty.
      return null;
    }
  })();
  playUrls.set(key, { at: Date.now(), url });
  // A failure is not cached: the next preview of this file tries again.
  void url.then((u) => {
    if (!u && playUrls.get(key)?.url === url) playUrls.delete(key);
  });
  return url;
}

/** A signed URL for a private workspace object, and a way to replace a dead one (once). */
export function usePlayUrlWithRetry(key: string | null): [string | null, () => void] {
  const [url, setUrl] = useState<string | null>(null);
  // The key a fresh URL was asked for: at most once per file, and a new file
  // starts over without a reset step.
  const [retriedKey, setRetriedKey] = useState<string | null>(null);
  const fresh = key !== null && retriedKey === key;
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    setUrl(null);
    void fetchPlayUrl(key, fresh).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [key, fresh]);
  return [url, () => setRetriedKey(key)];
}

/** A short-lived signed URL for a private workspace object, via the mastering download route. */
export function usePlayUrl(key: string | null): string | null {
  return usePlayUrlWithRetry(key)[0];
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
  const [url, retry] = usePlayUrlWithRetry(s3Key);
  const box = previewBox(aspect, fill, small);
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={alt} loading="lazy" onError={retry} className={`${box} rounded object-cover`} />
  ) : (
    <span className={`${box} ${EMPTY_BOX}`}>…</span>
  );
}

/** A video clip preview: muted, inline, only its metadata loaded until played. */
export function VideoThumb({ s3Key, label, aspect }: { s3Key: string; label: string; aspect?: AspectRatio }) {
  const [url, retry] = usePlayUrlWithRetry(s3Key);
  const box = aspect ? previewBox(aspect) : 'h-24 w-40';
  return url ? (
    <video src={url} aria-label={label} controls muted playsInline preload="metadata" onError={retry} className={`${box} rounded bg-black object-contain`} />
  ) : (
    <span className={`${box} ${EMPTY_BOX}`}>…</span>
  );
}
