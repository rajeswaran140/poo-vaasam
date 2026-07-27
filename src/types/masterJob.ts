/**
 * Async mastering job — the durable handoff between the enqueue route
 * (`/api/admin/music-lab/master`) and the `master-worker` Lambda. The status
 * route polls it by id until `done` (masterKey populated) or `error`. Mirrors
 * criticJob.ts; uses the repo's DynamoDB-job idiom (NOT SQS).
 */

import type { SourceInfo } from '@/lib/loudness-measure';

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
  /**
   * Loudness range (EBU R128) before and after, in LU. The PROOF behind
   * "loudness only, never tone": a static gain change moves every sample
   * equally, so LRA must come out unchanged. If these differ by more than
   * rounding, something compressed the file.
   *
   * NOT the same as crest factor / "DR" — LRA is macro-dynamics across the
   * whole piece, crest is peak-to-RMS. LRA is the one that exposes compression.
   */
  beforeLra: number | null;
  afterLra: number | null;
  /**
   * What loudnorm actually did (see parseNormalizationType). `linear` = one
   * static gain, dynamics untouched. `dynamic` = ffmpeg refused linear because
   * it would have clipped, and compressed instead — the tone-preservation
   * claim does NOT hold for that master. Null for jobs predating this field.
   */
  normalizationType: 'linear' | 'dynamic' | null;
  /**
   * What the source file actually was (sample rate / channels / bit depth /
   * duration), read off the header ffmpeg prints during the worker's pass 1 —
   * no extra decode. Null for jobs written before the worker recorded it, so
   * every consumer must treat it as optional.
   */
  source: SourceInfo | null;
  /**
   * Set when the admin saves this master to the library. Saving is what makes
   * it durable: unsaved jobs carry a 24h ttl and self-expire, so one-off
   * experiments clean themselves up while anything worth keeping survives.
   * The WAV in S3 was always permanent — what used to vanish was the record
   * explaining it (loudness, range, report, compare player).
   */
  savedAt: string | null;
  /** Admin's name for the master; also drives the download filename. */
  title: string | null;
  error: { code: string; message: string } | null;
}
