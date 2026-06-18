/**
 * Turn a detected {@link HookWindow} into actionable publishing guidance.
 *
 * The channel's #1 growth lever is the first ~15 seconds of a video (retention
 * analysis: songs shed ~half their viewers by ~35s; the template முத்தமிழின்
 * holds because it opens on the hook). This module productises that insight:
 * given where the hook (chorus) starts, it produces a human Studio-Trim
 * instruction and a "first-15s" verdict, so every publish can open on the hook
 * instead of a long instrumental intro.
 *
 * Pure + unit-tested. The ffmpeg measurement + window pick live in
 * hook-window.ts; the render lives in scripts/generate-song-short.ts.
 */

import type { HookWindow } from '@/lib/hook-window';

/** The first ~15 seconds is where retention is won or lost (the lever). */
export const FIRST_15S = 15;
/** Hooks starting this early need no trim. */
const ALREADY_HOOKING_SEC = 2;

export interface HookRecommendation {
  /** Where the hook (chorus) begins, seconds. */
  hookStartSec: number;
  /** mm:ss label for the hook start. */
  hookStartLabel: string;
  /** Length of the instrumental/intro before the hook, seconds. */
  introSec: number;
  /** mm:ss–mm:ss label for the detected hook window. */
  windowLabel: string;
  /** True when the hook starts within the first 15s (no urgent fix). */
  hooksWithinFirst15s: boolean;
  /** One-line, paste-ready instruction for YouTube Studio. */
  trimInstruction: string;
  /** Short verdict for the admin UI badge. */
  verdict: 'hook-at-start' | 'trim-recommended' | 'trim-strongly-recommended';
}

/** Format seconds as m:ss (e.g. 72 → "1:12"); negatives clamp to 0:00. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, '0')}`;
}

/**
 * Build the publishing recommendation from a detected hook window. The intro is
 * everything before the hook; the deeper the hook sits, the more urgent the trim.
 */
export function buildHookRecommendation(hook: HookWindow): HookRecommendation {
  const hookStartSec = Math.max(0, hook.start);
  const introSec = hookStartSec;
  const hookStartLabel = formatClock(hookStartSec);
  const windowLabel = `${formatClock(hook.start)}–${formatClock(hook.end)}`;
  const hooksWithinFirst15s = hookStartSec <= FIRST_15S;

  let verdict: HookRecommendation['verdict'];
  let trimInstruction: string;

  if (hookStartSec <= ALREADY_HOOKING_SEC) {
    verdict = 'hook-at-start';
    trimInstruction = `The hook is already at the start (${hookStartLabel}) — no trim needed.`;
  } else {
    verdict = hooksWithinFirst15s ? 'trim-recommended' : 'trim-strongly-recommended';
    const urgency = hooksWithinFirst15s
      ? `Trimming the ${Math.round(introSec)}s intro opens straight on the chorus.`
      : `The ${Math.round(introSec)}s intro is past the critical first ${FIRST_15S}s — this is the highest-leverage fix.`;
    trimInstruction =
      `Open on the hook: in YouTube Studio → Editor → Trim, cut 0:00–${hookStartLabel} so the video starts at the chorus (${hookStartLabel}). ${urgency}`;
  }

  return {
    hookStartSec,
    hookStartLabel,
    introSec,
    windowLabel,
    hooksWithinFirst15s,
    trimInstruction,
    verdict,
  };
}
