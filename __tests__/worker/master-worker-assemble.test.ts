/** @jest-environment node */
/**
 * master-worker — the `assemble` action (Visual Story Studio Phase 6).
 *
 * What is pinned: every key in the event is re-checked before anything is
 * downloaded (this role reaches the whole mastering workspace); the worker
 * writes ONLY the story's RENDER# row, conditionally, and never queries (its
 * role cannot); shots are rendered one at a time in timeline order, clips and
 * stills each by their own recipe, then joined over the master's window; a
 * failure names the shot it happened on.
 */

const send = jest.fn().mockResolvedValue({});
const s3Send = jest.fn();
const spawnSync = jest.fn();
const ssmSend = jest.fn();
const fetchMock = jest.fn();

jest.mock('node:child_process', () => ({ spawnSync: (...a: unknown[]) => spawnSync(...a) }));
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { send = (...a: unknown[]) => s3Send(...a); },
  GetObjectCommand: class { constructor(public input: unknown) {} },
  PutObjectCommand: class { constructor(public input: unknown) {} },
}));
jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: class {} }));
jest.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: class { send = (...a: unknown[]) => ssmSend(...a); },
  GetParameterCommand: class { constructor(public input: unknown) {} },
}));
const mockRmSync = jest.fn();
const mockWriteFileSync = jest.fn();
const mockStatSync = jest.fn(() => ({ size: 123456 }));
jest.mock('node:fs', () => ({
  mkdtempSync: () => '/tmp/master-test',
  writeFileSync: (...a: unknown[]) => mockWriteFileSync(...a),
  readFileSync: () => Buffer.from('MASTERED-WAV-BYTES'),
  rmSync: (...a: unknown[]) => mockRmSync(...a),
  statSync: (...a: unknown[]) => mockStatSync(...a),
  createReadStream: (p: string) => ({ stream: p }),
  readdirSync: () => mockReaddir(),
}));
const mockReaddir = jest.fn((): string[] => []);
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: (...a: unknown[]) => send(...a) }) },
  UpdateCommand: class { constructor(public input: Record<string, unknown>) {} },
  GetCommand: class { constructor(public input: Record<string, unknown>) {} },
}));

process.env.TAKES_BUCKET = 'tamil-web-media';
(global as unknown as { fetch: unknown }).fetch = (...a: unknown[]) => fetchMock(...a);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { handler } = require('../../worker/master-worker') as typeof import('../../worker/master-worker');

const VS = 'vs_1700000000000_abcdef12';
const RD = 'rd_1700000000000_abcdef12';
const AUDIO = 'audio/mastering/1_a_song-master-14LUFS.wav';
const C = `audio/mastering/visual-story/${VS}/candidates`;
const CLIP = `${C}/cd_1700000000000_aaaaaa.mp4`;
const STILL = `${C}/cd_1700000000000_bbbbbb.jpg`;
/** A 4:00 master, as the WAV header prints it. */
const HEADER = "Input #0, wav, from '/tmp/master-test/master.wav':\n  Duration: 00:04:00.00, bitrate: 2304 kb/s\n" +
  '  Stream #0:0: Audio: pcm_s24le, 48000 Hz, stereo, s32 (24 bit), 2304 kb/s\n';

const assemble = (over: Record<string, unknown> = {}) => ({
  vsId: VS, renderId: RD, audioKey: AUDIO, aspectRatio: '16:9', windowStartSec: 30, windowEndSec: 60,
  shots: [
    { sceneOrder: 1, shotOrder: 1, key: CLIP, durationSec: 15 },
    { sceneOrder: 1, shotOrder: 2, key: STILL, durationSec: 15 },
  ],
  ...over,
});
const ffArgs = () => spawnSync.mock.calls.map((c) => c[1] as string[]);
const updates = () => send.mock.calls.map((c) => (c[0] as { input: Record<string, any> }).input);
const statuses = () => updates().map((u) => u.ExpressionAttributeValues?.[':to']);
const gets = () => s3Send.mock.calls.map((c) => c[0] as { input: Record<string, unknown> })
  .filter((c) => !('Body' in c.input)).map((c) => c.input.Key);
const put = () => s3Send.mock.calls.map((c) => c[0] as { input: Record<string, unknown> }).find((c) => 'Body' in c.input);

beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue({ Attributes: {} });
  spawnSync.mockReset();
  spawnSync.mockImplementation((_cmd: string, args: string[]) =>
    args.length === 3 && args[2].includes('master.wav')
      ? { status: 1, stdout: '', stderr: HEADER }
      : { status: 0, stdout: '', stderr: '' });
  s3Send.mockReset();
  s3Send.mockImplementation((cmd: { input: Record<string, unknown> }) =>
    'Body' in cmd.input
      ? Promise.resolve({})
      : Promise.resolve({ Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } }));
  mockRmSync.mockClear();
});

it('renders each shot in order, joins them over the window, uploads, and marks the render done', async () => {
  const res = await handler({ assemble: assemble() } as never);
  expect(res).toMatchObject({ ok: true });

  expect(gets()).toEqual([AUDIO, CLIP, STILL]);
  // The clip: its own recipe, sound dropped, exactly 15 s of frames.
  const clip = ffArgs().find((a) => a.some((x) => x.includes('tpad=stop_mode=clone:stop_duration=15')))!;
  expect(clip[clip.indexOf('-frames:v') + 1]).toBe('375');
  expect(clip).toContain('-an');
  // The still: composed, then a slow zoom across its 15 s.
  expect(ffArgs().some((a) => a.includes('-filter_complex') && a.some((x) => x.includes('scale=7680:4320')))).toBe(true);
  expect(ffArgs().some((a) => a.some((x) => x.includes('zoompan=')))).toBe(true);
  // The join: the master's window, both fades (an excerpt), never -shortest.
  const join = ffArgs().find((a) => a.includes('concat'))!;
  const at = join.indexOf(join.find((x) => x.endsWith('master.wav'))!);
  expect(join.slice(at - 5, at)).toEqual(['-ss', '30.000', '-t', '30', '-i']);
  expect(join[join.indexOf('-af') + 1]).toBe('afade=t=in:st=0:d=0.6,afade=t=out:st=27.000:d=3');
  expect(join).not.toContain('-shortest');

  expect(put()?.input).toMatchObject({ Key: `audio/mastering/visual-story/${VS}/renders/${RD}.mp4`, ContentType: 'video/mp4' });
  expect(statuses()).toEqual(['running', 'done']);
  const done = updates()[1];
  expect(done.Key).toEqual({ PK: `VSTORY#${VS}`, SK: `RENDER#${RD}` });
  expect(done.ConditionExpression).toContain('attribute_exists(PK)');
  expect(done.ExpressionAttributeValues[':s3Key']).toBe(`audio/mastering/visual-story/${VS}/renders/${RD}.mp4`);
});

it('streams the upload instead of reading a large video into memory', async () => {
  await handler({ assemble: assemble() } as never);
  expect(put()?.input.Body).toEqual({ stream: '/tmp/master-test/story.mp4' });
  expect(put()?.input.ContentLength).toBe(123456);
});

it('frees the segments once joined, and clears a killed run\'s leftovers first', async () => {
  mockReaddir.mockReturnValueOnce(['assemble-old', 'other-dir']);
  await handler({ assemble: assemble() } as never);
  const removed = mockRmSync.mock.calls.map((c) => String(c[0]));
  expect(removed).toContain('/tmp/assemble-old');
  expect(removed).not.toContain('/tmp/other-dir');
  expect(removed).toContain('/tmp/master-test/seg0.mp4');
  expect(removed).toContain('/tmp/master-test/seg1.mp4');
});

it('converts a still to the BT.709 the video is tagged with', async () => {
  await handler({ assemble: assemble() } as never);
  const zoom = ffArgs().find((a) => a.some((x) => x.includes('zoompan=')))!;
  // Before the move, so it runs once on the one source frame, not on every output frame.
  expect(zoom[zoom.indexOf('-vf') + 1]).toMatch(/^scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,zoompan=/);
});

it('refuses an event that waited too long in the queue, before any download', async () => {
  const old = new Date(Date.now() - 26 * 60_000).toISOString();
  const res = await handler({ assemble: assemble({ createdAt: old }) } as never);
  expect(res).toMatchObject({ ok: false });
  expect(statuses()).toEqual(['failed']);
  expect(updates()[0].ExpressionAttributeValues[':error']).toBe('The render waited too long to start. Please try again.');
  expect(s3Send).not.toHaveBeenCalled();
});

