/**
 * The Video Text worker: three event kinds in the master-worker bundle.
 *
 *   - videoTextProbe  (RequestResponse, master-worker): read an uploaded
 *     source's header over a presigned URL and refuse what this tool cannot
 *     render faithfully.
 *   - videoTextRender (Event, master-worker): the coordinator. Segment the
 *     source on keyframes, fan one chunk encode out per segment, join the
 *     chunks by stream copy and lay the ORIGINAL audio under them, copied.
 *   - videoTextChunk  (RequestResponse, the chunk function — this same
 *     bundle): overlay the browser-drawn PNGs on one segment.
 *
 * The song must come out bit-identical AND at identical times. A packet hash
 * alone cannot see a shift (Matroska once moved the whole song 23 ms with an
 * equal hash), so every audio check compares both the sha256 streamhash and a
 * framecrc listing taken with -copyts: per packet dts, pts, duration, size,
 * crc and side data (the AAC priming skip), plus the stream time base. The
 * check runs source → extract before anything is cut, and source → output
 * before anything is uploaded; a mismatch saves nothing.
 *
 * No failure may be silent. Every coordinator path ends in a render patch,
 * the coordinator never throws (Event retries are 0: a throw would leave the
 * status stuck until the 20-minute stale window), and intermediates under the
 * render prefix are deleted in `finally`, keeping only the output.
 *
 * Shared pieces (ff, the clients, the deadline) are injected by
 * master-worker.ts so this module does not import it back.
 */

