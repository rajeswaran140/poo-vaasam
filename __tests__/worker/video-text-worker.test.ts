/** @jest-environment node */
/**
 * The Video Text worker: probe, render coordinator and chunk renderer.
 *
 * The properties pinned here are the ones whose failure would be SILENT: the
 * song's audio changing (hash or timing), a render that dies without writing
 * an error, an intermediate left behind, a stale render's patch landing on a
 * newer one. Everything is driven through the real `handler`, so the wiring in
 * master-worker.ts is covered too. ffmpeg is faked: it writes the files the
 * real one would, so the coordinator's own file handling runs for real.
 */

import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { Readable } from 'node:stream';

const ddbSend = jest.fn();
const s3Send = jest.fn();
const lambdaSend = jest.fn();
const spawnSync = jest.fn();
const getSignedUrl = jest.fn();

// The worker's scratch root. jest gives the test its own process.env, so
// TMPDIR would not reach os.tmpdir(); the root is mocked instead, and is not
// itself named vt-* (the worker sweeps those).
const mockTmpRoot = mkdtempSync(join(jest.requireActual<typeof import('node:os')>('node:os').tmpdir(), 'video-text-worker-test-'));
jest.mock('node:os', () => ({ ...jest.requireActual('node:os'), tmpdir: () => mockTmpRoot }));
jest.mock('node:child_process', () => ({ spawnSync: (...a: unknown[]) => spawnSync(...a) }));
// Free disk space: real by default; a test can pretend the disk is nearly full.
const mockStatfs = jest.fn();
jest.mock('node:fs', () => {
  const actual = jest.requireActual('node:fs');
  return { ...actual, statfsSync: (...a: unknown[]) => mockStatfs(...a) ?? actual.statfsSync(...a) };
});
jest.mock('@aws-sdk/client-s3', () => {
  const cmd = (kind: string) => class { kind = kind; constructor(public input: Record<string, unknown>) {} };
  return {
    S3Client: class { send = (...a: unknown[]) => s3Send(...a); },
    GetObjectCommand: cmd('get'),
    PutObjectCommand: cmd('put'),
    HeadObjectCommand: cmd('head'),
    ListObjectsV2Command: cmd('list'),
    DeleteObjectsCommand: cmd('delete'),
  };
});
jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: (...a: unknown[]) => getSignedUrl(...a) }));
jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: class { send = (...a: unknown[]) => lambdaSend(...a); },
  InvokeCommand: class { constructor(public input: Record<string, unknown>) {} },
}));
jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: class {} }));
jest.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: class { send = jest.fn(); },
  GetParameterCommand: class { constructor(public input: unknown) {} },
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: (...a: unknown[]) => ddbSend(...a) }) },
  UpdateCommand: class { kind = 'update'; constructor(public input: Record<string, unknown>) {} },
  GetCommand: class { kind = 'get'; constructor(public input: Record<string, unknown>) {} },
}));

process.env.TAKES_BUCKET = 'tamil-web-media';
const TMP_ROOT = mockTmpRoot;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { handler } = require('../../worker/master-worker') as typeof import('../../worker/master-worker');
import { chunkOutKey, outputKey, overlayKey, renderPrefix, segmentKey } from '@/lib/video-text/keys';