it('stops with a clear message before the Lambda would be killed', async () => {
  const res = await handler({ assemble: assemble() } as never, { getRemainingTimeInMillis: () => 60_000 } as never);
  expect(res).toMatchObject({ ok: false });
  expect(statuses()).toEqual(['running', 'failed']);
  expect(String(updates()[1].ExpressionAttributeValues[':error'])).toContain('ran out of time');
  expect(put()).toBeUndefined();
});

it('never queries the table — its role cannot', async () => {
  await handler({ assemble: assemble() } as never);
  for (const c of send.mock.calls) expect((c[0] as object).constructor.name).toBe('UpdateCommand');
});

it('deletes each shot\'s files before the next, so long stories fit the scratch disk', async () => {
  await handler({ assemble: assemble() } as never);
  const removed = mockRmSync.mock.calls.map((c) => String(c[0]));
  expect(removed.some((p) => p.includes('shot0'))).toBe(true);
  expect(removed.some((p) => p.includes('shot1'))).toBe(true);
});

it('adds no fade to a window that is the whole song', async () => {
  await handler({ assemble: assemble({ windowStartSec: 0, windowEndSec: 240, shots: [
    ...Array.from({ length: 16 }, (_, i) => ({ sceneOrder: 1, shotOrder: i + 1, key: CLIP, durationSec: 15 })),
  ] }) } as never);
  expect(ffArgs().find((a) => a.includes('concat'))).not.toContain('-af');
});

it('names the shot when one cannot be read, and uploads nothing', async () => {
  spawnSync.mockImplementation((_cmd: string, args: string[]) => {
    if (args.length === 3 && args[2].includes('master.wav')) return { status: 1, stdout: '', stderr: HEADER };
    if (args.some((x) => x.includes('tpad='))) return { status: 1, stdout: '', stderr: 'moov atom not found' };
    return { status: 0, stdout: '', stderr: '' };
  });
  const res = await handler({ assemble: assemble() } as never);
  expect(res).toMatchObject({ ok: false });
  expect(statuses()).toEqual(['running', 'failed']);
  expect(updates()[1].ExpressionAttributeValues[':error']).toBe('Scene 1, shot 1: the clip could not be read.');
  expect(put()).toBeUndefined();
});

it('refuses a window that runs past the end of the song', async () => {
  spawnSync.mockImplementation((_cmd: string, args: string[]) =>
    args.length === 3 && args[2].includes('master.wav')
      ? { status: 1, stdout: '', stderr: HEADER.replace('00:04:00.00', '00:00:35.00') }
      : { status: 0, stdout: '', stderr: '' });
  await handler({ assemble: assemble() } as never);
  expect(statuses()).toEqual(['running', 'failed']);
  expect(String(updates()[1].ExpressionAttributeValues[':error'])).toContain('past the end of the song');
});

it('a clip longer than Grok makes (your own upload, up to 60 s) renders at its own length', async () => {
  const res = await handler({
    assemble: assemble({ shots: [{ sceneOrder: 1, shotOrder: 1, key: CLIP, durationSec: 22 }, { sceneOrder: 1, shotOrder: 2, key: STILL, durationSec: 8 }] }),
  } as never);
  expect(res).toMatchObject({ ok: true });
  const clipSeg = ffArgs().find((a) => a.includes('-frames:v') && a.some((x) => x.includes('.mp4')) && a.includes('-an'));
  expect(clipSeg?.[clipSeg.indexOf('-frames:v') + 1]).toBe('550');
});

it('does nothing when the render was already cleared (claim lost)', async () => {
  send.mockRejectedValueOnce(Object.assign(new Error('c'), { name: 'ConditionalCheckFailedException' }));
  const res = await handler({ assemble: assemble() } as never);
  expect(res).toMatchObject({ ok: false });
  expect(s3Send).not.toHaveBeenCalled();
  expect(spawnSync).not.toHaveBeenCalled();
});

