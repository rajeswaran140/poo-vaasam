/**
 * "Did I address the feedback?" — a pure, deterministic diff between a prior
 * critique and the current draft text. No AI: a flagged slack line counts as
 * *addressed* once its verbatim text no longer appears in the draft. Lets the
 * Critic close the loop ("you've reworked 3 of 5 lines I flagged; 2 remain")
 * instead of leaving each critique as a dead-end comment.
 *
 * Comparison is whitespace-normalised (trim + collapse runs) so trivial spacing
 * edits don't read as "addressed", but any real change to a line does.
 */

import type { LyricCritique } from '@/services/ai/lyricCriticSchema';

export interface FeedbackProgress {
  /** Slack lines flagged by the prior critique. */
  total: number;
  /** How many of those no longer appear verbatim in the current draft. */
  addressed: number;
  /** The flagged lines still present (untouched), with their original reason. */
  remaining: { line: string; issue: string }[];
}

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Compare the slack lines from `prev` against `currentLyrics`. Returns null when
 * there's nothing to track (no prior critique, or it flagged no slack lines).
 */
export function feedbackProgress(
  prev: LyricCritique | null | undefined,
  currentLyrics: string
): FeedbackProgress | null {
  if (!prev || prev.slackLines.length === 0) return null;
  const present = new Set(
    (currentLyrics ?? '').split('\n').map(norm).filter(Boolean)
  );
  const remaining = prev.slackLines.filter((sl) => present.has(norm(sl.line)));
  return {
    total: prev.slackLines.length,
    addressed: prev.slackLines.length - remaining.length,
    remaining: remaining.map((sl) => ({ line: sl.line, issue: sl.issue })),
  };
}