afterAll(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

const PID = 'proj-1';
const RID = 'render-1';
const SRC_KEY = `audio/mastering/video-text/${PID}/source/1_abc_song.mp4`;

const VFR_MESSAGE =
  'This video has a variable frame rate (typical of phone recordings). Export it at a constant frame rate and upload again.';
const AUDIO_CHANGED = 'the audio changed during the render — nothing was saved';
const MISSING_PNG = 'some text images did not upload — press Make video again';
const OUT_OF_TIME = 'the render ran out of time — try again; if it happens again, use a shorter video';
const START_OFFSET = "This video's picture does not start at 0:00 — export it again from your editor and upload it.";
const HDR = 'This video is HDR — export it as SDR (Rec. 709) and upload it again.';

// ---------------------------------------------------------------- ffmpeg logs

const header = (o: { video?: string; audio?: boolean; duration?: string; extra?: string } = {}) => `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'x':
  Metadata:
    major_brand     : isom
  Duration: ${o.duration ?? '00:00:45.00'}, start: 0.000000, bitrate: 928 kb/s
  Stream #0:0[0x1](und): Video: ${o.video ?? 'h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1920x1080 [SAR 1:1 DAR 16:9], 726 kb/s, 25 fps, 25 tbr, 12800 tbn (default)'}
${o.extra ?? ''}${o.audio === false ? '' : '  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 196 kb/s (default)\n'}At least one output file must be specified
`;

const videoPackets = (firstPts: number) => `#tb 0: 1/12800
#media_type 0: video
#codec_id 0: h264
#dimensions 0: 1920x1080
0,      ${firstPts - 1024},      ${firstPts},      512,   269934, 0xd0efe6fc
0,      ${firstPts - 512},      ${firstPts + 2048},      512,    19657, 0x81af67cc, F=0x0
0,      ${firstPts},      ${firstPts + 1024},      512,     1463, 0xab44e90d, F=0x0
`;

const AUDIO_TIMING = `#extradata 0:        5, 0x056101dc
#software: Lavf61.1.100
#tb 0: 1/48000
#media_type 0: audio
#codec_id 0: aac
0,      -1024,      -1024,     1024,      398, 0x1d2ebe69, F=0x5, S=1,       10
0,          0,          0,     1024,      408, 0xdf14c6e3
0,       1024,       1024,     1024,      370, 0x1885b23c
`;
const AUDIO_HASH = '0,a,SHA256=aaaa\n';

// ---------------------------------------------------------------- fake world

interface World {
  project: Record<string, unknown> | null;
  store: Map<string, Buffer>;
  csv: string;
  videoFirstPts: number;
  hasAudio: boolean;
  /** Per-file overrides, matched on the file's basename. */
  hashFor: (file: string) => string;
  timingFor: (file: string) => string;
  chunkReply: (event: { index: number; overlays: unknown[] }) => unknown;
  ffArgs: string[][];
  invoked: Array<{ index: number; overlays: { id: string; fromSec: number; toSec: number }[]; [k: string]: unknown }>;
}

let world: World;

/** Added to Date.now(): lets a fake step "take" time without waiting for it. */
let clockSkew = 0;
const realNow = Date.now.bind(Date);
const timeout = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
/** Per-key S3 behaviour for a test: receives the call's abortSignal. */
let s3Override: ((cmd: { kind: string; input: Record<string, unknown> }, signal: AbortSignal | undefined) => Promise<unknown> | undefined) | null = null;

const BLOCKS = [
  { id: 'title', track: 'title', text: 'Title', startSec: 0, endSec: 5 },
  { id: 'l1', track: 'lyric', text: 'line', startSec: 18, endSec: 22 },
  { id: 'cred', track: 'credits', text: 'credits', startSec: 35, endSec: 45 },
];

const projectFor = (o: Partial<{ hasAudio: boolean; renderId: string }> = {}) => ({
  PK: `VIDEOTEXT#${PID}`,
  SK: 'METADATA',
  id: PID,
  blocks: BLOCKS,
  source: { key: SRC_KEY, width: 1920, height: 1080, fps: 25, durationSec: 45, hasAudio: o.hasAudio ?? true, uploadedAt: 'x', expiresAt: 'y' },
  render: { renderId: o.renderId ?? RID, status: 'queued' },
});

const outPathOf = (args: string[]) => args[args.length - 1];

function fakeFfmpeg(_bin: string, args: string[]) {
  world.ffArgs.push(args);
  const j = args.join(' ');
  const input = args[args.indexOf('-i') + 1];
  if (j.includes('-f framecrc') && j.includes('0:v:0')) return { status: 0, stdout: videoPackets(world.videoFirstPts), stderr: '' };
  if (j.includes('-f framecrc')) return { status: 0, stdout: world.timingFor(basename(input)), stderr: '' };
  if (j.includes('-f streamhash')) return { status: 0, stdout: world.hashFor(basename(input)), stderr: '' };
  if (j.includes('-f segment')) {
    const listPath = args[args.indexOf('-segment_list') + 1];
    const dir = listPath.slice(0, listPath.lastIndexOf('/'));
    writeFileSync(listPath, world.csv);
    for (const line of world.csv.trim().split('\n')) writeFileSync(join(dir, line.split(',')[0]), 'SEGMENT');
    return { status: 0, stdout: '', stderr: '' };
  }
  if (j.includes('-f concat')) {
    writeFileSync(outPathOf(args), 'JOINED');
    return { status: 0, stdout: '', stderr: '' };
  }
  if (j.includes('-map 0:a:0 -c copy -f')) {
    writeFileSync(outPathOf(args), 'AUDIO');
    return { status: 0, stdout: '', stderr: '' };
  }
  if (j.includes('-preset')) {
    writeFileSync(outPathOf(args), 'CHUNK');
    return { status: 0, stdout: '', stderr: '' };
  }
  // A header read: `ffmpeg -i FILE` with no output.
  return { status: 1, stdout: '', stderr: header({ audio: world.hasAudio }) };
}

const notFound = () => Object.assign(new Error('NotFound'), { name: 'NotFound' });

async function fakeS3(cmd: { kind: string; input: Record<string, unknown> }, opts?: { abortSignal?: AbortSignal }) {
  const overridden = s3Override?.(cmd, opts?.abortSignal);
  if (overridden) return overridden;
  const key = cmd.input.Key as string;
  switch (cmd.kind) {
    case 'head':
      if (!world.store.has(key)) throw notFound();
      return {};
    case 'get': {
      const body = world.store.get(key);
      if (!body) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
      return { Body: Readable.from([body]) };
    }
    case 'put': {
      const b = cmd.input.Body as Buffer | Readable;
      const chunks: Buffer[] = [];
      if (Buffer.isBuffer(b)) chunks.push(b);
      else for await (const c of b as Readable) chunks.push(Buffer.from(c));
      world.store.set(key, Buffer.concat(chunks));
      return {};
    }
    case 'list': {
      const prefix = cmd.input.Prefix as string;
      return { Contents: [...world.store.keys()].filter((k) => k.startsWith(prefix)).map((Key) => ({ Key })), IsTruncated: false };
    }
    case 'delete': {
      for (const o of (cmd.input.Delete as { Objects: { Key: string }[] }).Objects) world.store.delete(o.Key);
      return { Deleted: [] };
    }
  }
  throw new Error(`unexpected s3 ${cmd.kind}`);
}

async function fakeDdb(cmd: { kind: string; input: Record<string, unknown> }) {
  if (cmd.kind === 'get') return { Item: world.project ?? undefined };
  if (cmd.kind === 'update' && world.project) {
    // Evaluate the status part of the condition, and keep the stored status in step.
    const cond = String(cmd.input.ConditionExpression ?? '');
    const values = cmd.input.ExpressionAttributeValues as Record<string, unknown>;
    const render = world.project.render as { status: string };
    if (/#render\.#st = :st/.test(cond) && render.status !== values[':st']) throw Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' });
    if (/#render\.#st <> :st/.test(cond) && render.status === values[':st']) throw Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' });
    const names = cmd.input.ExpressionAttributeNames as Record<string, string>;
    for (const m of String(cmd.input.UpdateExpression).matchAll(/#render\.#(\w+) = (:\w+)/g)) {
      if (names[`#${m[1]}`] === 'status') render.status = values[m[2]] as string;
    }
  }
  return {};
}

async function fakeLambda(cmd: { input: Record<string, unknown> }) {
  const event = JSON.parse(String(cmd.input.Payload));
  const spec = event.videoTextChunk;
  world.invoked.push(spec);
  const reply = world.chunkReply(spec);
  if (reply && typeof reply === 'object' && 'FunctionError' in (reply as object)) return reply;
  return { Payload: Buffer.from(JSON.stringify(reply)) };
}

beforeEach(() => {
  world = {
    project: projectFor(),
    store: new Map(),
    csv: 'segment-0000.mp4,0.000000,20.000000\nsegment-0001.mp4,20.000000,40.000000\nsegment-0002.mp4,40.000000,45.000000\n',
    videoFirstPts: 0,
    hasAudio: true,
    hashFor: () => AUDIO_HASH,
    timingFor: () => AUDIO_TIMING,
    chunkReply: (e) => {
      const key = chunkOutKey(PID, RID, e.index);
      world.store.set(key, Buffer.from('CHUNK'));
      return { ok: true, key };
    },
    ffArgs: [],
    invoked: [],
  };
  world.store.set(SRC_KEY, Buffer.from('SOURCE-VIDEO'));
  for (const b of BLOCKS) world.store.set(overlayKey(PID, RID, b.id), Buffer.from('PNG'));
  ddbSend.mockReset().mockImplementation(fakeDdb);
  s3Send.mockReset().mockImplementation(fakeS3);
  lambdaSend.mockReset().mockImplementation(fakeLambda);
  spawnSync.mockReset().mockImplementation(fakeFfmpeg);
  getSignedUrl.mockReset().mockResolvedValue('https://signed.example/source.mp4?X-Amz-Signature=secret');
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  clockSkew = 0;
  s3Override = null;
  jest.spyOn(Date, 'now').mockImplementation(() => realNow() + clockSkew);
});

afterEach(() => jest.restoreAllMocks());

/** Every render patch: the fields set (by name) and the renderId it was conditional on. */
const patches = () =>
  ddbSend.mock.calls
    .map((c) => c[0] as { kind: string; input: Record<string, unknown> })
    .filter((c) => c.kind === 'update')
    .map(({ input }) => {
      const names = input.ExpressionAttributeNames as Record<string, string>;
      const values = input.ExpressionAttributeValues as Record<string, unknown>;
      const fields: Record<string, unknown> = {};
      for (const m of String(input.UpdateExpression).matchAll(/#render\.#(\w+) = (:\w+)/g)) fields[names[`#${m[1]}`]] = values[m[2]];
      return { fields, condition: input.ConditionExpression, renderId: values[':renderId'], key: input.Key };
    });
const statuses = () => patches().map((p) => p.fields.status).filter(Boolean);
const lastError = () => patches().map((p) => p.fields.error).filter(Boolean).pop();
const keysLeft = () => [...world.store.keys()].filter((k) => k.startsWith(renderPrefix(PID, RID)));
const render = (ctx?: { getRemainingTimeInMillis: () => number }) =>
  handler({ videoTextRender: { projectId: PID, renderId: RID } } as never, ctx);

// ================================================================== probe

describe('videoTextProbe', () => {
  const probe = (key = SRC_KEY) => handler({ videoTextProbe: { key } } as never);
  const withHeader = (h: string) => spawnSync.mockImplementation((_b: string, args: string[]) => {
    world.ffArgs.push(args);
    if (args.includes('framecrc')) return { status: 0, stdout: videoPackets(world.videoFirstPts), stderr: '' };
    return { status: 1, stdout: '', stderr: h };
  });

  it('reads the header over a presigned URL, never downloading the file', async () => {
    withHeader(header({ duration: '00:05:07.239' }));
    const res = await probe();
    expect(res).toEqual({ ok: true, info: { width: 1920, height: 1080, fps: 25, durationSec: 307.23, hasAudio: true } });
    expect(getSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ input: expect.objectContaining({ Key: SRC_KEY }) }), { expiresIn: 300 });
    expect(world.ffArgs[0]).toEqual(['-hide_banner', '-i', 'https://signed.example/source.mp4?X-Amz-Signature=secret']);
    expect(s3Send.mock.calls.filter((c) => c[0].kind === 'get')).toHaveLength(0);
  });

  it('reports when S3 stored the file, so the deletion date counts from the upload', async () => {
    withHeader(header());
    s3Send.mockImplementation(async (cmd: { kind: string; input: Record<string, unknown> }) =>
      cmd.kind === 'head' ? { LastModified: new Date('2026-11-01T10:00:00Z') } : fakeS3(cmd as never));
    expect(await probe()).toMatchObject({ ok: true, info: { storedAt: '2026-11-01T10:00:00.000Z' } });
  });

  it('F1: a 2:08.14 video is reported as 128.14, not 128.13', async () => {
    withHeader(header({ duration: '00:02:08.14' }));
    expect(await probe()).toMatchObject({ ok: true, info: { durationSec: 128.14 } });
  });

  it('refuses a variable frame rate with the exact message', async () => {
    withHeader(header({ video: 'h264 (High), yuv420p, 1920x1080, 726 kb/s, 29.5 fps, 30 tbr, 600 tbn' }));
    expect(await probe()).toEqual({ ok: false, message: VFR_MESSAGE });
  });

  it('accepts an average within 1% of tbr (29.97 vs 30 is NTSC, not VFR)', async () => {
    withHeader(header({ video: 'h264 (High), yuv420p, 1920x1080, 726 kb/s, 29.97 fps, 29.97 tbr, 30k tbn' }));
    expect(await probe()).toMatchObject({ ok: true, info: { fps: 29.97 } });
  });

  it('refuses a stream with no average frame rate as variable', async () => {
    withHeader(header({ video: 'h264 (High), yuv420p, 1920x1080, 726 kb/s, 30 tbr, 600 tbn' }));
    expect(await probe()).toEqual({ ok: false, message: VFR_MESSAGE });
  });

  it('refuses a codec that is not H.264 or HEVC', async () => {
    withHeader(header({ video: 'prores (HQ) (apch / 0x68637061), yuv422p10le, 1920x1080, 25 fps, 25 tbr, 12800 tbn' }));
    expect(await probe()).toEqual({ ok: false, message: expect.stringMatching(/prores.*H\.264 or HEVC/) });
  });

  it('accepts HEVC and refuses a frame above 3840x2160', async () => {
    withHeader(header({ video: 'hevc (Main), yuv420p, 3840x2160, 25 fps, 25 tbr, 12800 tbn' }));
    expect(await probe()).toMatchObject({ ok: true, info: { width: 3840, height: 2160 } });
    withHeader(header({ video: 'hevc (Main), yuv420p, 4096x2160, 25 fps, 25 tbr, 12800 tbn' }));
    expect(await probe()).toEqual({ ok: false, message: expect.stringContaining('3840×2160') });
  });

  it('R13: refuses a picture that does not start at 0:00, reading only the first packets over the URL', async () => {
    withHeader(header());
    world.videoFirstPts = 6400; // 0.5 s at 1/12800
    expect(await probe()).toEqual({ ok: false, message: START_OFFSET });
    const crc = world.ffArgs.find((a) => a.includes('framecrc'))!;
    expect(crc).toEqual(expect.arrayContaining(['-copyts', '-frames:v', '64', '0:v:0', 'https://signed.example/source.mp4?X-Amz-Signature=secret']));
  });

  it('R13: one frame late is refused, under half a frame is accepted (25 fps: limit 0.02 s)', async () => {
    withHeader(header());
    world.videoFirstPts = 512; // 0.04 s
    expect(await probe()).toEqual({ ok: false, message: START_OFFSET });
    world.videoFirstPts = 128; // 0.01 s
    expect(await probe()).toMatchObject({ ok: true });
  });

  it('R15: refuses HDR, PQ or HLG, with the exact message', async () => {
    withHeader(header({ video: 'hevc (Main 10) (hev1 / 0x31766568), yuv420p10le(tv, bt2020nc/bt2020/smpte2084, progressive), 1920x1080, 25 fps, 25 tbr, 12800 tbn' }));
    expect(await probe()).toEqual({ ok: false, message: HDR });
    withHeader(header({ video: 'hevc (Main 10), yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67, progressive), 1920x1080, 25 fps, 25 tbr, 12800 tbn' }));
    expect(await probe()).toEqual({ ok: false, message: HDR });
    withHeader(header({ video: 'h264 (High), yuv420p(tv, bt709, progressive), 1920x1080, 25 fps, 25 tbr, 12800 tbn' }));
    expect(await probe()).toMatchObject({ ok: true });
  });

  it('refuses an odd frame size (x264 cannot encode it), with what to do', async () => {
    withHeader(header({ video: 'h264 (High), yuv444p(progressive), 321x241, 25 fps, 25 tbr, 12800 tbn' }));
    expect(await probe()).toEqual({
      ok: false,
      message: 'This video is 321×241; its width and height must be even numbers. Export it at a standard size (for example 1920×1080) and upload again.',
    });
  });

  it('refuses at upload a video too heavy for the chunk budget (4K at 60 fps)', async () => {
    withHeader(header({ video: 'h264 (High), yuv420p(progressive), 3840x2160, 60 fps, 60 tbr, 15360 tbn', duration: '00:02:00.00' }));
    world.videoFirstPts = 0;
    expect(await probe()).toEqual({
      ok: false,
      message: 'This video is too heavy to render here (3840×2160 at 60 fps). Export it at 1440p and 30 fps or less, and upload again.',
    });
  });

  it('R14: refuses a rotated video, whose header size is not the size it plays at', async () => {
    withHeader(header({ extra: '    Side data:\n      displaymatrix: rotation of -90.00 degrees\n' }));
    expect(await probe()).toEqual({ ok: false, message: expect.stringContaining('rotated') });
    // The older tag form, and 0 / 360 degrees are not rotations.
    withHeader(header({ extra: '    Metadata:\n      rotate          : 90\n' }));
    expect(await probe()).toEqual({ ok: false, message: expect.stringContaining('rotated') });
    withHeader(header({ extra: '    Side data:\n      displaymatrix: rotation of -0.00 degrees\n' }));
    expect(await probe()).toMatchObject({ ok: true });
  });

  it('reports no audio as hasAudio: false, not an error', async () => {
    withHeader(header({ audio: false }));
    expect(await probe()).toMatchObject({ ok: true, info: { hasAudio: false } });
  });

  it('a URL ffmpeg could not open is "try again", not "export again", and the signature is never logged', async () => {
    withHeader('[https @ 0x1] HTTP error 403 Forbidden\nhttps://signed.example/source.mp4?X-Amz-Signature=secret: Server returned 403 Forbidden\n');
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = (await probe()) as { ok: boolean; message: string };
    // F11: retryable — the route answers 503 and the page re-checks the same key.
    expect(res).toEqual({ ok: false, message: 'the video could not be read — try again', retryable: true });
    expect(JSON.stringify(spy.mock.calls)).not.toContain('secret');
    spy.mockRestore();
  });

  it('an opened file with no readable video stream is the file\'s fault, and never echoes the log', async () => {
    withHeader("Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'https://signed.example/source.mp4?X-Amz-Signature=secret':\n  Duration: 00:00:45.00\n  Stream #0:0: Audio: aac, 48000 Hz, stereo\n");
    const res = (await probe()) as { ok: boolean; message: string };
    expect(res).toEqual({ ok: false, message: expect.stringContaining('Export it as an MP4 or MOV') });
    expect(res).not.toHaveProperty('retryable');
    expect(res.message).not.toContain('secret');
  });

  it('refuses a key outside the video-text workspace without signing it', async () => {
    expect(await probe('audio/mastering/song.wav')).toMatchObject({ ok: false });
    expect(await probe('audio/mastering/video-text/../x.mp4')).toMatchObject({ ok: false });
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('sweeps stale /tmp/vt-* scratch at the start', async () => {
    const stale = join(TMP_ROOT, 'vt-stale');
    mkdirSync(stale);
    withHeader(header());
    await probe();
    expect(existsSync(stale)).toBe(false);
  });
});

// ================================================================== render

describe('videoTextRender', () => {
  it('runs segmenting → encoding → joining → done and keeps only the output', async () => {
    const res = await render();
    expect(res).toMatchObject({ ok: true });
    expect(statuses()).toEqual(['segmenting', 'encoding', 'joining', 'done']);
    const done = patches().find((p) => p.fields.status === 'done')!.fields;
    expect(done.outputKey).toBe(outputKey(PID, RID));
    expect(typeof done.outputExpiresAt).toBe('string');
    expect(done.error).toBeNull();
    expect(keysLeft()).toEqual([outputKey(PID, RID)]);
    expect(world.store.has(SRC_KEY)).toBe(true);
  });

  it('F2: reads the project strongly consistent (the claim was just written)', async () => {
    await render();
    const gets = ddbSend.mock.calls.map((c) => c[0] as { kind: string; input: Record<string, unknown> }).filter((c) => c.kind === 'get');
    expect(gets.length).toBeGreaterThan(0);
    for (const g of gets) expect(g.input.ConsistentRead).toBe(true);
  });

  it('every patch is conditional on the renderId from the event', async () => {
    await render();
    expect(patches().length).toBeGreaterThan(3);
    const all = patches();
    // The first patch claims the render: only while it is still queued.
    expect(all[0].condition).toBe('#render.#renderId = :renderId AND #render.#st = :st');
    for (const p of all) {
      expect(p.renderId).toBe(RID);
      expect(String(p.condition).startsWith('#render.#renderId = :renderId')).toBe(true);
      expect(p.key).toEqual({ PK: `VIDEOTEXT#${PID}`, SK: 'METADATA' });
    }
  });

  it('refuses to join when the scratch disk cannot hold the finished video, with a clear message', async () => {
    mockStatfs.mockReturnValue({ bavail: 1, bsize: 4096 });
    await render();
    expect(lastError()).toBe(
      'the finished video is too large to put together here — export the video at a lower resolution, or use a shorter one',
    );
    expect(world.ffArgs.some((a) => a.includes('concat'))).toBe(false);
    mockStatfs.mockReset();
  });

  it('a duplicate delivery of a render already under way exits without touching it', async () => {
    (world.project!.render as { status: string }).status = 'encoding';
    world.store.set(segmentKey(PID, RID, 0), Buffer.from('SEG')); // the running render's file
    const res = await render();
    expect(res).toMatchObject({ ok: false, message: 'this render was already started' });
    expect(world.invoked).toHaveLength(0);
    // Only the refused claim was attempted; the stored status is untouched.
    expect(patches()).toHaveLength(1);
    expect((world.project!.render as { status: string }).status).toBe('encoding');
    // It must not delete the running render's files.
    expect(keysLeft()).toContain(segmentKey(PID, RID, 0));
  });

  it('a failure never overwrites a render that is already done', async () => {
    world.chunkReply = () => {
      (world.project!.render as { status: string }).status = 'done'; // another delivery finished meanwhile
      return { ok: false, message: 'boom' };
    };
    await render();
    expect((world.project!.render as { status: string }).status).toBe('done');
  });

  it('fans out one chunk per segment with that segment\'s overlays, block crossing a cut in both', async () => {
    await render();
    const byIndex = [...world.invoked].sort((a, b) => a.index - b.index);
    expect(byIndex.map((e) => e.index)).toEqual([0, 1, 2]);
    expect(byIndex[0]).toMatchObject({ projectId: PID, renderId: RID, segKey: segmentKey(PID, RID, 0), width: 1920, height: 1080 });
    expect(byIndex[0].overlays).toEqual([{ id: 'title', fromSec: 0, toSec: 5 }, { id: 'l1', fromSec: 18, toSec: 20 }]);
    expect(byIndex[1].overlays).toEqual([{ id: 'l1', fromSec: 0, toSec: 2 }, { id: 'cred', fromSec: 15, toSec: 20 }]);
    expect(byIndex[2].overlays).toEqual([{ id: 'cred', fromSec: 0, toSec: 5 }]);
  });

  it('extracts the audio first, joins with the extract, and checks hash AND timing before and after', async () => {
    await render();
    const join_ = world.ffArgs.find((a) => a.includes('concat'))!;
    expect(join_).toContain('1:a:0');
    expect(basename(join_[join_.indexOf('-i', join_.indexOf('concat')) + 3])).toBe('audio.m4a');
    const hashed = world.ffArgs.filter((a) => a.includes('streamhash')).map((a) => basename(a[a.indexOf('-i') + 1]));
    const timed = world.ffArgs.filter((a) => a.includes('framecrc') && a.includes('0:a:0')).map((a) => basename(a[a.indexOf('-i') + 1]));
    expect(hashed).toEqual(['source.mp4', 'audio.m4a', 'output.mp4']);
    expect(timed).toEqual(['source.mp4', 'audio.m4a', 'output.mp4']);
  });

  it('a chunk that answers ok:false ends in error naming the part, and still deletes every intermediate', async () => {
    world.chunkReply = (e) => {
      if (e.index === 1) return { ok: false, message: 'the encoder failed' };
      const key = chunkOutKey(PID, RID, e.index);
      world.store.set(key, Buffer.from('CHUNK'));
      return { ok: true, key };
    };
    const res = await render();
    expect(res).toMatchObject({ ok: false });
    expect(statuses().pop()).toBe('error');
    expect(lastError()).toBe('part 2 of the video could not be rendered: the encoder failed');
    expect(keysLeft()).toEqual([]);
    expect(patches().some((p) => p.fields.outputKey)).toBe(false);
  });

  it('a chunk FunctionError fails the render too', async () => {
    world.chunkReply = () => ({ FunctionError: 'Unhandled', Payload: Buffer.from('{"errorMessage":"boom"}') });
    await render();
    expect(statuses().pop()).toBe('error');
    expect(lastError()).toMatch(/^part \d of the video could not be rendered: /);
  });

  it('a chunk that answers with a different key fails the render', async () => {
    world.chunkReply = () => ({ ok: true, key: 'audio/mastering/elsewhere.mp4' });
    await render();
    expect(lastError()).toMatch(/^part \d of the video could not be rendered/);
  });

  it('an output audio hash mismatch ends in error and writes no output', async () => {
    world.hashFor = (f) => (f === 'output.mp4' ? '0,a,SHA256=bbbb\n' : AUDIO_HASH);
    await render();
    expect(lastError()).toBe(AUDIO_CHANGED);
    expect(world.store.has(outputKey(PID, RID))).toBe(false);
    expect(patches().some((p) => p.fields.outputKey)).toBe(false);
    expect(keysLeft()).toEqual([]);
  });

  it('an output whose packets moved (same hash, different pts) is refused too', async () => {
    world.timingFor = (f) => (f === 'output.mp4' ? AUDIO_TIMING.replace('-1024,      -1024', '0,      0') : AUDIO_TIMING);
    await render();
    expect(lastError()).toBe(AUDIO_CHANGED);
    expect(world.store.has(outputKey(PID, RID))).toBe(false);
  });

  it('an extract that differs from the source stops before any segment is cut', async () => {
    world.timingFor = (f) => (f === 'audio.m4a' ? AUDIO_TIMING.replace('1/48000', '1/1000') : AUDIO_TIMING);
    await render();
    expect(lastError()).toBe(AUDIO_CHANGED);
    expect(world.ffArgs.some((a) => a.includes('segment'))).toBe(false);
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  it('a source with no audio joins without 1:a and still ends done', async () => {
    world.hasAudio = false;
    world.project = projectFor({ hasAudio: false });
    await render();
    const join_ = world.ffArgs.find((a) => a.includes('concat'))!;
    expect(join_).not.toContain('1:a:0');
    expect(world.ffArgs.some((a) => a.includes('streamhash'))).toBe(false);
    expect(statuses()).toEqual(['segmenting', 'encoding', 'joining', 'done']);
  });

  it('R1: a missing text image fails before any chunk is invoked', async () => {
    world.store.delete(overlayKey(PID, RID, 'l1'));
    await render();
    expect(lastError()).toBe(MISSING_PNG);
    expect(lambdaSend).not.toHaveBeenCalled();
    expect(keysLeft()).toEqual([]);
  });

  it('R8: a segment longer than this video\'s chunk budget is refused, naming its keyframe interval', async () => {
    // 1920×1080 at 25 fps: one chunk can take up to 60 s, target 20 s → keyframes every 40 s.
    world.csv = 'segment-0000.mp4,0.000000,61.000000\n';
    await render();
    expect(lastError()).toBe('This video has too few keyframes to split — export it again with a keyframe at least every 40 seconds.');
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  it('R8: at 1080p25 a 51 s segment fits the budget and renders', async () => {
    world.csv = 'segment-0000.mp4,0.000000,45.000000\n';
    await render();
    expect(statuses()).toContain('done');
  });

  it('segments at this video\'s own target length (20 s at 1080p25)', async () => {
    await render();
    const seg = world.ffArgs.find((a) => a.includes('segment'))!;
    expect(seg[seg.indexOf('-segment_time') + 1]).toBe('20');
  });

  it('R13 backstop: a source whose picture starts late is refused before segmenting, nothing shifted', async () => {
    world.videoFirstPts = 6400; // 0.5 s
    await render();
    expect(lastError()).toBe(START_OFFSET);
    expect(world.ffArgs.some((a) => a.includes('segment'))).toBe(false);
    expect(lambdaSend).not.toHaveBeenCalled();
    expect(keysLeft()).toEqual([]);
  });

  it('R14/R15 backstop: the coordinator re-applies the probe refusals to the downloaded file', async () => {
    spawnSync.mockImplementation((b: string, args: string[]) =>
      args.length === 3 && args[1] === '-i'
        ? { status: 1, stdout: '', stderr: header({ extra: '    Side data:\n      displaymatrix: rotation of 90.00 degrees\n' }) }
        : fakeFfmpeg(b, args));
    await render();
    expect(lastError()).toEqual(expect.stringContaining('rotated'));
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  it('stops with the out-of-time message when the join reserve is gone', async () => {
    await render({ getRemainingTimeInMillis: () => 100_000 });
    expect(lastError()).toBe(OUT_OF_TIME);
    expect(keysLeft()).toEqual([]);
  });

  describe('every S3 transfer is bounded by the deadline', () => {
    const LAMBDA = { getRemainingTimeInMillis: () => 900_000 };

    it('a source download stopped for time ends in error with the out-of-time message', async () => {
      const signals: Array<AbortSignal | undefined> = [];
      s3Override = (cmd, signal) => {
        if (cmd.kind !== 'get' || cmd.input.Key !== SRC_KEY) return undefined;
        signals.push(signal);
        return Promise.reject(timeout());
      };
      await render(LAMBDA);
      expect(signals).toHaveLength(1);
      expect(signals[0]).toBeInstanceOf(AbortSignal);
      expect(statuses()).toEqual(['segmenting', 'error']);
      expect(lastError()).toBe(OUT_OF_TIME);
      expect(lambdaSend).not.toHaveBeenCalled();
      expect(keysLeft()).toEqual([]);
    });

    it('a slow output upload stopped for time ends in error, with no output key written', async () => {
      const signals: Array<AbortSignal | undefined> = [];
      s3Override = (cmd, signal) => {
        if (cmd.kind !== 'put' || cmd.input.Key !== outputKey(PID, RID)) return undefined;
        signals.push(signal);
        // Rejected without reading the body, as a send stopped early does: the
        // worker must still close the stream before deleting the file under it.
        return Promise.reject(timeout());
      };
      await render(LAMBDA);
      expect(signals[0]).toBeInstanceOf(AbortSignal);
      expect(statuses().pop()).toBe('error');
      expect(lastError()).toBe(OUT_OF_TIME);
      expect(patches().some((p) => p.fields.outputKey)).toBe(false);
      expect(keysLeft()).toEqual([]);
    });

    it('the output upload is not started without 30 s left', async () => {
      // The last check before the upload (the output's packet timing) "takes" until 25 s remain.
      spawnSync.mockImplementation((b: string, args: string[]) => {
        const r = fakeFfmpeg(b, args);
        if (args.includes('framecrc') && args.includes('0:a:0') && basename(args[args.indexOf('-i') + 1]) === 'output.mp4') clockSkew = 875_000;
        return r;
      });
      await render(LAMBDA);
      expect(lastError()).toBe(OUT_OF_TIME);
      expect(s3Send.mock.calls.some((c) => c[0].kind === 'put' && c[0].input.Key === outputKey(PID, RID))).toBe(false);
    });

    it('every coordinator S3 call carries an abort signal', async () => {
      await render(LAMBDA);
      expect(statuses().pop()).toBe('done');
      const calls = s3Send.mock.calls.filter((c) => ['get', 'put', 'head', 'list', 'delete'].includes(c[0].kind));
      expect(calls.length).toBeGreaterThan(10);
      for (const c of calls) expect(c[1]?.abortSignal).toBeInstanceOf(AbortSignal);
    });
  });

  it('R16: a failed progress patch is logged and the render still ends done', async () => {
    // Each chunk "takes" 4 s, so every reply is past the 3 s progress throttle.
    const reply = world.chunkReply;
    world.chunkReply = (e) => { clockSkew += 4_000; return reply(e); };
    let failed = 0;
    ddbSend.mockImplementation(async (cmd: { kind: string; input: Record<string, unknown> }) => {
      const expr = String(cmd.input.UpdateExpression ?? '');
      if (cmd.kind === 'update' && expr.includes('progress') && !expr.includes('#status') && failed === 0) {
        failed++;
        throw new Error('throttled');
      }
      return fakeDdb(cmd);
    });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await render();
    expect(failed).toBe(1);
    expect(statuses()).toEqual(['segmenting', 'encoding', 'joining', 'done']);
    expect(spy.mock.calls.some((c) => String(c[0]).includes('progress patch failed'))).toBe(true);
  });

  it('refuses a source whose frame size no longer matches the project (the PNGs would not fit)', async () => {
    world.project = { ...projectFor(), source: { ...(projectFor().source), width: 1280, height: 720 } };
    await render();
    expect(statuses().pop()).toBe('error');
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  it('never throws: a DynamoDB failure still returns, after trying to write the error', async () => {
    ddbSend.mockImplementation(async (cmd: { kind: string }) => {
      if (cmd.kind === 'get') throw new Error('ddb down');
      return {};
    });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(render()).resolves.toMatchObject({ ok: false });
    expect(statuses()).toEqual(['error']);
    spy.mockRestore();
  });

  it('does nothing for a render that is no longer the current one', async () => {
    world.project = projectFor({ renderId: 'newer' });
    await render();
    expect(spawnSync).not.toHaveBeenCalled();
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  it('leaves no local scratch behind', async () => {
    await render();
    expect(readdirSync(TMP_ROOT).filter((n) => n.startsWith('vt-'))).toEqual([]);
  });
});

// ================================================================== chunk

describe('videoTextChunk', () => {
  const spec = (o: Record<string, unknown> = {}) => ({
    projectId: PID, renderId: RID, index: 1, segKey: segmentKey(PID, RID, 1),
    overlays: [{ id: 'l1', fromSec: 0, toSec: 2 }, { id: 'cred', fromSec: 15, toSec: 20 }],
    width: 1920, height: 1080, ...o,
  });
  beforeEach(() => world.store.set(segmentKey(PID, RID, 1), Buffer.from('SEGMENT')));

  it('overlays the PNGs on its segment and uploads the chunk', async () => {
    const res = await handler({ videoTextChunk: spec() } as never);
    expect(res).toEqual({ ok: true, key: chunkOutKey(PID, RID, 1) });
    expect(world.store.get(chunkOutKey(PID, RID, 1))?.toString()).toBe('CHUNK');
    const args = world.ffArgs.find((a) => a.includes('-preset'))!;
    const pngInputs = args.filter((_, i) => args[i - 1] === '-i').map((p) => basename(p));
    expect(pngInputs).toEqual(['segment.mp4', 'overlay-l1.png', 'overlay-cred.png']);
    expect(args.join(' ')).toContain("enable='gte(t,15)*lt(t,20)'");
  });

  it('refuses a segment key that is not the one its index names', async () => {
    const res = await handler({ videoTextChunk: spec({ segKey: 'audio/mastering/other.mp4' }) } as never);
    expect(res).toMatchObject({ ok: false });
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('answers ok:false when ffmpeg fails', async () => {
    spawnSync.mockImplementation(() => ({ status: 1, stdout: '', stderr: 'boom' }));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await handler({ videoTextChunk: spec() } as never);
    expect(res).toMatchObject({ ok: false, message: expect.any(String) });
    expect(world.store.has(chunkOutKey(PID, RID, 1))).toBe(false);
    spy.mockRestore();
  });

  it('the chunk function refuses every other kind of event', async () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'tamilagaval-video-text-chunk';
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    for (const event of [{ videoTextProbe: { key: SRC_KEY } }, { videoTextRender: { projectId: PID, renderId: RID } }, { jobId: 'j', s3Key: 'k' }]) {
      expect(await handler(event as never)).toEqual({ ok: false, message: 'this function only renders video-text chunks' });
    }
    expect(spawnSync).not.toHaveBeenCalled();
    expect(await handler({ videoTextChunk: spec() } as never)).toMatchObject({ ok: true });
    spy.mockRestore();
  });

  it('leaves no local scratch behind', async () => {
    await handler({ videoTextChunk: spec() } as never);
    expect(readdirSync(TMP_ROOT).filter((n) => n.startsWith('vt-'))).toEqual([]);
  });
});