describe('a bad event touches no file', () => {
  it.each([
    ['an audio key that is not a master', { audioKey: 'audio/mastering/1_a_song.wav' }],
    ['a shot from another story', { shots: [{ sceneOrder: 1, shotOrder: 1, key: 'audio/mastering/visual-story/vs_1700000000000_zzzzzz/candidates/cd_1.mp4', durationSec: 12 }] }],
    ['a shot outside the workspace', { shots: [{ sceneOrder: 1, shotOrder: 1, key: 'images/x.jpg', durationSec: 12 }] }],
    ['shots that do not fill the window', { shots: [{ sceneOrder: 1, shotOrder: 1, key: CLIP, durationSec: 6 }] }],
    ['a shot of a fraction of a second', { shots: [{ sceneOrder: 1, shotOrder: 1, key: CLIP, durationSec: 12.5 }] }],
    ['a still over 15 s', { shots: [{ sceneOrder: 1, shotOrder: 1, key: STILL, durationSec: 16 }, { sceneOrder: 1, shotOrder: 2, key: CLIP, durationSec: 14 }] }],
    ['a clip over 60 s', { windowStartSec: 0, windowEndSec: 61, shots: [{ sceneOrder: 1, shotOrder: 1, key: CLIP, durationSec: 61 }] }],
    ['an unknown shape', { aspectRatio: '4:3' }],
  ])('%s → failed, no download', async (_l, over) => {
    const res = await handler({ assemble: assemble(over) } as never);
    expect(res).toMatchObject({ ok: false });
    expect(statuses()).toEqual(['failed']);
    expect(s3Send).not.toHaveBeenCalled();
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('a malformed story or render id writes nothing at all', async () => {
    const res = await handler({ assemble: assemble({ renderId: 'RENDER#x' }) } as never);
    expect(res).toMatchObject({ ok: false });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('a whole-song window keeps the song\'s real ending (audit 2026-11-09)', () => {
  /** A 4:00.70 master: the story's whole-second window ends at 240. */
  const header = HEADER.replace('00:04:00.00', '00:04:00.70');
  const wholeSong = () => assemble({ windowStartSec: 0, windowEndSec: 240, shots: [
    ...Array.from({ length: 16 }, (_, i) => ({ sceneOrder: 1, shotOrder: i + 1, key: CLIP, durationSec: 15 })),
  ] });
  beforeEach(() => {
    spawnSync.mockImplementation((_cmd: string, args: string[]) =>
      args.length === 3 && args[2].includes('master.wav')
        ? { status: 1, stdout: '', stderr: header }
        : { status: 0, stdout: '', stderr: '' });
  });

  it('the song runs to 4:00.70 under the last shot, with no fade and no cut', async () => {
    await handler({ assemble: wholeSong() } as never);
    const join = ffArgs().find((a) => a.includes('concat'))!;
    const at = join.indexOf(join.find((x) => x.endsWith('master.wav'))!);
    expect(join.slice(at - 5, at)).toEqual(['-ss', '0.000', '-t', '240.7', '-i']);
    expect(join).not.toContain('-af');
    // The last shot holds 0.7 s longer (frame-exact at 25 fps); the others are unchanged.
    const clips = ffArgs().filter((a) => a.some((x) => x.includes('tpad=stop_mode=clone')));
    expect(clips).toHaveLength(16);
    expect(clips[0][clips[0].indexOf('-frames:v') + 1]).toBe('375');
    expect(clips[15][clips[15].indexOf('-frames:v') + 1]).toBe('393');
  });

  it('an excerpt that ends a second or more before the song still fades and is not stretched', async () => {
    await handler({ assemble: assemble() } as never); // 30–60 of a 4:00.70 song
    const join = ffArgs().find((a) => a.includes('concat'))!;
    expect(join[join.indexOf('-af') + 1]).toBe('afade=t=in:st=0:d=0.6,afade=t=out:st=27.000:d=3');
  });
});

it('a shot that fails because the worker is out of time says so (not "please try again")', async () => {
  let left = 14 * 60_000;
  spawnSync.mockImplementation((_cmd: string, args: string[]) => {
    if (args.length === 3 && args[2].includes('master.wav')) return { status: 1, stdout: '', stderr: HEADER };
    if (args.some((x) => x.includes('tpad='))) { left = 10_000; return { status: 255, stdout: '', stderr: 'killed' }; }
    return { status: 0, stdout: '', stderr: '' };
  });
  await handler({ assemble: assemble() } as never, { getRemainingTimeInMillis: () => left } as never);
  expect(String(updates()[1].ExpressionAttributeValues[':error'])).toContain('ran out of time');
});