import { createReadStream, createWriteStream, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetCommand, UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { InvokeCommand, type LambdaClient } from '@aws-sdk/client-lambda';
import {
  SEGMENT_TARGET_SEC,
  CHUNK_CRF,
  CHUNK_PRESET,
  parseSegmentList,
  buildSegmentArgs,
  overlaysForSegment,
  buildChunkArgs,
  buildJoinMuxArgs,
  buildAudioHashArgs,
  audioExtractExtFor,
  buildAudioExtractArgs,
  type SegmentEntry,
} from '@/lib/video-text/render-plan';
import {
  VIDEO_TEXT_PREFIX,
  chunkOutKey,
  expiresAtFrom,
  isValidProjectId,
  isVideoTextKeyFor,
  outputKey,
  overlayKey,
  renderPrefix,
  segmentKey,
} from '@/lib/video-text/keys';
import type { RenderState, TextBlock } from '@/types/videoText';

export const VIDEO_TEXT_CHUNK_FUNCTION = process.env.VIDEO_TEXT_CHUNK_FUNCTION || 'tamilagaval-video-text-chunk';
/** Chunks in flight at once for one render. */
export const VIDEO_TEXT_CONCURRENCY = 20;
/** Kept back for the join, the audio checks and the upload of the output. */
const JOIN_RESERVE_MS = 120_000;
/** At most one progress patch per this interval; status changes are never throttled. */
const PROGRESS_EVERY_MS = 3_000;
/** A segment longer than this would not encode inside the chunk function's timeout (R8). */
const MAX_SEGMENT_SEC = 2.5 * SEGMENT_TARGET_SEC;
/** The largest frame accepted, either orientation. */
const MAX_LONG_SIDE = 3840;
const MAX_SHORT_SIDE = 2160;
/** How far the average frame rate may sit from tbr before the stream counts as variable. */
const VFR_TOLERANCE = 0.01;
const SCRATCH_PREFIX = 'vt-';

export const VFR_MESSAGE =
  'This video has a variable frame rate (typical of phone recordings). Export it at a constant frame rate and upload again.';
export const MISSING_PNG_MESSAGE = 'some text images did not upload — press Make video again';
export const AUDIO_CHANGED_MESSAGE = 'the audio changed during the render — nothing was saved';
export const FEW_KEYFRAMES_MESSAGE =
  'This video has too few keyframes to split — export it again with a keyframe at least every 10 seconds.';
export const OUT_OF_TIME_MESSAGE = 'the render ran out of time — try again; if it happens again, use a shorter video';
export const CHUNK_ONLY_MESSAGE = 'this function only renders video-text chunks';
const ROTATED_MESSAGE =
  'This video is stored rotated (typical of phone recordings), so it plays at a different size than it is stored. Export it upright and upload again.';
const UNREADABLE_MESSAGE = 'This file could not be read as a video. Export it as an MP4 or MOV and upload again.';
const PROBE_FAILED_MESSAGE = 'the video could not be read — try again';
const RENDER_FAILED_MESSAGE = 'the render failed — try again';
const CHUNK_FAILED_MESSAGE = 'the text could not be drawn onto this part';

type FfResult = { status: number | null; stdout?: string | null; stderr?: string | null };

export interface VideoTextDeps {
  s3: S3Client;
  ddb: DynamoDBDocumentClient;
  lambda: LambdaClient;
  /** The master-worker's ff(): bounded by the invocation deadline, throws FfmpegOutOfTime. */
  ff: (args: string[]) => FfResult;
  bucket: string | undefined;
  table: string;
  /** When this invocation is killed (Date.now() ms); Infinity without a Lambda clock. */
  deadline: () => number;
}

/** A failure whose message is for the operator, written as-is. */
class VideoTextFailure extends Error {}

const isOutOfTime = (err: unknown) => (err as { name?: string })?.name === 'FfmpegOutOfTime';
const logOf = (r: FfResult) => `${r.stdout ?? ''}${r.stderr ?? ''}`;

/**
 * Remove scratch left by an earlier invocation in this container: a Lambda
 * killed mid-render never reaches its `finally`, and /tmp outlives it. One
 * invocation runs per container at a time, so nothing live is swept.
 */
function sweepScratch(): void {
  const root = tmpdir();
  try {
    for (const name of readdirSync(root)) {
      if (name.startsWith(SCRATCH_PREFIX)) rmSync(join(root, name), { recursive: true, force: true });
    }
  } catch (err) {
    console.error('[video-text] scratch sweep failed:', err instanceof Error ? err.message : String(err));
  }
}

// ------------------------------------------------------------------ parsing

export interface VideoStreamInfo {
  codec: string;
  width: number;
  height: number;
  /** Average frame rate (`fps`), null when ffmpeg printed none. */
  fps: number | null;
  tbr: number | null;
  rotated: boolean;
}

const rate = (m: RegExpMatchArray | null): number | null => {
  if (!m) return null;
  const n = Number(m[1]) * (m[2] ? 1000 : 1);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * The first real video stream of an `ffmpeg -i` header (cover art marked
 * `attached pic` is skipped). The layer may have no ffprobe, so this reads
 * the same log parseSourceInfo does, for the video side it does not cover.
 */
export function parseVideoStream(log: string): VideoStreamInfo | null {
  const lines = log.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/Stream #\d+:\d+[^:]*: Video:\s*([a-z0-9_]+)(.*)$/i);
    if (!m || /attached pic/i.test(m[2])) continue;
    const rest = m[2];
    const size = rest.match(/,\s*(\d{2,5})x(\d{2,5})(?=[\s,]|$)/);
    if (!size) return null;
    // The stream's own block runs until the next Stream line.
    let block = '';
    for (let k = i + 1; k < lines.length && !/^\s*Stream #/.test(lines[k]); k++) block += `${lines[k]}\n`;
    const rotation = block.match(/rotation of (-?[\d.]+) degrees/i) ?? block.match(/^\s*rotate\s*:\s*(-?[\d.]+)/im);
    return {
      codec: m[1].toLowerCase(),
      width: Number(size[1]),
      height: Number(size[2]),
      fps: rate(rest.match(/([\d.]+)(k?)\s*fps\b/)),
      tbr: rate(rest.match(/([\d.]+)(k?)\s*tbr\b/)),
      rotated: !!rotation && Math.abs(Number(rotation[1])) % 360 !== 0,
    };
  }
  return null;
}

const hasAudioStream = (log: string) => /Stream #\d+:\d+[^:]*: Audio:/i.test(log);

/** `Duration: HH:MM:SS.frac` at full precision (parseSourceInfo rounds to 0.1 s, which can round past the end). */
export function parseDurationSec(log: string): number | null {
  const d = log.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!d) return null;
  const sec = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]);
  return Number.isFinite(sec) && sec > 0 ? sec : null;
}

