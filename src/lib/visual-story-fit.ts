/**
 * Fit shot lengths to a window: scale every shot by window/total, keeping
 * 1-15 s each and the shots' order of length, then spread the rounding error a
 * second at a time from the end. Client-safe; shared by the storyboard drafter
 * (a draft paced for the whole song) and the pictures panel ("Fit to the song").
 * Returns null when the shots cannot fill the window (too many or too few).
 */

export const MIN_FIT_SEC = 1;
export const MAX_FIT_SEC = 15;

export function fitDurations(durations: number[], windowSec: number): number[] | null {
  const total = durations.reduce((a, b) => a + b, 0);
  if (total <= 0 || durations.length > windowSec || durations.length * MAX_FIT_SEC < windowSec) return null;
  const clamp = (n: number) => Math.min(MAX_FIT_SEC, Math.max(MIN_FIT_SEC, n));
  const next = durations.map((d) => clamp(Math.round((d * windowSec) / total)));
  let diff = windowSec - next.reduce((a, b) => a + b, 0);
  const step = Math.sign(diff);
  while (diff !== 0) {
    let moved = false;
    for (let i = next.length - 1; i >= 0 && diff !== 0; i--) {
      if (clamp(next[i] + step) === next[i]) continue;
      next[i] += step;
      diff -= step;
      moved = true;
    }
    if (!moved) return null;
  }
  return next;
}
