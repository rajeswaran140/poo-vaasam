/**
 * Runs the archive decided by `master-archive.ts` (which stays pure).
 *
 * Split deliberately: the naming and eligibility rules are unit-tested against
 * fixtures, while this thin layer is the only part that touches S3 and
 * DynamoDB. Everything here is best-effort — it is called AFTER a save has
 * already succeeded, so it must never throw into the request.
 */

import { S3Operations } from '@/infrastructure/storage/s3-client';
import { MasterJobRepository } from '@/infrastructure/database/MasterJobRepository';
import type { MasterJob } from '@/types/masterJob';
import {
  MASTERS_BUCKET,
  MASTERS_STORAGE_CLASS,
  planArchive,
  archiveRefusalMessage,
} from '@/lib/master-archive';

export interface ArchiveOutcome {
  archived: boolean;
  /** Part A's archive key — kept for callers that expect a single key. */
  key?: string;
  /** Every key written. Two for a joined master, one otherwise. */
  keys?: string[];
  /** Present when the source was not archived — a refusal or a failure. */
  message?: string;
}

/**
 * Copy a saved master's source WAV into the lossless masters bucket.
 *
 * Returns rather than throws. A refusal (no title, already archived) is a
 * normal outcome and is NOT persisted — only a real failure is, because a
 * refusal is re-evaluated on the next save anyway and writing it would make
 * "we tried and it broke" indistinguishable from "there was nothing to do".
 */
export async function archiveSavedMaster(jobId: string, job: MasterJob): Promise<ArchiveOutcome> {
  const plan = planArchive(job);
  if (!plan.ok) {
    return { archived: false, message: archiveRefusalMessage(plan.reason) };
  }

  try {
    // EVERY source, not just Part A. A joined master has two, and archiving one
    // of them silently protected half the song.
    for (const copy of plan.copies) {
      await S3Operations.copyObject({
        sourceKey: copy.sourceKey,
        destKey: copy.archiveKey,
        destBucket: MASTERS_BUCKET,
        storageClass: MASTERS_STORAGE_CLASS,
      });
    }
    const archivedAt = new Date().toISOString();
    await new MasterJobRepository().recordArchive(jobId, { archiveKey: plan.archiveKey, archivedAt });
    return { archived: true, key: plan.archiveKey, keys: plan.copies.map((c) => c.archiveKey) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[master-archive] failed:', message);
    // Record the failure so it is visible rather than silent. If even this
    // write fails there is nothing further to do — the save itself stands.
    await new MasterJobRepository()
      .recordArchive(jobId, { archiveError: message })
      .catch(() => {});
    return { archived: false, message: `Source archive failed: ${message}` };
  }
}
