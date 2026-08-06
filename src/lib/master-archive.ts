/**
 * Archiving a saved master's SOURCE into the lossless masters bucket.
 *
 * WHY this exists at all: on 2026-08-01 the catalogue had 57 unique songs and
 * only 11 with a lossless master in `tamilagaval-audio-masters` — nothing new
 * had landed there since 8 June. The other ~46 exist solely as lossy YouTube
 * audio and as whatever remains inside SUNO, which is retiring V3-V5.5 with no
 * announced date. Meanwhile the mastering module ingests a lossless WAV every
 * single time it is used. The source worth keeping was already passing through
 * our hands and being thrown away.
 *
 * Pure and I/O-free: this decides WHERE a source belongs and WHETHER it may go
 * there; the caller does the S3 work. That keeps the naming rules unit-testable
 * against a fixture instead of a live bucket.
 *
 * Facts about the destination, verified 2026-08-01 — do not re-derive them:
 *  - `tamilagaval-audio-masters` and `tamil-web-media` are BOTH in us-east-1,
 *    so the copy is same-region and server-side: no egress, no bytes through
 *    the SSR Lambda, fast at 70 MB.
 *  - Every object already there is `GLACIER_IR`, set per-object rather than by
 *    a lifecycle rule (the bucket carries only an abort-incomplete-MPU rule).
 *    New copies match that class so the archive stays uniform and cheap.
 *  - Versioning is ENABLED, so re-archiving the same title creates a version
 *    instead of destroying the earlier upload. That is the safety net behind
 *    allowing a re-archive at all.
 */

import type { MasterJob } from '@/types/masterJob';
import { sanitizeMasterTitle } from '@/lib/mastering-storage';

/** Lossless archive. IAM-only, all public access blocked, versioned. */
export const MASTERS_BUCKET = process.env.AUDIO_MASTERS_BUCKET || 'tamilagaval-audio-masters';

/** The existing convention in that bucket: `audio/poem-music/<Tamil title>.wav`. */
export const MASTERS_PREFIX = 'audio/poem-music/';

/** Matches the 13 objects already there. Cheap, retrievable in milliseconds. */
export const MASTERS_STORAGE_CLASS = 'GLACIER_IR';

/** Why a job cannot be archived. Each is a normal outcome, not an error. */
export type ArchiveRefusal = 'not-done' | 'not-saved' | 'no-title' | 'no-source' | 'already-archived';

/** One source file to copy, and where it lands. */
export interface ArchiveCopy {
  sourceKey: string;
  archiveKey: string;
}

export type ArchivePlan =
  | { ok: true; sourceKey: string; archiveKey: string; copies: ArchiveCopy[] }
  | { ok: false; reason: ArchiveRefusal };

/**
 * Archive key from the admin's title.
 *
 * The masters bucket is HUMAN-NAMED (`அக்கம் பக்கம்.wav`) while the mastering
 * workspace is machine-named (`1780067292588_ab3f_take.wav`). Archiving under
 * the workspace name would rebuild, inside the archive, exactly the orphan
 * problem the save feature was created to solve — a folder of files nobody can
 * identify. So an untitled master is refused rather than archived badly.
 *
 * `sanitizeMasterTitle` already strips control characters, quotes and path
 * separators, so a title cannot escape the prefix. Tamil survives it.
 */
export function archiveKeyForTitle(title: string | null | undefined, part?: 'A' | 'B'): string | null {
  const clean = sanitizeMasterTitle(title ?? '')
    .replace(/\.wave?$/i, '')
    .trim();
  if (!clean) return null;
  // A two-part song produces TWO sources for one title, so they are named for
  // the part. A single-source master keeps the bare song name it always had.
  const suffix = part ? ` (Part ${part})` : '';
  return `${MASTERS_PREFIX}${clean}${suffix}.wav`;
}

/**
 * Decide whether this job's source should be archived, and where.
 *
 * Archives the SOURCE (`job.s3Key`), not the mastered output. The masters
 * bucket holds original SUNO renders — that is what cannot be regenerated once
 * SUNO retires a model. A master can always be produced again from the source;
 * the reverse is not true.
 *
 * ⚠️ A TWO-PART MASTER HAS TWO SOURCES. Until 2026-08-06 this archived only
 * `job.s3Key` — Part A — and said nothing, so saving an assembled song
 * protected half of it. Found by reading what a real session actually wrote to
 * S3: three archived files for வானவில்லே were all byte-identical Part A copies
 * under three different titles. `copies` now carries every source, and the
 * caller must copy them all.
 */
export function planArchive(job: MasterJob): ArchivePlan {
  if (job.status !== 'done') return { ok: false, reason: 'not-done' };
  // Saving is the operator's "this one is worth keeping" signal. Archiving on
  // completion instead would fill a Glacier bucket with throwaway experiments.
  if (!job.savedAt) return { ok: false, reason: 'not-saved' };
  if (job.archivedAt) return { ok: false, reason: 'already-archived' };
  if (!job.s3Key) return { ok: false, reason: 'no-source' };

  const partBKey = job.join?.partBKey ?? null;
  // Named for the part only when there IS a second part; a single-source
  // master keeps the bare song name, so existing archives stay addressable.
  const archiveKey = archiveKeyForTitle(job.title, partBKey ? 'A' : undefined);
  if (!archiveKey) return { ok: false, reason: 'no-title' };

  const copies: ArchiveCopy[] = [{ sourceKey: job.s3Key, archiveKey }];
  if (partBKey) {
    const bKey = archiveKeyForTitle(job.title, 'B');
    if (bKey) copies.push({ sourceKey: partBKey, archiveKey: bKey });
  }
  // `sourceKey`/`archiveKey` stay on the plan for Part A so existing callers
  // and the job's own archiveKey field keep working unchanged.
  return { ok: true, sourceKey: job.s3Key, archiveKey, copies };
}

/** Operator-facing wording for a refusal. Only `no-title` is actionable. */
export function archiveRefusalMessage(reason: ArchiveRefusal): string {
  switch (reason) {
    case 'no-title':
      return 'Name this master to archive its source — the masters bucket is named by song, not by job id.';
    case 'already-archived':
      return 'Source already archived.';
    case 'not-saved':
      return 'Save this master to archive its source.';
    case 'not-done':
      return 'Only a finished master can be archived.';
    case 'no-source':
      return 'This job has no source key to archive.';
  }
}
