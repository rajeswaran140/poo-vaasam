/**
 * master-worker — async trim/fade + loudnorm mastering + web MP3 export Lambda (Event-invoked by
 * /api/admin/music-lab/master). Brings a "hot" take to -14 LUFS / -1 dBTP and
 * writes a 24-bit/48k WAV to S3 as `<s3Key>-master.wav`. Progress is recorded on
 * the MASTERJOB#<id> DynamoDB item (the repo's job idiom — NOT SQS); the status
 * route polls it. Never touches CloudFront. Timeout up to 15 min, ~4 GB /tmp.
 *
 * ffmpeg from the layer at /opt/bin/ffmpeg. Bundled with esbuild
 * (build:master-worker), @aws-sdk/* external. Env: TAKES_BUCKET,
 * DYNAMODB_TABLE_NAME, AWS_REGION; optional FFMPEG_PATH.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import {
  parseLoudnormStats,
  buildPass1Loudnorm,
  buildPass2Loudnorm,
  isValidTarget,
  masterKeyFor,
  isMasterKey,
  parseSourceInfo,
  parseNormalizationType,
  type SourceInfo,
} from '@/lib/loudness-measure';
import { isMasteringKey, isReferenceKey, matchedMasterKeyFor } from '@/lib/mastering-storage';
import { buildMp3Args, mp3KeyFor } from '@/lib/master-mp3';
import {
  parseMasterEdit,
  isNoOpEdit,
  buildEditFilterArg,
  validateAgainstSource,
  editedDurationSec,
  NO_EDIT,
  type MasterEdit,
} from '@/lib/master-edit';
import {
  buildSilenceArgs,
  buildTimelineArgs,
  parseSilences,
  parseTimeline,
  leadingSilenceSec,
  trailingSilenceSec,
  tailDropLu,
} from '@/lib/master-analysis';
import {
  buildComposeArgs,
  buildVideoArgs,
  videoKeyFor,
  VIDEO_HEIGHTS,
  type VideoHeight,
} from '@/lib/master-video';
import {
  parseMasterJoin,
  validateJoinAgainstSources,
  buildJoinFilterComplex,
  joinedDurationSec,
  JOIN_OUTPUT_LABEL,
} from '@/lib/master-join';
import { planUpload, uploadRefusalMessage } from '@/lib/youtube-upload';
import type { MasterJob } from '@/types/masterJob';

const FFMPEG = process.env.FFMPEG_PATH || '/opt/bin/ffmpeg';
const REGION = process.env.AWS_REGION || 'ca-central-1';
const TAKES_BUCKET = process.env.TAKES_BUCKET;
const TABLE = process.env.DYNAMODB_TABLE_NAME || 'TamilWebContent';
// S3 (takes bucket) may be in a different region than the Lambda + DynamoDB.
const S3_REGION = process.env.TAKES_BUCKET_REGION || REGION;
const s3 = new S3Client({ region: S3_REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});
// Reference-matched mastering (Phase 1B). The Python matchering-worker Lambda
// is invoked fire-and-forget after the loudnorm master succeeds when the job
// carries a validated referenceKey and matchingMethod includes 'matched'.
const MATCHERING_WORKER_FUNCTION =
  process.env.MATCHERING_WORKER_FUNCTION || 'tamilagaval-matchering-worker';
const lambdaClient = new LambdaClient({ region: REGION });
const ssm = new SSMClient({ region: REGION });

async function patch(jobId: string, fields: Record<string, unknown>): Promise<void> {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets: string[] = [];
  for (const [k, v] of Object.entries({ ...fields, updatedAt: new Date().toISOString() })) {
    names[`#${k}`] = k;
    values[`:${k}`] = v;
    sets.push(`#${k} = :${k}`);
  }
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `MASTERJOB#${jobId}`, SK: 'METADATA' },
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}

/** Same shape as patch(), against the analysis record. */
async function patchAnalysis(id: string, fields: Record<string, unknown>): Promise<void> {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets: string[] = [];
  for (const [k, v] of Object.entries({ ...fields, updatedAt: new Date().toISOString() })) {
    names[`#${k}`] = k;
    values[`:${k}`] = v;
    sets.push(`#${k} = :${k}`);
  }
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `MASTERANALYSIS#${id}`, SK: 'METADATA' },
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
}

