'use client';

import { useEffect, useState } from 'react';

/**
 * Whole seconds since `active` last turned true; 0 while it is false.
 *
 * A long render with a bare spinner reads as stuck. This is what lets a busy
 * button say "Rendering… 3:12" instead.
 */
export function useElapsed(active: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }
    const started = Date.now();
    setSeconds(0);
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [active]);
  return seconds;
}

/** m:ss, for a busy button's timer. */
export const elapsedClock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
