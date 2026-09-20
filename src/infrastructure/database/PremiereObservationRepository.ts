/**
 * Storage for upload → premiere gap observations.
 *
 * Deliberately tiny and append-only. The measurement is worthless if it is
 * lost, and it can never be recreated: YouTube overwrites `publishedAt` when a
 * premiere airs, so an observation missed is a release that can never
 * contribute. That is why it lives in DynamoDB beside everything else rather
 * than in a file someone has to remember to commit.
 *
 * ⚠️ `record` REFUSES TO OVERWRITE. Re-running the preflight on the same video
 * must not replace a good observation — and once that video airs, a re-run
 * would be writing the premiere time as the upload time. First write wins.
 */
import { DynamoDBOperations } from './dynamodb-client';
import type { PremiereObservation } from '@/lib/premiere-observation';

/** Sparse GSI1 partition holding every observation. Namespaced; cannot collide. */
export const PREMIERE_OBS_INDEX_PK = 'PREMIEREOBS';

const pk = (videoId: string) => `PREMIEREOBS#${videoId}`;

function toObservation(i: Record<string, unknown>): PremiereObservation {
  return {
    videoId: String(i.videoId),
    title: String(i.title ?? ''),
    uploadedAt: String(i.uploadedAt),
    scheduledStartTime: String(i.scheduledStartTime),
    gapHours: Number(i.gapHours ?? 0),
    recordedAt: String(i.recordedAt),
  };
}

export class PremiereObservationRepository {
  /**
   * Store one observation. Returns false when the video already has one —
   * which is the common case on a re-run and is not an error.
   */
  async record(obs: PremiereObservation): Promise<boolean> {
    try {
      // Read-then-write rather than a ConditionExpression, because the shared
      // `put` helper does not take one. Safe here: observations are written by
      // one operator running a script, never concurrently. What this actually
      // guards is NOT a race — it is a re-run of the preflight after the video
      // has aired, which would otherwise overwrite a true upload time with the
      // premiere time and look entirely plausible.
      if (await this.get(obs.videoId)) return false;
      await DynamoDBOperations.put({
        PK: pk(obs.videoId),
        SK: 'METADATA',
        entityType: 'PREMIEREOBS',
        ...obs,
        GSI1PK: PREMIERE_OBS_INDEX_PK,
        GSI1SK: `${obs.scheduledStartTime}#${obs.videoId}`,
      });
      return true;
    } catch (err) {
      // Logged, never thrown. `handleDynamoDBError` returns `never` — it
      // rethrows — and this must NOT fail the preflight it rides on: the
      // checklist is the job, the observation is a passenger.
      console.error(
        '[premiere-observation] could not record:',
        err instanceof Error ? err.message : String(err)
      );
      return false;
    }
  }

  async get(videoId: string): Promise<PremiereObservation | null> {
    const item = await DynamoDBOperations.get({ PK: pk(videoId), SK: 'METADATA' });
    return item ? toObservation(item as Record<string, unknown>) : null;
  }

  /** Every observation, oldest premiere first. */
  async list(): Promise<PremiereObservation[]> {
    const res = await DynamoDBOperations.query({
      indexName: 'GSI1',
      keyConditionExpression: 'GSI1PK = :pk',
      expressionAttributeValues: { ':pk': PREMIERE_OBS_INDEX_PK },
      scanIndexForward: true,
    });
    return (res.Items ?? []).map((i) => toObservation(i as Record<string, unknown>));
  }
}