const ff = (args: string[]) => spawnSync(FFMPEG, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

interface MasterEvent {
  jobId?: string;
  s3Key?: string;
  target?: number;
  edit?: unknown;
  /** Two-part assembly: Part B plus the crossfade. See master-join.ts. */
  join?: unknown;
  /**
   * A VIDEO RENDER rather than a mastering run — cover art over an already
   * mastered WAV. Handled before anything else, so a render can never re-master
   * (and so re-measure) a file that is already finished.
   */
  render?: { audioKey?: string; coverKey?: string; height?: number };
  /**
   * A pre-master ANALYSIS — measure a source before anything is decided about
   * it. Handled before the mastering guards, like a render: it carries no
   * target and produces no audio.
   */
  analyse?: { analysisId?: string; s3Key?: string; partBKey?: string | null };
  /**
   * Reference-matched mastering (Phase 1B). When referenceKey is set AND
   * matchingMethod is 'matched' or 'both', this worker completes its loudnorm
   * pass then Event-invokes tamilagaval-matchering-worker to produce a
   * matched output alongside the loudnorm master. Fire-and-forget — the
   * Python worker patches MASTERJOB matchingStage independently. See
   * worker/matchering_worker/handler.py.
   */
  referenceKey?: string;
  referenceId?: string;
  matchingMethod?: 'loudnorm' | 'matched' | 'both';
  /**
   * Upload an already-rendered video to YouTube. Handled before the mastering
   * guards, like `render`, so an upload can never re-master.
   */
  youtube?: { title: string; description: string; tags: string[]; playlistIds: string[] };
}

/**
 * Measure one file: how much dead air at each end, and whether its tail is
 * already fading.
 *
 * Two ffmpeg passes, both read-only. The integrated loudness comes free from
 * the same ebur128 pass that yields the timeline, so comparing two parts costs
 * one decode each rather than two.
 */
function measureSource(path: string): {
  durationSec: number | null;
  leading: number | null;
  trailing: number | null;
  drop: number | null;
  integrated: number | null;
} {
  const info = probeSource(path);
  const durationSec = info?.durationSec ?? null;

  const sil = ff(buildSilenceArgs(path));
  const spans = parseSilences(`${sil.stdout ?? ''}${sil.stderr ?? ''}`, durationSec ?? 0);
  const leading = leadingSilenceSec(spans);
  const trailing = trailingSilenceSec(spans, durationSec ?? 0);

  const tl = ff(buildTimelineArgs(path));
  const log = `${tl.stdout ?? ''}${tl.stderr ?? ''}`;
  const points = parseTimeline(log);
  // ebur128's Summary block prints the integrated figure at the end.
  const integ = /I:\s*(-?[\d.]+)\s*LUFS/g;
  let m: RegExpExecArray | null;
  let integrated: number | null = null;
  while ((m = integ.exec(log)) !== null) integrated = Number(m[1]);

  return { durationSec, leading, trailing, drop: tailDropLu(points, trailing), integrated };
}

/**
 * Run a pre-master analysis and record the MEASUREMENTS.
 *
 * Deliberately stores numbers, never verdicts: the app decides what a 4 LU tail
 * drop means, so a threshold or a wording change ships with an Amplify build
 * instead of a Lambda redeploy.
 */
async function analyseSource(
  analysisId: string,
  spec: NonNullable<MasterEvent['analyse']>,
  bucket: string
) {
  const s3Key = spec.s3Key ?? '';
  const partBKey = spec.partBKey || null;
  if (!isMasteringKey(s3Key) || (partBKey && !isMasteringKey(partBKey))) {
    await patchAnalysis(analysisId, {
      status: 'error',
      error: { code: 'bad-key', message: 'analysis sources must be in the mastering workspace' },
    });
    return { ok: false };
  }

  const dir = mkdtempSync(join(tmpdir(), 'analyse-'));
  const aPath = join(dir, 'a.wav');
  const bPath = join(dir, 'b.wav');
  try {
    const a = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: s3Key }));
    writeFileSync(aPath, Buffer.from(await a.Body!.transformToByteArray()));
    const A = measureSource(aPath);

    let B: ReturnType<typeof measureSource> | null = null;
    if (partBKey) {
      const b = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: partBKey }));
      writeFileSync(bPath, Buffer.from(await b.Body!.transformToByteArray()));
      B = measureSource(bPath);
    }

    await patchAnalysis(analysisId, {
      status: 'done',
      durationSec: A.durationSec,
      leadingSilenceSec: A.leading,
      trailingSilenceSec: A.trailing,
      tailDropLu: A.drop,
      integratedLufs: A.integrated,
      partBDurationSec: B?.durationSec ?? null,
      partBIntegratedLufs: B?.integrated ?? null,
      partBTailDropLu: B?.drop ?? null,
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[master-worker] analysis failed:', message);
    await patchAnalysis(analysisId, { status: 'error', error: { code: 'exception', message } }).catch(() => {});
    return { ok: false };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Cover dimensions, as width/height. Undefined when they cannot be read.
 *
 * Undefined is a real answer, not a failure: buildVideoFilter treats an unknown
 * aspect as "use the blurred backdrop", which never crops the artwork. Guessing
 * 16:9 and being wrong would.
 *
 * ⚠️ SCANS EVERY "Video:" LINE AND PICKS THE LARGEST BY PIXEL AREA — this
 * supersedes a single first-match regex. A JPEG cover can carry an embedded
 * EXIF/MPF thumbnail as its own, separate video stream, printed BEFORE the
 * real image in ffmpeg's header. A first-match read can therefore probe the
 * thumbnail's aspect instead of the cover's: if that aspect happens to land
 * inside 16:9±tolerance while the real image is not 16:9, the fill-frame
 * branch fires on the wrong ratio and crops the operator's artwork — the one
 * outcome he has rejected outright. Missing the fill (false negative) is
 * merely cosmetic; firing it wrongly (false positive) destroys the picture.
 * A real thumbnail is always far smaller in pixel area than the real image,
 * so largest-wins picks the correct stream in every realistic case.
 */
function probeCoverAspect(coverPath: string): number | undefined {
  try {
    // `ffmpeg -i FILE` with no output prints the header and exits non-zero by
    // design — the same trick probeSource() already uses. Deliberately NOT
    // ffprobe: the Lambda layer is pinned by FFMPEG_PATH and is not guaranteed
    // to ship ffprobe, and a missing binary here would silently disable the
    // fill-frame branch for every render.
    const r = ff(['-hide_banner', '-i', coverPath]);
    const log = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    // e.g. "Stream #0:0: Video: png, rgb24, 1672x941 [SAR 1:1 DAR 1672:941]"
    // Global, so every "Video:" line in the header is considered, not just
    // the first — see the largest-wins note above.
    const re = /Video:.*?\s(\d{2,5})x(\d{2,5})/g;
    let best: { w: number; h: number; area: number } | null = null;
    let m: RegExpExecArray | null;
    while ((m = re.exec(log)) !== null) {
      const w = Number(m[1]);
      const h = Number(m[2]);
      if (!w || !h) continue;
      const area = w * h;
      if (!best || area > best.area) best = { w, h, area };
    }
    if (!best) return undefined;
    return best.w / best.h;
  } catch {
    return undefined;
  }
}

/**
 * Render the YouTube video: still cover, mastered audio, one encode.
 *
 * Separate from the mastering flow on purpose. It shares the Lambda because the
 * ffmpeg layer and the bucket access are already here, but it shares nothing
 * else: no loudness pass runs, and the job's measurements are never rewritten.
 * A failure records `videoError` and leaves the master untouched — the WAV was
 * already delivered, and losing it to a failed picture render would be absurd.
 */
async function renderVideo(jobId: string, spec: NonNullable<MasterEvent['render']>, bucket: string) {
  const audioKey = spec.audioKey ?? '';
  const coverKey = spec.coverKey ?? '';
  const height = (spec.height ?? 1440) as VideoHeight;

  // Re-validated here, not trusted from the event: this role can read and write
  // the whole bucket, and the route is not the only thing that can invoke it.
  if (!isMasteringKey(audioKey) || !isMasterKey(audioKey)) {
    await patch(jobId, { videoError: 'render source must be a mastered WAV in the mastering workspace' });
    return { ok: false };
  }
  if (!isMasteringKey(coverKey)) {
    await patch(jobId, { videoError: 'cover must be in the mastering workspace' });
    return { ok: false };
  }
  if (!VIDEO_HEIGHTS.includes(height)) {
    await patch(jobId, { videoError: `height must be one of ${VIDEO_HEIGHTS.join(', ')}` });
    return { ok: false };
  }

  const dir = mkdtempSync(join(tmpdir(), 'render-'));
  const audioPath = join(dir, 'master.wav');
  const coverPath = join(dir, `cover${coverKey.match(/\.[a-z0-9]+$/i)?.[0] ?? '.jpg'}`);
  const framePath = join(dir, 'frame.png');
  const outPath = join(dir, 'out.mp4');
  try {
    const audio = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: audioKey }));
    writeFileSync(audioPath, Buffer.from(await audio.Body!.transformToByteArray()));
    const cover = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: coverKey }));
    writeFileSync(coverPath, Buffer.from(await cover.Body!.transformToByteArray()));

    // TWO passes, deliberately. Composing the frame once and looping THAT is
    // what brings the render inside the 900 s timeout — see buildComposeArgs.
    // Reported separately so a failure says which half broke; they fail for
    // different reasons (an unreadable cover vs an encode problem).
    const coverAspect = probeCoverAspect(coverPath);
    const composed = ff(buildComposeArgs({ coverPath, framePath, height, coverAspect }));
    if (composed.status !== 0) {
      await patch(jobId, { videoError: 'the cover could not be composed into a frame' });
      return { ok: false };
    }

    const r = ff(buildVideoArgs({ framePath, audioPath, outPath }));
    if (r.status !== 0) {
      await patch(jobId, { videoError: 'the video render failed' });
      return { ok: false };
    }

    const videoKey = videoKeyFor(audioKey, height);
    await s3.send(new PutObjectCommand({
      Bucket: bucket, Key: videoKey, Body: readFileSync(outPath), ContentType: 'video/mp4',
    }));
    await patch(jobId, {
      videoKey,
      videoRenderedAt: new Date().toISOString(),
      videoError: null,
      coverKey,
    });
    return { ok: true, videoKey };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[master-worker] render failed:', message);
    await patch(jobId, { videoError: message }).catch(() => {});
    return { ok: false };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Content-Type for `thumbnails.set`, from the cover's own file extension.
 *
 * The cover-upload route accepts .jpg/.jpeg, .png and .webp. Hardcoding
 * `image/png` made every JPEG cover fail the thumbnail call silently — it
 * lands in `problems` and the job still reads `uploaded`, so the only way to
 * notice was to look at the video. `.jpg`/1_c_cover.jpg is the worker's own
 * test fixture and was exactly the failing case.
 */
