/**
 * Async mastering job — the durable handoff between the enqueue route
 * (`/api/admin/music-lab/master`) and the `master-worker` Lambda. The status
 * route polls it by id until `done` (masterKey populated) or `error`. Mirrors
 * criticJob.ts; uses the repo's DynamoDB-job idiom (NOT SQS).
 */

import type { SourceInfo } from '@/lib/loudness-measure';
import type { MasterEdit } from '@/lib/master-edit';
import type { MasterJoin } from '@/lib/master-join';

export type MasterJobStatus = 'processing' | 'done' | 'error';

export interface MasterJob {
  id: string;
  status: MasterJobStatus;
  createdAt: string;
  updatedAt: string;
  /** The take being mastered. */
  s3Key: string;
  target: number;
  /**
   * Trim/fade applied by the worker's pre-pass, BEFORE the loudnorm passes —
   * so `beforeLufs` and `afterLufs` describe the edited programme, which is the
   * one that ships. Null for jobs written before editing existed and for any
   * job that asked for no edit; both mean "the full source, untouched".
   *
   * The source WAV in S3 is never modified. This is a recipe, not a result:
   * re-running with different points is a new job over the same file.
   */
  edit: MasterEdit | null;
  /**
   * Two-part assembly: Part B's key plus the crossfade that joined it to Part A
   * (this job's `s3Key`). Null for an ordinary single-source master.
   *
   * Like `edit`, this is a RECIPE rather than a result — the two source files in
   * S3 are never modified. It is stored so the report can state what was
   * assembled without re-deriving it from the audio, and because "why is this
   * master 6:20 when the take was 3:40" is otherwise unanswerable.
   */
  join: MasterJoin | null;
  /** Duration of the mastered output in seconds, once the worker knows it. */
  editedDurationSec: number | null;
  /**
   * The 192k web MP3 built FROM the mastered WAV — the artifact listeners
   * actually receive, and until now the only one nothing measured. Its true
   * peak is recorded because that is where the catalogue's real defect lives:
   * the 2026-07-24 sweep found 2 of 17 served MP3s above the -1 dBTP ceiling.
   * Null on jobs written before the export existed, and if the encode failed —
   * a missing MP3 never fails a master.
   */
  mp3Key: string | null;
  mp3Lufs: number | null;
  mp3Tp: number | null;
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
  /**
   * When this job's SOURCE was copied into the lossless masters bucket, and
   * where it landed. Set on save, best-effort: archiving must never fail a
   * save, so a failure records `archiveError` and leaves the other two null.
   * All three are null for jobs written before archiving existed, and for
   * masters saved without a title (the archive is named by song, not job id).
   */
  archivedAt: string | null;
  archiveKey: string | null;
  archiveError: string | null;
  /**
   * When this job's web MP3 was copied to the site's `audio/poem-music/` prefix,
   * and under what key. Set by an explicit Publish action, never automatically:
   * that path is CDN-served and canonical per song, so writing to it is a
   * deliberate act.
   *
   * ⚠️ `publishedAt` means THE FILE IS STAGED, not that the song is live —
   * `/songs` is build-time SSG and still needs a content record plus a rebuild.
   * All three are null for every job written before publishing existed.
   */
  publishedAt: string | null;
  publishKey: string | null;
  publishError: string | null;
  /**
   * The rendered YouTube video — cover art over the MASTERED audio, encoded
   * once. Null until a render is asked for, and on every job written before
   * rendering existed.
   *
   * `videoKey` names the MP4 in the mastering workspace; the admin downloads it
   * and uploads that file to YouTube. Nothing here publishes anything.
   */
  videoKey: string | null;
  videoRenderedAt: string | null;
  videoError: string | null;
  /** The cover the video was built from, kept so a re-render is reproducible. */
  coverKey: string | null;
  error: { code: string; message: string } | null;
}
