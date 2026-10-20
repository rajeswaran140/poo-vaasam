/**
 * Repair marks — the persisted form of the player's audition marks.
 *
 * A mark belongs to ONE saved master (a version): its times are seconds into
 * that master, which a re-master with a different trim or a remix would move.
 * See docs/superpowers/specs/2026-10-20-repair-marks-and-lineage-design.md.
 *
 * Pure: validation, ordering and text. Persistence is MarkRepository.
 */
import { FAILURE_REASONS } from '@/types/generation';
import { formatMarkTime, reasonLabel, type MarkReason } from '@/lib/audition-marks';

export const MARK_STATUSES = ['open', 'fixed', 'wont-fix'] as const;
export type MarkStatus = (typeof MARK_STATUSES)[number];
export const MAX_MARKS_PER_MASTER = 500;
export const MAX_NOTE_CHARS = 500;
/** The player's duration and the probe's round differently; a mark at the very end must not be refused. */
const END_SLACK_SEC = 0.5;

export interface RepairMark {
  markId: string;
  masterJobId: string;
  start: number;
  end: number | null;
  reason: MarkReason;
  note: string;
  status: MarkStatus;
  fixedIn: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface NewMarkInput {
  start: number;
  end: number | null;
  reason: MarkReason;
  note: string;
}

export type MarkPatch = Partial<{
  start: number;
  end: number | null;
  reason: MarkReason;
  note: string;
  status: MarkStatus;
  fixedIn: string | null;
}>;

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });

const isReason = (r: unknown): r is MarkReason =>
  typeof r === 'string' && (FAILURE_REASONS as readonly string[]).includes(r);
const isStatus = (s: unknown): s is MarkStatus =>
  typeof s === 'string' && (MARK_STATUSES as readonly string[]).includes(s);
const isId = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(s);

function checkSpan(start: unknown, end: unknown, durationSec: number | null): string | null {
  if (typeof start !== 'number' || !Number.isFinite(start) || start < 0) return 'start must be a time in seconds';
  if (end !== null && (typeof end !== 'number' || !Number.isFinite(end) || end <= start)) {
    return 'end must be after start';
  }
  if (durationSec !== null) {
    const limit = durationSec + END_SLACK_SEC;
    if (start > limit || (end !== null && (end as number) > limit)) return 'that time is past the end of this master';
  }
  return null;
}

function checkNote(note: unknown): string | null {
  if (typeof note !== 'string') return 'note must be text';
  if (note.length > MAX_NOTE_CHARS) return `note is limited to ${MAX_NOTE_CHARS} characters`;
  return null;
}

export function parseNewMark(
  body: unknown,
  durationSec: number | null
): { ok: true; value: NewMarkInput } | Fail {
  if (!body || typeof body !== 'object') return fail('a mark is required');
  const b = body as Record<string, unknown>;
  const end = b.end === undefined ? null : b.end;
  const spanError = checkSpan(b.start, end, durationSec);
  if (spanError) return fail(spanError);
  if (!isReason(b.reason)) return fail('unknown reason');
  const note = b.note === undefined ? '' : b.note;
  const noteError = checkNote(note);
  if (noteError) return fail(noteError);
  return { ok: true, value: { start: b.start as number, end: end as number | null, reason: b.reason, note: note as string } };
}

export function parseMarkPatch(
  body: unknown,
  current: RepairMark,
  durationSec: number | null
): { ok: true; version: number; patch: MarkPatch } | Fail {
  if (!body || typeof body !== 'object') return fail('a change is required');
  const b = body as Record<string, unknown>;
  if (typeof b.version !== 'number' || !Number.isInteger(b.version)) return fail('version is required');
  const patch: MarkPatch = {};
  if (b.start !== undefined) patch.start = b.start as number;
  if (b.end !== undefined) patch.end = b.end as number | null;
  if (b.reason !== undefined) {
    if (!isReason(b.reason)) return fail('unknown reason');
    patch.reason = b.reason;
  }
  if (b.note !== undefined) {
    const noteError = checkNote(b.note);
    if (noteError) return fail(noteError);
    patch.note = b.note as string;
  }
  if (b.status !== undefined) {
    if (!isStatus(b.status)) return fail('unknown status');
    patch.status = b.status;
  }
  if (b.fixedIn !== undefined) {
    if (b.fixedIn !== null && !isId(b.fixedIn)) return fail('fixedIn must be a master id');
    patch.fixedIn = b.fixedIn as string | null;
  }
  if (Object.keys(patch).length === 0) return fail('nothing to change');
  const start = patch.start ?? current.start;
  const end = patch.end !== undefined ? patch.end : current.end;
  const spanError = checkSpan(start, end, durationSec);
  if (spanError) return fail(spanError);
  return { ok: true, version: b.version, patch };
}

export function sortMarks(marks: RepairMark[]): RepairMark[] {
  return [...marks].sort((a, b) => a.start - b.start || a.createdAt.localeCompare(b.createdAt));
}

/** A child version reads its parent's list to tick off fixes: open ones first. */
export function parentMarksView(marks: RepairMark[]): RepairMark[] {
  const sorted = sortMarks(marks);
  return [...sorted.filter((m) => m.status === 'open'), ...sorted.filter((m) => m.status !== 'open')];
}

export function markTimeLabel(m: Pick<RepairMark, 'start' | 'end'>): string {
  return m.end === null ? formatMarkTime(m.start) : `${formatMarkTime(m.start)}–${formatMarkTime(m.end)}`;
}

export function statusLabel(s: MarkStatus): string {
  return s === 'open' ? 'Open' : s === 'fixed' ? 'Fixed' : "Won't fix";
}

export function repairMarksToText(marks: RepairMark[], title?: string): string {
  if (!marks.length) return '';
  const head = title ? `${title}\n` : '';
  return (
    head +
    sortMarks(marks)
      .map((m) =>
        `${markTimeLabel(m)} — ${reasonLabel(m.reason)}` +
        (m.status !== 'open' ? ` [${statusLabel(m.status)}]` : '') +
        (m.note ? `: ${m.note}` : '')
      )
      .join('\n')
  );
}

/** What a mark's times are bounded by: the edited length if the master was trimmed, else the source's. */
export function masterDurationSec(job: {
  editedDurationSec?: number | null;
  source?: { durationSec?: number | null } | null;
}): number | null {
  if (typeof job.editedDurationSec === 'number') return job.editedDurationSec;
  if (typeof job.source?.durationSec === 'number') return job.source.durationSec;
  return null;
}
