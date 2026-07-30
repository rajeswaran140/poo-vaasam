/**
 * Timestamped marks made while auditioning a take — pure, no DOM.
 *
 * WHY THIS EXISTS. Raj's judgement about a take is currently formed while
 * listening and then written down separately, if at all: Music Lab defines a
 * whole failure vocabulary (melody, rhythm, lyrics, pronunciation, arrangement,
 * emotion, mixing, vocal_delivery) and has **zero** logged generations. The gap
 * is not the schema, it is that the moment of judgement — "the ழ at 1:42 is
 * wrong" — happens with both hands on a player and no way to record it.
 *
 * A mark is that thought, captured where it occurs: a time, a reason from the
 * SAME vocabulary the Music Lab uses, and a free note. Deliberately reusing
 * FAILURE_REASONS rather than inventing labels, so marks made here can later be
 * rolled up into a Generation record without a translation step.
 *
 * Marks are session-local by design for now. Persisting them means a schema and
 * a route, and the useful thing first is capture — a list you can read back and
 * copy into the Music Lab in one paste.
 */

import { FAILURE_REASONS } from '@/types/generation';

export type MarkReason = (typeof FAILURE_REASONS)[number];

export interface AuditionMark {
  id: string;
  /** Seconds into the take. */
  time: number;
  reason: MarkReason;
  note: string;
}

/** "1:42" — the form a note about a take is actually written in. */
export function formatMarkTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Add a mark, keeping the list in time order.
 *
 * Sorted on insert rather than on render because the list IS the output — it
 * gets copied into the Music Lab, and notes arriving out of order would have to
 * be re-read against the song rather than followed straight through.
 */
export function addMark(marks: AuditionMark[], mark: AuditionMark): AuditionMark[] {
  return [...marks, mark].sort((a, b) => a.time - b.time);
}

export function removeMark(marks: AuditionMark[], id: string): AuditionMark[] {
  return marks.filter((m) => m.id !== id);
}

export function updateMark(
  marks: AuditionMark[],
  id: string,
  patch: Partial<Omit<AuditionMark, 'id'>>
): AuditionMark[] {
  return marks
    .map((m) => (m.id === id ? { ...m, ...patch } : m))
    .sort((a, b) => a.time - b.time);
}

/**
 * Render the marks as plain text to paste into a Music Lab note.
 *
 * Plain text, not JSON: the destination is a free-text `notes` field a human
 * reads, and the whole point is that the transcription step disappears.
 */
export function marksToText(marks: AuditionMark[], title?: string): string {
  if (!marks.length) return '';
  const head = title ? `${title}\n` : '';
  // Sort here too, not just on insert. This function's whole purpose is
  // readable output, and silently emitting out-of-order lines because a caller
  // built the array another way would defeat it.
  return (
    head +
    [...marks]
      .sort((a, b) => a.time - b.time)
      .map((m) => `${formatMarkTime(m.time)} — ${m.reason}${m.note ? `: ${m.note}` : ''}`)
      .join('\n')
  );
}

/**
 * Which reasons came up, most-marked first.
 *
 * This is the actual verdict-shaped output: five pronunciation marks and one
 * mixing mark is a take with a pronunciation problem, and that is exactly the
 * `failureReason` a Generation record wants.
 */
export function dominantReasons(marks: AuditionMark[]): Array<{ reason: MarkReason; count: number }> {
  const counts = new Map<MarkReason, number>();
  for (const m of marks) counts.set(m.reason, (counts.get(m.reason) ?? 0) + 1);
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

/** Human label for a reason — the enum values are snake_case. */
export function reasonLabel(reason: MarkReason): string {
  return reason === 'vocal_delivery' ? 'vocal delivery' : reason;
}