/** R4: floored to 0.01 s so a stored length never rounds past the real end. */
const floorCentis = (sec: number) => Math.floor(sec * 100 + 1e-6) / 100;

/**
 * The first presentation time, in seconds, of a framecrc listing taken with
 * -copyts: the smallest pts among its packets, scaled by its `#tb` line.
 */
export function firstPtsSec(framecrc: string): number | null {
  const tb = framecrc.match(/^#tb 0:\s*(\d+)\/(\d+)/m);
  if (!tb) return null;
  let min = Number.POSITIVE_INFINITY;
  for (const line of framecrc.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const pts = Number(line.split(',')[2]);
    if (Number.isFinite(pts)) min = Math.min(min, pts);
  }
  return Number.isFinite(min) ? (min * Number(tb[1])) / Number(tb[2]) : null;
}

/** ffmpeg args: per-packet timing of the first audio stream, timestamps untouched. No decode. */
export function buildAudioTimingArgs(path: string): string[] {
  return ['-hide_banner', '-nostats', '-copyts', '-i', path, '-map', '0:a:0', '-c', 'copy', '-f', 'framecrc', '-'];
}

/** ffmpeg args: the first video packets with their raw timestamps, enough to see B-frame reordering. */
function buildVideoStartArgs(path: string): string[] {
  return ['-hide_banner', '-nostats', '-copyts', '-i', path, '-map', '0:v:0', '-c', 'copy', '-frames:v', '64', '-f', 'framecrc', '-'];
}

/** A framecrc listing minus the line naming the muxer's version, which is not the stream. */
const normaliseTiming = (framecrc: string) =>
  framecrc.split(/\r?\n/).filter((l) => l && !l.startsWith('#software')).join('\n');

interface AudioFingerprint {
  hash: string;
  timing: string;
}

/** The packets' sha256 and their exact times. Throws when either cannot be read: unreadable is not equal. */
function audioFingerprint(deps: VideoTextDeps, path: string): AudioFingerprint {
  const h = deps.ff(buildAudioHashArgs(path));
  const hash = (h.stdout ?? '').trim();
  const t = deps.ff(buildAudioTimingArgs(path));
  const timing = normaliseTiming(t.stdout ?? '');
  if (h.status !== 0 || !/SHA256=[0-9a-f]+/i.test(hash) || t.status !== 0 || !/^#tb /m.test(timing) || !/^\d+,/m.test(timing)) {
    console.error('[video-text] audio fingerprint unreadable for', path);
    throw new VideoTextFailure(AUDIO_CHANGED_MESSAGE);
  }
  return { hash, timing };
}

function assertSameAudio(expected: AudioFingerprint, actual: AudioFingerprint, what: string): void {
  if (expected.hash !== actual.hash || expected.timing !== actual.timing) {
    console.error(`[video-text] audio mismatch (${what}): hash ${expected.hash === actual.hash ? 'equal' : 'differs'}, timing ${expected.timing === actual.timing ? 'equal' : 'differs'}`);
    throw new VideoTextFailure(AUDIO_CHANGED_MESSAGE);
  }
}

// ------------------------------------------------------------------ S3 helpers

/** Streamed to disk: a 1 GB source held in memory (twice, with Buffer.from) would kill the Lambda silently. */
async function downloadTo(deps: VideoTextDeps, key: string, path: string): Promise<void> {
  const obj = await deps.s3.send(new GetObjectCommand({ Bucket: deps.bucket, Key: key }));
  if (!obj.Body) throw new Error(`empty object ${key}`);
  await pipeline(obj.Body as Readable, createWriteStream(path));
}

async function uploadFrom(deps: VideoTextDeps, key: string, path: string): Promise<void> {
  await deps.s3.send(new PutObjectCommand({
    Bucket: deps.bucket,
    Key: key,
    Body: createReadStream(path),
    ContentLength: statSync(path).size,
    ContentType: 'video/mp4',
  }));
}

/** Delete everything a render wrote except its output. Never throws: the lifecycle rule is the backstop. */
async function deleteIntermediates(deps: VideoTextDeps, projectId: string, renderId: string): Promise<void> {
  const prefix = renderPrefix(projectId, renderId);
  const keep = outputKey(projectId, renderId);
  try {
    let token: string | undefined;
    do {
      const page = await deps.s3.send(new ListObjectsV2Command({ Bucket: deps.bucket, Prefix: prefix, ContinuationToken: token }));
      const keys = (page.Contents ?? []).map((o) => o.Key).filter((k): k is string => !!k && k !== keep);
      if (keys.length > 0) {
        await deps.s3.send(new DeleteObjectsCommand({
          Bucket: deps.bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
        }));
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  } catch (err) {
    console.error('[video-text] could not delete the intermediates:', err instanceof Error ? err.message : String(err));
  }
}

// ------------------------------------------------------------------ DynamoDB

const projectKey = (id: string) => ({ PK: `VIDEOTEXT#${id}`, SK: 'METADATA' });

/**
 * VideoTextRepository.patchRender, under the same conditions: only while the
 * project's render is still THIS render, always stamping render.updatedAt so
 * the stale check sees a live render as live; a lost condition is not an
 * error. Written here because the repository's client module is not part of
 * this bundle.
 */
async function patchRender(deps: VideoTextDeps, projectId: string, renderId: string, fields: Partial<RenderState>): Promise<void> {
  const names: Record<string, string> = { '#render': 'render', '#renderId': 'renderId', '#updatedAt': 'updatedAt' };
  const values: Record<string, unknown> = { ':renderId': renderId, ':patchedAt': new Date().toISOString() };
  const sets: string[] = [];
  let i = 0;
  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined || field === 'renderId' || field === 'updatedAt') continue;
    names[`#${field}`] = field;
    values[`:v${i}`] = value;
    sets.push(`#render.#${field} = :v${i}`);
    i++;
  }
  sets.push('#render.#updatedAt = :patchedAt');
  try {
    await deps.ddb.send(new UpdateCommand({
      TableName: deps.table,
      Key: projectKey(projectId),
      UpdateExpression: `SET ${sets.join(', ')}`,
      ConditionExpression: '#render.#renderId = :renderId',
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }));
  } catch (err) {
    if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') return;
    throw err;
  }
}

// ------------------------------------------------------------------ probe

type ProbeInfo = { width: number; height: number; fps: number; durationSec: number; hasAudio: boolean };

/** Why a header cannot be rendered here, or null. Shared by the probe and the render's re-read. */
function refusalFor(video: VideoStreamInfo | null): string | null {
  if (!video) return UNREADABLE_MESSAGE;
  if (video.codec !== 'h264' && video.codec !== 'hevc') {
    return `This video is encoded as ${video.codec}. Export it as H.264 or HEVC and upload again.`;
  }
  if (Math.max(video.width, video.height) > MAX_LONG_SIDE || Math.min(video.width, video.height) > MAX_SHORT_SIDE) {
    return `This video is ${video.width}×${video.height}, larger than 3840×2160. Export it at 4K or smaller and upload again.`;
  }
  if (video.rotated) return ROTATED_MESSAGE;
  if (video.fps === null || video.tbr === null || Math.abs(video.fps - video.tbr) > VFR_TOLERANCE * video.tbr) return VFR_MESSAGE;
  return null;
}

export async function probeVideoText(
  spec: { key?: unknown },
  deps: VideoTextDeps,
): Promise<{ ok: true; info: ProbeInfo } | { ok: false; message: string }> {
  sweepScratch();
  const key = spec?.key;
  if (typeof key !== 'string' || !key.startsWith(VIDEO_TEXT_PREFIX) || key.includes('..') || key.length > 1024) {
    return { ok: false, message: 'that key is not in the video text workspace' };
  }
  if (!deps.bucket) return { ok: false, message: 'TAKES_BUCKET is required' };
  try {
    // Header only, over HTTP: ffmpeg reads the moov and stops; nothing is downloaded to /tmp.
    const url = await getSignedUrl(deps.s3, new GetObjectCommand({ Bucket: deps.bucket, Key: key }), { expiresIn: 300 });
    // The log echoes the signed URL: it is parsed, never returned or logged.
    const log = logOf(deps.ff(['-hide_banner', '-i', url]));
    if (!/^Input #0/m.test(log)) {
      // ffmpeg never opened it: an expired/forbidden URL or the network, not the file.
      // Logged with every query string cut, so no signature reaches the logs.
      console.error('[video-text] probe could not open the source:', log.replace(/\?[^\s'"]*/g, '?…').slice(-500));
      return { ok: false, message: PROBE_FAILED_MESSAGE };
    }
    const video = parseVideoStream(log);
    const refusal = refusalFor(video);
    if (refusal) return { ok: false, message: refusal };
    const durationSec = parseDurationSec(log);
    if (durationSec === null) return { ok: false, message: 'The length of this video could not be read. Export it again and upload again.' };
    return {
      ok: true,
      info: { width: video!.width, height: video!.height, fps: video!.fps!, durationSec: floorCentis(durationSec), hasAudio: hasAudioStream(log) },
    };
  } catch (err) {
    if (isOutOfTime(err)) return { ok: false, message: 'reading the video took too long — try again' };
    console.error('[video-text] probe failed:', err instanceof Error ? err.name : 'unknown');
    return { ok: false, message: PROBE_FAILED_MESSAGE };
  }
}

// ------------------------------------------------------------------ chunk

interface ChunkSpec {
  projectId: string;
  renderId: string;
  index: number;
  segKey: string;
  overlays: { id: string; fromSec: number; toSec: number }[];
  width: number;
  height: number;
}

function readChunkSpec(raw: unknown): ChunkSpec | null {
  const s = raw as Partial<ChunkSpec> | null;
  if (!s || !isValidProjectId(s.projectId as string) || !isValidProjectId(s.renderId as string)) return null;
  if (!Number.isInteger(s.index) || (s.index as number) < 0) return null;
  if (!Number.isInteger(s.width) || !Number.isInteger(s.height) || (s.width as number) <= 0 || (s.height as number) <= 0) return null;
  if (!Array.isArray(s.overlays)) return null;
  for (const o of s.overlays) {
    if (!o || !isValidProjectId(o.id) || !Number.isFinite(o.fromSec) || !Number.isFinite(o.toSec) || !(o.toSec > o.fromSec)) return null;
  }
  // Keys are re-derived, never taken from the event; the one it carries must agree.
  if (s.segKey !== segmentKey(s.projectId as string, s.renderId as string, s.index as number)) return null;
  return s as ChunkSpec;
}

export async function renderVideoTextChunk(
  raw: unknown,
  deps: VideoTextDeps,
): Promise<{ ok: true; key: string } | { ok: false; message: string }> {
  sweepScratch();
  const spec = readChunkSpec(raw);
  if (!spec) return { ok: false, message: 'that is not a chunk of a video text render' };
  if (!deps.bucket) return { ok: false, message: 'TAKES_BUCKET is required' };
  const { projectId, renderId, index } = spec;
  const dir = mkdtempSync(join(tmpdir(), SCRATCH_PREFIX));
  try {
    const segPath = join(dir, 'segment.mp4');
    await downloadTo(deps, segmentKey(projectId, renderId, index), segPath);
    const overlays = [];
    for (const o of spec.overlays) {
      const path = join(dir, `overlay-${o.id}.png`);
      await downloadTo(deps, overlayKey(projectId, renderId, o.id), path);
      overlays.push({ path, fromSec: o.fromSec, toSec: o.toSec });
    }
    const outPath = join(dir, 'chunk.mp4');
    const r = deps.ff(buildChunkArgs({ segPath, overlays, width: spec.width, height: spec.height, outPath, crf: CHUNK_CRF, preset: CHUNK_PRESET }));
    if (r.status !== 0) {
      console.error(`[video-text] chunk ${index} encode failed:`, (r.stderr ?? '').slice(-2000));
      return { ok: false, message: CHUNK_FAILED_MESSAGE };
    }
    const key = chunkOutKey(projectId, renderId, index);
    await uploadFrom(deps, key, outPath);
    return { ok: true, key };
  } catch (err) {
    if (isOutOfTime(err)) return { ok: false, message: 'it ran out of time' };
    console.error(`[video-text] chunk ${index} failed:`, err instanceof Error ? err.message : String(err));
    return { ok: false, message: CHUNK_FAILED_MESSAGE };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ render

/**
 * The segment list in the blocks' timeline (R8). With -avoid_negative_ts
 * disabled the csv carries the source's own presentation times, so a video
 * stream that starts at v0 > 0 lists every later cut v0 late — while the
 * first segment is listed from 0 (measured on 6.1.1: a 0.5 s-delayed stream
 * gave `0,20.5` then `20.5,40.5`). Subtracting v0 and clamping at 0 handles
 * both. Then refuse a segment the chunk function could not encode in time.
 */
export function planSegments(entries: SegmentEntry[], videoStartSec: number): SegmentEntry[] {
  const shifted = entries.map((e) => ({
    file: e.file,
    startSec: Math.max(0, e.startSec - videoStartSec),
    endSec: Math.max(0, e.endSec - videoStartSec),
  }));
  if (shifted.length === 0) throw new VideoTextFailure(RENDER_FAILED_MESSAGE);
  if (shifted.some((e) => e.endSec - e.startSec > MAX_SEGMENT_SEC)) throw new VideoTextFailure(FEW_KEYFRAMES_MESSAGE);
  return shifted;
}

type ChunkOutcome = { ok: true } | { ok: false; message: string };

/** One chunk, synchronously. A throttle is waited out with jitter while the join reserve allows. */
async function invokeChunk(deps: VideoTextDeps, spec: ChunkSpec, abort: AbortSignal): Promise<ChunkOutcome> {
  const expected = chunkOutKey(spec.projectId, spec.renderId, spec.index);
  for (;;) {
    const budget = deps.deadline() - JOIN_RESERVE_MS - Date.now();
    if (budget <= 0) throw new VideoTextFailure(OUT_OF_TIME_MESSAGE);
    try {
      const res = await deps.lambda.send(
        new InvokeCommand({
          FunctionName: VIDEO_TEXT_CHUNK_FUNCTION,
          InvocationType: 'RequestResponse',
          Payload: Buffer.from(JSON.stringify({ videoTextChunk: spec })),
        }),
        // Never an infinite wait: the time left before the join, or the chunk function's own 300 s.
        { abortSignal: AbortSignal.any([abort, AbortSignal.timeout(Number.isFinite(budget) ? budget : 300_000)]) },
      );
      const text = Buffer.from(res.Payload ?? new Uint8Array()).toString();
      if (res.FunctionError) {
        console.error(`[video-text] chunk ${spec.index} function error:`, text.slice(0, 500));
        return { ok: false, message: 'the chunk function failed' };
      }
      const out = JSON.parse(text || '{}') as { ok?: unknown; key?: unknown; message?: unknown };
      if (out.ok === true && out.key === expected) return { ok: true };
      return { ok: false, message: out.ok === false && typeof out.message === 'string' ? out.message : 'the chunk function gave no usable answer' };
    } catch (err) {
      if (err instanceof VideoTextFailure) throw err;
      const name = (err as { name?: string })?.name;
      if (abort.aborted) return { ok: false, message: 'stopped' };
      if (name === 'TimeoutError' || name === 'AbortError') throw new VideoTextFailure(OUT_OF_TIME_MESSAGE);
      if (name === 'ResourceNotFoundException') {
        throw new VideoTextFailure('the video text renderer is not set up yet (the chunk function is missing)');
      }
      if (name === 'TooManyRequestsException') {
        // Jittered, so lanes (and two renders) do not retry in step.
        const wait = 2_000 + Math.floor(Math.random() * 8_000);
        if (Date.now() + wait + JOIN_RESERVE_MS > deps.deadline()) throw new VideoTextFailure(OUT_OF_TIME_MESSAGE);
        await new Promise((r) => setTimeout(r, wait));
        if (abort.aborted) return { ok: false, message: 'stopped' };
        continue;
      }
      console.error(`[video-text] chunk ${spec.index} invoke failed:`, err instanceof Error ? err.message : String(err));
      return { ok: false, message: 'the chunk function could not be reached' };
    }
  }
}

/** All chunks, VIDEO_TEXT_CONCURRENCY at a time. The first failure stops new work and aborts the waits. */
async function encodeChunks(
  deps: VideoTextDeps,
  specs: ChunkSpec[],
  onProgress: (done: number) => Promise<void>,
): Promise<void> {
  const abort = new AbortController();
  let failure: Error | null = null;
  let next = 0;
  let done = 0;
  const lane = async () => {
    while (failure === null && next < specs.length) {
      const spec = specs[next++];
      try {
        const r = await invokeChunk(deps, spec, abort.signal);
        if (failure !== null) return;
        if (!r.ok) {
          failure = new VideoTextFailure(`part ${spec.index + 1} of the video could not be rendered: ${r.message}`);
          abort.abort();
          return;
        }
        done++;
        await onProgress(done);
      } catch (err) {
        failure ??= err instanceof Error ? err : new Error(String(err));
        abort.abort();
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(VIDEO_TEXT_CONCURRENCY, specs.length) }, lane));
  if (failure) throw failure;
}

function assertTimeForJoin(deps: VideoTextDeps): void {
  if (Date.now() + JOIN_RESERVE_MS > deps.deadline()) throw new VideoTextFailure(OUT_OF_TIME_MESSAGE);
}

interface StoredProject {
  blocks?: TextBlock[];
  source?: { key?: string; width?: number; height?: number } | null;
  render?: { renderId?: string | null };
}

export async function renderVideoText(
  spec: { projectId?: unknown; renderId?: unknown },
  deps: VideoTextDeps,
): Promise<{ ok: boolean; message?: string }> {
  sweepScratch();
  const projectId = spec?.projectId;
  const renderId = spec?.renderId;
  if (typeof projectId !== 'string' || typeof renderId !== 'string' || !isValidProjectId(projectId) || !isValidProjectId(renderId)) {
    // Nothing can be patched without valid ids; the route never sends these.
    console.error('[video-text] bad render event');
    return { ok: false, message: 'projectId and renderId are required' };
  }
  const patch = (fields: Partial<RenderState>) => patchRender(deps, projectId, renderId, fields);
  let dir: string | null = null;
  let current = true;
  try {
    if (!deps.bucket) throw new VideoTextFailure('the worker is not configured (TAKES_BUCKET is missing)');
    const got = await deps.ddb.send(new GetCommand({ TableName: deps.table, Key: projectKey(projectId) }));
    const project = got.Item as StoredProject | undefined;
    if (!project) {
      console.error('[video-text] render for a missing project', projectId);
      current = false;
      return { ok: false, message: 'project not found' };
    }
    if (project.render?.renderId !== renderId) {
      // A newer render owns the slot; every patch would be refused anyway.
      current = false;
      return { ok: false, message: 'this render is no longer the current one' };
    }
    const source = project.source;
    const blocks = Array.isArray(project.blocks) ? project.blocks : [];
    if (!source?.key || !isVideoTextKeyFor(projectId, source.key) || !source.width || !source.height) {
      throw new VideoTextFailure('this project has no video to render — upload one first');
    }

    // ---- segmenting
    await patch({ status: 'segmenting', progress: null, error: null });
    // R1: the route cannot know the browser's PNG uploads finished; check every one before any work.
    for (const b of blocks) {
      try {
        await deps.s3.send(new HeadObjectCommand({ Bucket: deps.bucket, Key: overlayKey(projectId, renderId, b.id) }));
      } catch {
        throw new VideoTextFailure(MISSING_PNG_MESSAGE);
      }
    }

    dir = mkdtempSync(join(tmpdir(), SCRATCH_PREFIX));
    const ext = /\.mov$/i.test(source.key) ? '.mov' : '.mp4';
    const srcPath = join(dir, `source${ext}`);
    await downloadTo(deps, source.key, srcPath);

    const headerLog = logOf(deps.ff(['-hide_banner', '-i', srcPath]));
    const video = parseVideoStream(headerLog);
    const refusal = refusalFor(video);
    if (refusal) throw new VideoTextFailure(refusal);
    if (video!.width !== source.width || video!.height !== source.height) {
      // The PNGs were drawn at the stored size; on another frame they would land wrong.
      throw new VideoTextFailure('the video no longer matches this project — upload it again');
    }
    const hasAudio = hasAudioStream(headerLog);

    // The audio leaves first, untouched, so the big source can go before the chunks come back (R3).
    let sourceAudio: AudioFingerprint | null = null;
    const audioPath = join(dir, `audio${audioExtractExtFor(srcPath)}`);
    if (hasAudio) {
      if (deps.ff(buildAudioExtractArgs(srcPath, audioPath)).status !== 0) throw new VideoTextFailure(AUDIO_CHANGED_MESSAGE);
      sourceAudio = audioFingerprint(deps, srcPath);
      assertSameAudio(sourceAudio, audioFingerprint(deps, audioPath), 'extract');
    }

    const videoStart = firstPtsSec(deps.ff(buildVideoStartArgs(srcPath)).stdout ?? '');
    if (videoStart === null) throw new VideoTextFailure(UNREADABLE_MESSAGE);

    const listPath = join(dir, 'segments.csv');
    const seg = deps.ff(buildSegmentArgs(srcPath, join(dir, 'segment-%04d.mp4'), listPath, SEGMENT_TARGET_SEC));
    if (seg.status !== 0) {
      console.error('[video-text] segmenting failed:', (seg.stderr ?? '').slice(-2000));
      throw new VideoTextFailure('the video could not be split into parts');
    }
    const segments = planSegments(parseSegmentList(readFileSync(listPath, 'utf8')), videoStart);
    rmSync(srcPath, { force: true });
    for (let i = 0; i < segments.length; i++) {
      const local = join(dir, segments[i].file);
      await uploadFrom(deps, segmentKey(projectId, renderId, i), local);
      rmSync(local, { force: true });
    }

    // ---- encoding
    const total = segments.length;
    await patch({ status: 'encoding', progress: { done: 0, total } });
    const specs: ChunkSpec[] = segments.map((s, index) => ({
      projectId, renderId, index,
      segKey: segmentKey(projectId, renderId, index),
      overlays: overlaysForSegment(blocks, s),
      width: video!.width, height: video!.height,
    }));
    let lastProgressAt = Date.now();
    await encodeChunks(deps, specs, async (done) => {
      if (Date.now() - lastProgressAt < PROGRESS_EVERY_MS) return;
      lastProgressAt = Date.now();
      await patch({ progress: { done, total } });
    });

    // ---- joining
    assertTimeForJoin(deps);
    await patch({ status: 'joining', progress: { done: total, total } });
    const chunkPaths: string[] = [];
    for (let i = 0; i < total; i++) {
      const p = join(dir, `chunk-${String(i).padStart(4, '0')}.mp4`);
      await downloadTo(deps, chunkOutKey(projectId, renderId, i), p);
      chunkPaths.push(p);
    }
    const concatListPath = join(dir, 'chunks.txt');
    writeFileSync(concatListPath, chunkPaths.map((p) => `file '${p}'`).join('\n') + '\n');
    const outPath = join(dir, 'output.mp4');
    const joined = deps.ff(buildJoinMuxArgs({ concatListPath, srcPath: audioPath, outPath, hasAudio }));
    if (joined.status !== 0) {
      console.error('[video-text] join failed:', (joined.stderr ?? '').slice(-2000));
      throw new VideoTextFailure('the parts could not be joined');
    }
    // Checked on the local file, before anything is uploaded: a mismatch saves nothing.
    if (sourceAudio) assertSameAudio(sourceAudio, audioFingerprint(deps, outPath), 'output');

    const outKey = outputKey(projectId, renderId);
    await uploadFrom(deps, outKey, outPath);
    await patch({ status: 'done', outputKey: outKey, outputExpiresAt: expiresAtFrom(new Date().toISOString()), error: null });
    return { ok: true };
  } catch (err) {
    let message = RENDER_FAILED_MESSAGE;
    if (err instanceof VideoTextFailure) message = err.message;
    else if (isOutOfTime(err)) message = OUT_OF_TIME_MESSAGE;
    else console.error('[video-text] render failed:', err instanceof Error ? err.message : String(err));
    if (current) {
      try {
        await patch({ status: 'error', error: message });
      } catch (patchErr) {
        console.error('[video-text] could not write the render error:', patchErr instanceof Error ? patchErr.message : String(patchErr));
      }
    }
    return { ok: false, message };
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
    if (current) await deleteIntermediates(deps, projectId, renderId);
  }
}
