/**
 * Async mastering job — the durable handoff between the enqueue route
 * (`/api/admin/music-lab/master`) and the `master-worker` Lambda. The status
 * route polls it by id until `done` (masterKey populated) or `error`. Mirrors
 * criticJob.ts; uses the repo's DynamoDB-job idiom (NOT SQS).
 */

export type MasterJobStatus = 'processing' | 'done' | 'error';

export interface MasterJob {
  id: string;
  status: MasterJobStatus;
  createdAt: string;
  updatedAt: string;
  /** The take being mastered. */
  s3Key: string;
  target: number;
  /** S3 key of the mastered WAV, once done. */
  masterKey: string | null;
  /** Integrated loudness / true peak of the input, once measured by the worker. */
  beforeLufs: number | null;
  beforeTp: number | null;
  /**
   * Integrated loudness / true peak the output actually landed on (worker pass
   * 3). `afterLufs` should equal `target` within ~0.1 LU — it is the job's own
   * evidence the master hit the mark, so verifying needs no download.
   */
  afterLufs: number | null;
  afterTp: number | null;
  error: { code: string; message: string } | null;
}
