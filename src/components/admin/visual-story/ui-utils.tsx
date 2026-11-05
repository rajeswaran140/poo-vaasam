'use client';

/** Small helpers shared by the studio's components: money, shot keys, signed previews. */

import { useEffect, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import type { Shot } from '@/types/visualStory';

export const usd = (n: number) => `$${n.toFixed(2)}`;

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

export function Thumb({ s3Key, alt }: { s3Key: string; alt: string }) {
  const url = usePlayUrl(s3Key);
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={alt} className="h-16 w-16 rounded object-cover" />
  ) : (
    <span className={`h-16 w-16 ${EMPTY_BOX}`}>…</span>
  );
}

/** A video clip preview: muted, inline, only its metadata loaded until played. */
export function VideoThumb({ s3Key, label }: { s3Key: string; label: string }) {
  const url = usePlayUrl(s3Key);
  return url ? (
    <video src={url} aria-label={label} controls muted playsInline preload="metadata" className="h-24 w-40 rounded bg-black object-contain" />
  ) : (
    <span className={`h-24 w-40 ${EMPTY_BOX}`}>…</span>
  );
}
