/**
 * Runs the publish decided by `master-publish.ts` (which stays pure).
 *
 * Split for the same reason as the archive service: the naming and eligibility
 * rules are unit-tested against fixtures, while this thin layer is the only
 * part that touches S3 and DynamoDB.
 *
 * UNLIKE the archive, this is NOT best-effort. Archiving runs after a save has
 * already succeeded, so it must never throw into that request; publishing IS
 * the request, and an operator who presses "Publish" needs to know whether the
 * file is on the site. Failures are returned, not swallowed.
 */

import { S3Operations } from '@/infrastructure/storage/s3-client';
import { MasterJobRepository } from '@/infrastructure/database/MasterJobRepository';
import type { MasterJob } from '@/types/masterJob';
import {
  planPublish,
  publishRefusalMessage,
  SITE_AUDIO_CONTENT_TYPE,
} from '@/lib/master-publish';

export interface PublishOutcome {
  published: boolean;
  key?: string;
  /** True when an existing object at that key was replaced. */
  replaced?: boolean;
  /**
   * Set when the destination is already occupied and `overwrite` was not given.
   * The caller turns this into a confirm prompt rather than a failure — the
   * admin is the only one who knows whether the file there is the same song.
   */
  conflict?: boolean;
  message?: string;
}

/**
 * Copy a saved master's web MP3 to the site's audio prefix.
 *
 * OVERWRITE IS EXPLICIT. `audio/poem-music/<title>.mp3` is a canonical,
 * CDN-served path: silently replacing one would change what listeners hear on
 * a live song with no record of the swap. The bucket is versioned, so a
 * confirmed overwrite is recoverable — but it still has to be asked for.
 */
export async function publishWebMp3(
  jobId: string,
  job: MasterJob,
  opts: { overwrite?: boolean } = {}
): Promise<PublishOutcome> {
  const plan = planPublish(job);
  if (!plan.ok) {
    return { published: false, message: publishRefusalMessage(plan.reason) };
  }

  try {
    const exists = await S3Operations.fileExists(plan.publishKey);
    if (exists && !opts.overwrite) {
      return {
        published: false,
        conflict: true,
        key: plan.publishKey,
        message: `A file already exists at ${plan.publishKey}. Publishing again will replace what the site serves for that song.`,
      };
    }

    // Same bucket, so both default. ContentType is set explicitly: the copy
    // would otherwise inherit whatever the workspace object carries, and an
    // `audio/wav` header on an MP3 makes some mobile players refuse it — the
    // exact audience (weak links, mostly mobile) this file exists for.
    await S3Operations.copyObject({
      sourceKey: plan.mp3Key,
      destKey: plan.publishKey,
      contentType: SITE_AUDIO_CONTENT_TYPE,
    });

    const publishedAt = new Date().toISOString();
    await new MasterJobRepository().recordPublish(jobId, { publishKey: plan.publishKey, publishedAt });
    return { published: true, key: plan.publishKey, replaced: exists };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[master-publish] failed:', message);
    // Record the failure so it is visible on the job rather than living only in
    // a log line the operator will never read.
    await new MasterJobRepository().recordPublish(jobId, { publishError: message }).catch(() => {});
    return { published: false, message: `Publish failed: ${message}` };
  }
}
