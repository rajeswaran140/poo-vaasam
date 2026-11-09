/**
 * The freeze: from a frame to the end of the video the picture holds still,
 * the sound plays on. Pure: shared by the editor, the API and the worker.
 *
 * - The held frame is the one SHOWING at a time: a browser shows the frame
 *   whose start is at or before the playhead, so the frame index is floored,
 *   not rounded (a clip that loops at 15.00 s shows its first frame again at
 *   15.00 s — the last good frame starts at 14.96 s at 25 fps).
 * - `atSec` is that frame's start, rounded to 1 ms.
 */
import type { Freeze } from '@/types/videoText';

const fpsOr = (fps: number) => (Number.isFinite(fps) && fps > 0 ? fps : 25);
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** The index of the frame showing at `sec`. */
export function frameAt(sec: number, fps: number): number {
  return Math.max(0, Math.floor(Math.max(0, sec) * fpsOr(fps) + 1e-3));
}

/** The start of frame `index`, in seconds (1 ms). */
export const frameStart = (index: number, fps: number) => r3(Math.max(0, index) / fpsOr(fps));

/**
 * Where to seek so the browser shows frame `index`: its middle, so float
 * rounding can never land on the frame before.
 */
export const seekTimeFor = (index: number, fps: number) => (Math.max(0, index) + 0.5) / fpsOr(fps);

/** The last frame of a video of this length. */
export const lastFrame = (durationSec: number, fps: number) => Math.max(0, Math.ceil(durationSec * fpsOr(fps) - 1e-3) - 1);

/** A freeze on the frame showing at `sec` (kept on the video). */
export function freezeAt(sec: number, durationSec: number, fps: number): Freeze {
  return { atSec: frameStart(Math.min(frameAt(sec, fps), lastFrame(durationSec, fps)), fps) };
}

/** Why this freeze cannot be exported, or null. `durationSec` is the stored video length. */
export function validateFreeze(freeze: Freeze | null | undefined, durationSec: number): string | null {
  if (!freeze) return null;
  const { atSec } = freeze;
  if (!Number.isFinite(atSec) || atSec < 0 || atSec >= durationSec) return 'The freeze is outside the video — set it again.';
  return null;
}

/** A freeze fitted to a new video (a re-upload): kept on its frames when it still fits, else dropped. */
export function fitFreezeToDuration(freeze: Freeze | null | undefined, durationSec: number, fps: number): Freeze | null {
  if (!freeze || !Number.isFinite(freeze.atSec) || freeze.atSec >= durationSec) return null;
  return freezeAt(freeze.atSec + 0.5 / fpsOr(fps), durationSec, fps);
}

/**
 * ffmpeg args that write the held frame as a PNG: an accurate input seek to
 * half a frame before it drops every earlier frame, so the first frame out is
 * exactly frame `atSec`.
 */
export function buildFreezeFrameArgs(srcPath: string, outPath: string, atSec: number, fps: number): string[] {
  const from = Math.max(0, atSec - 0.5 / fpsOr(fps));
  return ['-hide_banner', '-nostats', '-ss', from.toFixed(6), '-i', srcPath, '-frames:v', '1', '-an', '-y', outPath];
}