function coverContentType(key: string): string {
  const ext = key.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

/**
 * True when a resumable session is UNAMBIGUOUSLY gone and must be abandoned
 * (cleared from the job, a fresh one opened) rather than resumed.
 *
 * ONLY 404 and 410 — Google's own "this upload URI no longer exists"
 * statuses. Nothing else qualifies, most importantly NOT a bare 400.
 *
 * ⚠️ 400 IS DELIBERATELY EXCLUDED — this is a considered choice under
 * uncertainty, not an oversight. A 400 is plausibly a Content-Range size
 * mismatch (see the explicit, LOCAL size check in uploadToYoutube, which
 * catches that case in the 308 branch without needing Google to tell us
 * anything), but "bad
 * request" is a broad class and could mean something else entirely — a
 * transient condition at Google, an intermediary, a malformed header a
 * future edit introduces. The two misclassification costs are not
 * symmetric: treating a genuinely-dead session as alive costs a failed job
 * an operator has to look at — annoying, fully recoverable. Treating a
 * genuinely-alive session as dead costs a SECOND `videos.insert` — a
 * duplicate video on a real channel, recoverable only by finding and
 * deleting it by hand. When the evidence is ambiguous, the branch that
 * fails in the recoverable direction is correct, so 400 is treated like a
 * 5xx: keep the session, mark the job failed, let the operator decide. If
 * 400's meaning is ever confirmed against the live API, this may be
 * revisited — it is excluded on principle here, not on certainty.
 *
 * Anything else (5xx, a network-layer failure) does NOT prove the session is
 * dead either, so it too must be LEFT ALONE — clearing it there is how the
 * exact jam the staleness window exists to prevent gets reintroduced: a good
 * session abandoned, and the next retry opening (and risking) a second video
 * instead of resuming.
 */
function sessionIsGone(status: number): boolean {
  return status === 404 || status === 410;
}

/**
 * Upload a rendered video to YouTube as a PRIVATE draft, then read it back.
 *
 * ⚠️ WHY THIS RUNS HERE AND NOT IN THE WEB APP. The token this needs is
 * force-ssl scoped: it can delete videos and post comments on the channel. The
 * deployed Next.js app is public-facing and holds only readonly analytics
 * scope, and it stays that way. This function is private, already reads SSM,
 * and already has the MP4 on local disk.
 *
 * ⚠️ WHY IT REFUSES TO INSERT TWICE. A video file cannot be replaced on
 * YouTube, so a duplicate insert means a second video to find and delete by
 * hand. planUpload refuses when youtubeVideoId is set; the id is written the
 * MOMENT the insert returns, before the thumbnail or the playlists, so a later
 * failure can never orphan it.
 *
 * ⚠️ RESUMING AN EXISTING SESSION FOLLOWS GOOGLE'S RESUMABLE-UPLOAD PROTOCOL,
 * not a bare re-PUT of the whole body: the session is QUERIED first (a PUT
 * with an empty body and a `Content-Range: bytes STAR/SIZE`-shaped header,
 * "STAR" meaning a literal asterisk), because a bare
 * re-PUT cannot tell "still uploading" apart from "already finished — the id
 * write just never landed", and guessing wrong either duplicates the insert
 * or loses the id forever. The query's status decides what happens next; see
 * the branches below and `sessionIsGone`. `now` is threaded through to
 * `planUpload` (default `Date.now()`) so the planner's clock is injectable
 * from a test; at `stage: 'execute'` the planner does not consult it, because
 * staleness is the enqueue gate's question, not this function's.
 */
export async function uploadToYoutube(
  jobId: string,
  spec: NonNullable<MasterEvent['youtube']>,
  bucket: string,
  now: number = Date.now(),
) {
  const job = await getJob(jobId);
  if (!job) return { ok: false };

  // 'execute', not 'enqueue'. The route marked this job `queued` and stamped a
  // fresh `updatedAt` BEFORE it invoked this worker, so re-running the gate's
  // concurrency check here would have the worker refuse the very job it was
  // invoked for — which it did, for every upload, until this stage argument
  // existed. 'execute' skips ONLY that refusal; `already-uploaded` (the
  // duplicate-video guard) and every eligibility check still apply, and this
  // is the only caller that could actually create the duplicate.
  const plan = planUpload(job, spec, { now, stage: 'execute' });
  if (!plan.ok) {
    // A refusal must never overwrite a TERMINAL 'uploaded' state. Marking
    // 'already-uploaded' as 'failed' is what invited an operator to clear
    // youtubeVideoId by hand to "retry" a job whose video is already live —
    // producing the exact duplicate this whole file exists to prevent. Every
    // other refusal is a genuine non-terminal problem and may still fail.
    await patch(jobId, {
      uploadStatus: plan.reason === 'already-uploaded' ? 'uploaded' : 'failed',
      uploadError: uploadRefusalMessage(plan.reason),
    });
    return { ok: false };
  }

  await patch(jobId, { uploadStatus: 'uploading', uploadError: null });

  const dir = mkdtempSync(join(tmpdir(), 'ytupload-'));
  const videoPath = join(dir, 'video.mp4');
  try {
    const token = await youtubeAccessToken();

    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: plan.videoKey }));
    writeFileSync(videoPath, Buffer.from(await obj.Body!.transformToByteArray()));
    const size = statSync(videoPath).size;

    // Resume an interrupted session rather than opening a new one — opening a
    // new one is how a retry becomes a duplicate video.
    let sessionUri = job.uploadSessionUri ?? null;
    let videoId: string | undefined;

    // UNAMBIGUOUS, LOCAL evidence that the bytes on disk are no longer the
    // bytes this session declared via X-Upload-Content-Length — the file was
    // almost certainly re-rendered since. It means the session cannot RECEIVE
    // these bytes.
    //
    // ⚠️ IT IS NOT EVIDENCE THAT THE SESSION NEVER FINISHED, so it must not
    // decide anything before the query. Discarding here was a second
    // duplicate-insert path, and a reachable one: PUT succeeds → the worker
    // dies before the id patch → the operator re-renders → retry → mismatch →
    // fresh session → a SECOND video on the channel. The mismatch is recorded
    // now and consulted only in the 308 branch below, AFTER the query has had
    // its say; a 200/201 still recovers the id and completes.
    const sizeMismatch =
      typeof job.uploadSessionSize === 'number' && job.uploadSessionSize !== size;

    if (sessionUri) {
      const query = await fetch(sessionUri, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          // The total must describe the SESSION being queried, not the file
          // sitting on disk — and the two differ in exactly the mismatch case
          // this query now runs for. Sending the local size against a session
          // that declared a different one invites a 400, which `sessionIsGone`
          // deliberately does not treat as dead, so the job would fail with the
          // session retained and every retry would jam the same way.
          'Content-Range': `bytes */${job.uploadSessionSize ?? size}`,
        },
      });

      if (query.status === 200 || query.status === 201) {
        // The upload had ALREADY finished on a prior attempt — this is the
        // sole recovery path for "the PUT succeeded but the youtubeVideoId
        // write never landed". The response body IS the video resource;
        // treat it exactly as if videos.insert had just returned it.
        //
        // Deliberately reached even when `sizeMismatch` is true: the video on
        // YouTube was built from the OLDER bytes, which cannot be changed (a
        // video file is not replaceable), so the choice is one video whose id
        // the operator can see and delete, or that one PLUS a second insert.
        // Recovering the id is the recoverable direction.
        const already = await query.json();
        videoId = already?.id as string | undefined;
        if (!videoId) {
          await patch(jobId, {
            uploadStatus: 'failed',
            uploadError: 'YouTube reported the upload complete but returned no video id.',
          });
          return { ok: false };
        }
      } else if (query.status === 308 && sizeMismatch) {
        // Incomplete AND the bytes have changed: this session can never accept
        // the file now on disk, and the query has just proved it did not
        // already finish. Only here is discarding it safe — and it is the same
        // fall-through the 404 branch uses, which opens a fresh session below.
        sessionUri = null;
        await patch(jobId, { uploadSessionUri: null, uploadSessionSize: null });
      } else if (query.status === 308) {
        // Incomplete. Re-sending the whole body from byte 0 with a correct
        // Content-Range is acceptable given this artifact is ~58 MB — the
        // `Range` response header (bytes Google already has) is not needed to
        // make that resend correct, only to make a partial resend possible,
        // which isn't attempted here.
        const put = await fetch(sessionUri, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'video/mp4',
            'Content-Range': `bytes 0-${size - 1}/${size}`,
          },
          body: readFileSync(videoPath),
        });
        if (!put.ok) {
          await patch(jobId, {
            uploadStatus: 'failed',
            uploadError: await quotaAwareError(put),
            ...(sessionIsGone(put.status) ? { uploadSessionUri: null, uploadSessionSize: null } : {}),
          });
          return { ok: false };
        }
        const inserted = await put.json();
        videoId = inserted?.id as string | undefined;
        if (!videoId) {
          await patch(jobId, { uploadStatus: 'failed', uploadError: 'YouTube accepted the upload but returned no video id.' });
          return { ok: false };
        }
      } else if (sessionIsGone(query.status)) {
        // 404/410 only — expired or never valid. Clear it and fall through to
        // opening a fresh one below, the same single-PUT flow a first attempt
        // uses. (A since-replaced file takes the same fall-through, but only
        // from the 308 branch above — never before the query.)
        sessionUri = null;
        await patch(jobId, { uploadSessionUri: null, uploadSessionSize: null });
      } else {
        // Some other status querying the session (5xx, a network-layer
        // response) does not prove it is dead — KEEP uploadSessionUri so the
        // next invocation still resumes instead of risking a second video.
        await patch(jobId, { uploadStatus: 'failed', uploadError: await quotaAwareError(query) });
        return { ok: false };
      }
    }

    if (videoId === undefined) {
      // Either a genuinely first attempt, or the previous session was just
      // found to be gone above — both take the same single-PUT flow.
      if (!sessionUri) {
        const meta = {
          snippet: {
            title: plan.title,
            description: plan.description,
            tags: plan.tags,
            categoryId: plan.categoryId,
            defaultLanguage: 'ta',
            defaultAudioLanguage: 'ta',
          },
          status: {
            privacyStatus: plan.privacyStatus,
            selfDeclaredMadeForKids: false,
            license: 'youtube',
            embeddable: true,
          },
        };
        const open = await fetch(
          'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json; charset=UTF-8',
              'X-Upload-Content-Length': String(size),
              'X-Upload-Content-Type': 'video/mp4',
            },
            body: JSON.stringify(meta),
          },
        );
        if (!open.ok) {
          await patch(jobId, { uploadStatus: 'failed', uploadError: await quotaAwareError(open) });
          return { ok: false };
        }
        sessionUri = open.headers.get('location');
        if (!sessionUri) {
          await patch(jobId, { uploadStatus: 'failed', uploadError: 'YouTube did not return an upload session.' });
          return { ok: false };
        }
        // Recorded alongside the uri so a later resume can tell — LOCALLY,
        // with no Google call — whether this file is still the one the
        // session was opened against. See the uploadSessionSize check above.
        await patch(jobId, { uploadSessionUri: sessionUri, uploadSessionSize: size });
      }

      const put = await fetch(sessionUri, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'video/mp4' },
        body: readFileSync(videoPath),
      });
      if (!put.ok) {
        await patch(jobId, {
          uploadStatus: 'failed',
          uploadError: await quotaAwareError(put),
          ...(sessionIsGone(put.status) ? { uploadSessionUri: null, uploadSessionSize: null } : {}),
        });
        return { ok: false };
      }
      const inserted = await put.json();
      videoId = inserted?.id as string | undefined;
      if (!videoId) {
        await patch(jobId, { uploadStatus: 'failed', uploadError: 'YouTube accepted the upload but returned no video id.' });
        return { ok: false };
      }
    }

    // ⚠️ THE ONLY VIDEO THIS FUNCTION MAY EVER WRITE TO. `videoId` is captured
    // directly from THIS invocation's own insert/resume response, in the
    // narrowest scope available, and every write below (the patch, the
    // thumbnail, every playlist add) must read this same constant — never the
    // job row, never the event. See the thumbnail and playlist call sites for
    // why.

    // FIRST write after the id is known, before anything else can fail.
    await patch(jobId, {
      youtubeVideoId: videoId,
      uploadedToYoutubeAt: new Date().toISOString(),
      uploadSessionUri: null,
      uploadSessionSize: null,
    });

    // Thumbnail and playlists are best-effort: the video exists, and failing
    // them must not mark the upload failed or invite a re-insert.
    const problems: string[] = [];
    if (plan.coverKey) {
      try {
        const cover = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: plan.coverKey }));
        const bytes = Buffer.from(await cover.Body!.transformToByteArray());
        // MUST be `videoId` from above — never a job-row or event id. This
        // video has never been seen by the operator; pointing this call at an
        // existing video would overwrite the artwork of a live, published
        // video on a channel with a real audience, and that is not recoverable
        // by re-running anything.
        const t = await fetch(
          `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': coverContentType(plan.coverKey) },
            body: bytes,
          },
        );
        if (!t.ok) problems.push('thumbnail');
      } catch { problems.push('thumbnail'); }
    }
    for (const playlistId of plan.playlistIds) {
      try {
        // MUST be `videoId` from the insert above — never a job-row or event
        // id. Adding the wrong video's id to a playlist changes the membership
        // of a live, published video that a real audience already sees, and
        // that is not recoverable by re-running anything. There is also no
        // `videos.update` call anywhere in this file, deliberately: nothing
        // here may ever modify an existing video's metadata.
        const r = await fetch('https://www.googleapis.com/youtube/v3/playlistItems?part=snippet', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } } }),
        });
        if (!r.ok) problems.push(`playlist ${playlistId}`);
      } catch { problems.push(`playlist ${playlistId}`); }
    }

    await patch(jobId, {
      uploadStatus: 'uploaded',
      uploadError: problems.length ? `Uploaded, but these did not apply: ${problems.join(', ')}.` : null,
    });
    return { ok: true, videoId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[master-worker] youtube upload failed:', message);
    await patch(jobId, { uploadStatus: 'failed', uploadError: message }).catch(() => {});
    return { ok: false };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * A YouTube access token with WRITE scope, from SSM SecureString.
 * Never logged, never written to disk, never returned to the caller's caller.
 */
async function youtubeAccessToken(): Promise<string> {
  const prefix = process.env.YOUTUBE_SSM_PREFIX || '/amplify/d3rkmepk4popv0/master';
  const read = async (name: string) => {
    const r = await ssm.send(new GetParameterCommand({ Name: `${prefix}/${name}`, WithDecryption: true }));
    return r.Parameter?.Value ?? '';
  };
  const [secret, refresh] = await Promise.all([
    read('YOUTUBE_OAUTH_CLIENT_SECRET'),
    read('YOUTUBE_DATA_REFRESH_TOKEN'),
  ]);
  const clientId = process.env.YOUTUBE_OAUTH_CLIENT_ID ?? '';
  if (!secret || !refresh || !clientId) throw new Error('YouTube credentials are not configured.');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('Could not refresh the YouTube access token.');
  return j.access_token as string;
}

/**
 * Quota exhaustion needs its own wording. videos.insert costs 1600 units of a
 * 10,000/day default shared with the analytics routes, so a generic failure
 * message invites a retry that burns what is left.
 */
async function quotaAwareError(res: Response): Promise<string> {
  const body = await res.text().catch(() => '');
  if (res.status === 403 && /quota/i.test(body)) {
    return 'Daily YouTube upload quota exhausted. videos.insert costs 1600 of 10,000 units a day — wait for the Pacific-midnight reset rather than retrying.';
  }
  return `YouTube rejected the upload (HTTP ${res.status}).`;
}

/** Read a job back for the upload guards. */
async function getJob(jobId: string): Promise<MasterJob | null> {
  const r = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: `MASTERJOB#${jobId}`, SK: 'METADATA' },
  }));
  return (r.Item as MasterJob) ?? null;
}

