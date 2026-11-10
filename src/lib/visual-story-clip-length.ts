/**
 * The admin's own clip sets its row's length: the clip's duration, read in
 * the browser, rounded to the whole second a shot is stored in. The render
 * cuts at exactly that many frames and holds the last frame when the clip is a
 * fraction short, so a 7.6 s clip plays 8 s and a 7.4 s clip plays 7 s.
 * Client-only (uses a <video> element); the rounding is pure and tested.
 */

import { MAX_OWN_CLIP_SEC, MIN_SHOT_SEC } from '@/types/visualStory';

export type ClipSeconds = { ok: true; seconds: number } | { ok: false; error: string };

/** A clip's duration → its row's whole seconds, or why it cannot be used. */
export function clipRowSeconds(durationSec: number): ClipSeconds {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return { ok: false, error: 'Could not read how long the clip is. Is it an MP4 video?' };
  }
  const seconds = Math.max(MIN_SHOT_SEC, Math.round(durationSec));
  if (seconds > MAX_OWN_CLIP_SEC) {
    return { ok: false, error: `The clip is ${seconds} s long; the most for one clip is ${MAX_OWN_CLIP_SEC} s.` };
  }
  return { ok: true, seconds };
}

/** How long a video file plays, from its metadata (no full download, nothing uploaded). */
export function readClipDuration(file: File, timeoutMs = 15_000): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let done = false;
    const finish = (d: number) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      resolve(d);
    };
    const timer = setTimeout(() => finish(NaN), timeoutMs);
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => finish(video.duration);
    video.onerror = () => finish(NaN);
    video.src = url;
  });
}