/**
 * Read a file's header without decoding it.
 *
 * `ffmpeg -i FILE` with no output prints the input header and exits non-zero —
 * that is its documented behaviour, not a failure, so the status is ignored and
 * only the log is read. Costs one process spawn and no audio processing.
 *
 * Needed because the edit pass has to know where the file ends before it can
 * place a tail trim or a fade-out, and that is upstream of pass 1.
 */
function probeSource(path: string): SourceInfo | null {
  const probe = ff(['-hide_banner', '-i', path]);
  return parseSourceInfo(`${probe.stdout ?? ''}${probe.stderr ?? ''}`);
}

export const handler = async (event: MasterEvent) => {
  const jobId = event?.jobId;
  const s3Key = event?.s3Key;
  if (event?.analyse) {
    const id = event.analyse.analysisId;
    if (!id || !TAKES_BUCKET) {
      console.error('[master-worker] bad analyse event');
      return { ok: false, error: 'analysisId and TAKES_BUCKET are required' };
    }
    return await analyseSource(id, event.analyse, TAKES_BUCKET);
  }

  // A render is a different job entirely — branch before the mastering guards,
  // which are about a SOURCE key this event does not carry.
  if (event?.render) {
    if (!jobId || !TAKES_BUCKET) {
      console.error('[master-worker] bad render event');
      return { ok: false, error: 'jobId and TAKES_BUCKET are required' };
    }
    return await renderVideo(jobId, event.render, TAKES_BUCKET);
  }

  // A YouTube upload, likewise — branch before the mastering guards, so an
  // upload can never re-master.
  if (event?.youtube) {
    if (!jobId || !TAKES_BUCKET) {
      console.error('[master-worker] bad youtube event');
      return { ok: false, error: 'jobId and TAKES_BUCKET are required' };
    }
    return await uploadToYoutube(jobId, event.youtube, TAKES_BUCKET);
  }

  // The bucket is NOT taken from the event. The worker's IAM role can read and
  // write anywhere in tamil-web-media, so an attacker-shaped payload naming
  // another bucket (or the route regressing to pass one) would widen what this
  // function touches for no feature benefit. It masters what is in its own.
  const bucket = TAKES_BUCKET;
  const target = event?.target === undefined ? -14 : event.target;
  if (!jobId || !s3Key || !bucket) {
    console.error('[master-worker] bad event', JSON.stringify({ jobId: !!jobId, s3Key: !!s3Key, bucket: !!bucket }));
    return { ok: false, error: 'jobId, s3Key and TAKES_BUCKET are required' };
  }
  // The route validates these too; re-check here because the Lambda is
  // Event-invoked and a bad payload would otherwise fail deep inside ffmpeg.
  //
  // The prefix check is the important one: the role holds s3:GetObject and
  // s3:PutObject on the WHOLE bucket, so without it a bad key would let this
  // function read — and, via masterKeyFor, write next to — published catalogue
  // audio. The route already refuses such a key; this is the second lock.
  if (!isMasteringKey(s3Key)) {
    await patch(jobId, { status: 'error', error: { code: 'bad-key', message: 'that key is not in the mastering workspace' } });
    return { ok: false };
  }
  if (!isValidTarget(target)) {
    await patch(jobId, { status: 'error', error: { code: 'bad-target', message: `target must be a number in [-70, -5], got ${target}` } });
    return { ok: false };
  }
  if (isMasterKey(s3Key)) {
    await patch(jobId, { status: 'error', error: { code: 'already-mastered', message: 'that key is already a mastering output; master the original source instead' } });
    return { ok: false };
  }
  // Re-validated here for the same reason as target: the Lambda is
  // Event-invoked, so the route's check is not the only one that can run.
  const parsedEdit = parseMasterEdit(event?.edit ?? undefined);
  if (!parsedEdit.ok) {
    await patch(jobId, { status: 'error', error: { code: 'bad-edit', message: parsedEdit.error } });
    return { ok: false };
  }
  const edit: MasterEdit = parsedEdit.edit;

  // Two-part assembly. Re-validated here for the same reason as the edit, and
  // Part B's key gets the SAME workspace guard as Part A: without it a join
  // payload would be a second, unchecked way to make this function read any
  // object in the bucket.
  const parsedJoin = parseMasterJoin(event?.join ?? undefined);
  if (!parsedJoin.ok) {
    await patch(jobId, { status: 'error', error: { code: 'bad-join', message: parsedJoin.error } });
    return { ok: false };
  }
  const joinSpec = parsedJoin.join;
  if (joinSpec && (!isMasteringKey(joinSpec.partBKey) || isMasterKey(joinSpec.partBKey))) {
    await patch(jobId, {
      status: 'error',
      error: { code: 'bad-join-key', message: 'Part B must be an un-mastered file in the mastering workspace' },
    });
    return { ok: false };
  }

  const dir = mkdtempSync(join(tmpdir(), 'master-'));
  const ext = s3Key.match(/\.[a-z0-9]+$/i)?.[0] ?? '';
  const inPath = join(dir, `in${ext}`);
  const inBPath = join(dir, 'in-b.wav');
  const editedPath = join(dir, 'edited.wav');
  const outPath = join(dir, 'out.wav');
  const mp3Path = join(dir, 'out.mp3');
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: s3Key }));
    writeFileSync(inPath, Buffer.from(await obj.Body!.transformToByteArray()));

    // Pass 0 — trim/fade, BEFORE any measurement.
    //
    // Integrated loudness is an average over the programme, so cutting a tail
    // after normalising would leave the file off its target. Editing first is
    // the only ordering where the recorded afterLufs stays true of what ships.
    // The existing three passes below are deliberately untouched; they simply
    // run on this file instead of the raw download.
    let sourceForMastering = inPath;
    let editedDuration: number | null = null;
    // Only set when an edit runs. Pass 1's header then describes the EDITED
    // file, so without this the job would record the intermediate's format as
    // "what came in" — which is exactly what `source` promises it is not.
    let trueSource: SourceInfo | null = null;

    if (joinSpec) {
      // TWO-PART ASSEMBLY. The join happens here, in the pre-pass, for the same
      // reason the trim does: integrated loudness is an average over a
      // programme, so mastering the halves separately and crossfading afterwards
      // leaves neither half on target and spikes the overlap. Joining first
      // makes the correct order the only order — every number below describes
      // the assembled song.
      const objB = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: joinSpec.partBKey }));
      writeFileSync(inBPath, Buffer.from(await objB.Body!.transformToByteArray()));

      trueSource = probeSource(inPath);
      const partB = probeSource(inBPath);
      const durA = trueSource?.durationSec ?? Number.NaN;
      const durB = partB?.durationSec ?? Number.NaN;

      if (!isNoOpEdit(edit)) {
        const checkA = validateAgainstSource(edit, Number.isFinite(durA) ? durA : 0);
        if (!checkA.ok) {
          await patch(jobId, { status: 'error', error: { code: 'bad-edit', message: checkA.error } });
          return { ok: false };
        }
      }
      const editA = isNoOpEdit(edit) ? null : edit;
      const checkJoin = validateJoinAgainstSources(joinSpec, editA, durA, durB);
      if (!checkJoin.ok) {
        await patch(jobId, { status: 'error', error: { code: 'bad-join', message: checkJoin.error } });
        return { ok: false };
      }

      const graph = buildJoinFilterComplex({ editA, partASec: durA, join: joinSpec, partBSec: durB });
      const p0 = ff([
        '-hide_banner', '-nostats',
        '-i', inPath, '-i', inBPath,
        '-filter_complex', graph,
        '-map', `[${JOIN_OUTPUT_LABEL}]`,
        // Same 32-bit float intermediate as the single-source edit: a crossfade
        // multiplies both sides by fractional gains, so an integer intermediate
        // would quantise every sample of the seam before mastering even starts.
        '-c:a', 'pcm_f32le', '-y', editedPath,
      ]);
      if (p0.status !== 0) {
        await patch(jobId, { status: 'error', error: { code: 'pass0', message: 'crossfade join failed' } });
        return { ok: false };
      }
      sourceForMastering = editedPath;
      editedDuration = joinedDurationSec(
        editedDurationSec(edit, durA),
        editedDurationSec(joinSpec.editB ?? NO_EDIT, durB),
        joinSpec.overlapSec,
      );
    } else if (!isNoOpEdit(edit)) {
      trueSource = probeSource(inPath);
      const durationSec = trueSource?.durationSec ?? null;
      const check = validateAgainstSource(edit, durationSec ?? 0);
      if (!check.ok) {
        await patch(jobId, { status: 'error', error: { code: 'bad-edit', message: check.error } });
        return { ok: false };
      }
      const filterArg = buildEditFilterArg(edit, durationSec ?? 0);
      if (filterArg) {
        // 32-bit float intermediate: a fade multiplies samples by fractional
        // gains, so an integer intermediate would quantise every faded sample
        // before the master is even built. Sample rate is left alone — pass 2
        // does the one and only conversion to 48 kHz.
        const p0 = ff(['-hide_banner', '-nostats', '-i', inPath, '-af', filterArg, '-c:a', 'pcm_f32le', '-y', editedPath]);
        if (p0.status !== 0) {
          await patch(jobId, { status: 'error', error: { code: 'pass0', message: 'trim/fade pass failed' } });
          return { ok: false };
        }
        sourceForMastering = editedPath;
        editedDuration = durationSec === null ? null : editedDurationSec(edit, durationSec);
      }
    }

    // Pass 1 — measure for linear loudnorm.
    const p1 = ff(['-hide_banner', '-nostats', '-i', sourceForMastering, '-af', buildPass1Loudnorm(target), '-f', 'null', '-']);
    const p1Log = `${p1.stdout ?? ''}${p1.stderr ?? ''}`;
    const stats = parseLoudnormStats(p1Log);
    // Free: pass 1 already prints the input header, so recording what the source
    // WAS costs no extra decode. Never fatal — a master with an unreadable
    // header is still a valid master.
    //
    // When an edit ran, pass 1's header belongs to the 32-bit-float
    // intermediate, so the probe of the real download wins.
    const source = trueSource ?? parseSourceInfo(p1Log);
    if (!stats) {
      await patch(jobId, { status: 'error', error: { code: 'pass1', message: 'loudnorm pass 1 produced no stats' } });
      return { ok: false };
    }

    // Pass 2 — linear normalize → 24-bit / 48 kHz WAV.
    const p2 = ff(['-hide_banner', '-nostats', '-i', sourceForMastering, '-af', buildPass2Loudnorm(stats, target), '-ar', '48000', '-c:a', 'pcm_s24le', '-y', outPath]);
    if (p2.status !== 0) {
      await patch(jobId, { status: 'error', error: { code: 'pass2', message: 'loudnorm pass 2 failed' } });
      return { ok: false };
    }
    // What pass 2 ACTUALLY did. We ask for linear, but ffmpeg downgrades to
    // dynamic (i.e. compresses) without erroring when linear would clip — so
    // this is read from pass 2's own log, not assumed from the request.
    const normalizationType = parseNormalizationType(`${p2.stdout ?? ''}${p2.stderr ?? ''}`);

    // Pass 3 — re-measure the output so the job records what it actually landed
    // on. Saves the operator downloading the file to confirm the target was hit;
    // a few seconds against a 15 min budget.
    const p3 = ff(['-hide_banner', '-nostats', '-i', outPath, '-af', `loudnorm=I=${target}:TP=-1:LRA=11:print_format=json`, '-f', 'null', '-']);
    const after = parseLoudnormStats(`${p3.stdout ?? ''}${p3.stderr ?? ''}`);

    const masterKey = masterKeyFor(s3Key, target);
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: masterKey, Body: readFileSync(outPath), ContentType: 'audio/wav' }));

    // Pass 4 — the web MP3, encoded FROM the mastered WAV and then measured.
    //
    // This is the file listeners receive, and nothing in the pipeline used to
    // measure it: the 2026-07-24 sweep found 2 of 17 served MP3s above the
    // -1 dBTP ceiling. Best-effort throughout — the WAV master is the primary
    // deliverable and a failed encode must never fail the job.
    let mp3Key: string | null = null;
    let mp3Lufs: number | null = null;
    let mp3Tp: number | null = null;
    try {
      const mp3 = ff(buildMp3Args(outPath, mp3Path));
      if (mp3.status === 0) {
        // Measured on the ENCODED file, not the WAV — a figure copied from the
        // master would describe a file nobody checked, which is the exact gap
        // this pass exists to close.
        const p4 = ff(['-hide_banner', '-nostats', '-i', mp3Path, '-af', `loudnorm=I=${target}:TP=-1:LRA=11:print_format=json`, '-f', 'null', '-']);
        const measured = parseLoudnormStats(`${p4.stdout ?? ''}${p4.stderr ?? ''}`);
        const key = mp3KeyFor(masterKey);
        await s3.send(new PutObjectCommand({
          Bucket: bucket, Key: key, Body: readFileSync(mp3Path), ContentType: 'audio/mpeg',
        }));
        // All three commit TOGETHER, and only once the object is stored. Setting
        // them before the PutObject left the peak of an MP3 that was never
        // written recorded on the job: mp3Key null (so nothing renders it) but
        // the numbers still there for any later consumer to believe.
        mp3Key = key;
        mp3Lufs = measured?.input_i ?? null;
        mp3Tp = measured?.input_tp ?? null;
      } else {
        console.error('[master-worker] mp3 encode failed; master is unaffected');
      }
    } catch (mp3Err) {
      console.error('[master-worker] mp3 export failed:', mp3Err instanceof Error ? mp3Err.message : String(mp3Err));
      mp3Key = null;
      mp3Lufs = null;
      mp3Tp = null;
    }
    await patch(jobId, {
      status: 'done',
      masterKey,
      beforeLufs: stats.input_i,
      beforeTp: stats.input_tp,
      afterLufs: after?.input_i ?? null,
      afterTp: after?.input_tp ?? null,
      // Both LRAs were already measured (pass 1 on the source, pass 3 on the
      // output) and previously discarded. Storing them makes the
      // dynamics-preserved claim checkable rather than asserted.
      beforeLra: stats.input_lra,
      afterLra: after?.input_lra ?? null,
      normalizationType,
      source,
      target,
      // What the admin asked for and what it produced. Stored together so the
      // report can state the edit without re-deriving it from the audio.
      edit: isNoOpEdit(edit) ? null : edit,
      // The seam, stored so the report and the Studio can state what was
      // assembled without re-deriving it from the audio.
      join: joinSpec,
      editedDurationSec: editedDuration,
      mp3Key,
      mp3Lufs,
      mp3Tp,
    });

    // Reference-matched mastering (Phase 1B). Fire-and-forget invoke of the
    // Python matchering-worker. The loudnorm master above already succeeded
    // (patched status=done); this is an ADDITIONAL output. Any failure here
    // is non-fatal to the parent job — it only affects the matched output
    // slot, which the Python worker patches independently via matchingStage.
    const wantsMatching =
      !!event?.referenceKey &&
      (event?.matchingMethod === 'matched' || event?.matchingMethod === 'both');
    if (wantsMatching) {
      const referenceKey = event.referenceKey!;
      const referenceId = event.referenceId ?? '';
      if (!isReferenceKey(referenceKey)) {
        // Bad reference key is a payload defect, not a runtime failure. Record
        // it against the matching slot so the UI can surface it without
        // affecting the loudnorm master's success.
        await patch(jobId, {
          matchingStage: 'failed',
          matchingError: {
            code: 'bad-reference-key',
            message: `referenceKey must live under audio/references/ (got: ${referenceKey})`,
          },
        }).catch(() => {});
      } else {
        const matchedKey = matchedMasterKeyFor(s3Key, referenceId);
        try {
          await lambdaClient.send(new InvokeCommand({
            FunctionName: MATCHERING_WORKER_FUNCTION,
            InvocationType: 'Event',
            Payload: Buffer.from(JSON.stringify({
              jobId,
              sourceKey: s3Key,
              referenceKey,
              outputKey: matchedKey,
              referenceId,
            })),
          }));
          // 'queued' — the Python worker will progress through downloading →
          // matching → uploading → completed on its own.
          await patch(jobId, { matchingStage: 'queued' }).catch(() => {});
        } catch (invokeErr) {
          console.error(
            '[master-worker] matchering-worker invoke failed:',
            invokeErr instanceof Error ? invokeErr.message : String(invokeErr),
          );
          await patch(jobId, {
            matchingStage: 'failed',
            matchingError: {
              code: 'invoke-failed',
              message: invokeErr instanceof Error ? invokeErr.message : String(invokeErr),
            },
          }).catch(() => {});
        }
      }
    }

    return { ok: true, masterKey };
  } catch (err) {
    console.error('[master-worker] failed:', err instanceof Error ? err.message : String(err));
    await patch(jobId, { status: 'error', error: { code: 'exception', message: err instanceof Error ? err.message : String(err) } }).catch(() => {});
    return { ok: false };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
