/** @jest-environment node */
/**
 * master-worker — the Lambda's own guards.
 *
 * Why this exists: the worker's IAM role holds s3:GetObject AND s3:PutObject on
 * the whole of tamil-web-media, so it is the single most privileged piece of the
 * mastering module — and it was the only one with no tests. These cover the
 * checks that stand between a malformed Event payload and the published
 * catalogue; each asserts that S3 was never touched, not merely that the job was
 * marked failed.
 *
 * ffmpeg is never reached on these paths, so nothing here needs the layer.
 */

const send = jest.fn().mockResolvedValue({});
const s3Send = jest.fn();
const spawnSync = jest.fn();

jest.mock('node:child_process', () => ({ spawnSync: (...a: unknown[]) => spawnSync(...a) }));
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { send = (...a: unknown[]) => s3Send(...a); },
  GetObjectCommand: class { constructor(public input: unknown) {} },
  PutObjectCommand: class { constructor(public input: unknown) {} },
}));
jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: class {} }));
const mockRmSync = jest.fn();
const mockWriteFileSync = jest.fn();
jest.mock('node:fs', () => ({
  mkdtempSync: () => '/tmp/master-test',
  writeFileSync: (...a: unknown[]) => mockWriteFileSync(...a),
  readFileSync: () => Buffer.from('MASTERED-WAV-BYTES'),
  rmSync: (...a: unknown[]) => mockRmSync(...a),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: (...a: unknown[]) => send(...a) }) },
  UpdateCommand: class { constructor(public input: Record<string, unknown>) {} },
}));

process.env.TAKES_BUCKET = 'tamil-web-media';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { handler } = require('../../worker/master-worker') as typeof import('../../worker/master-worker');

/**
 * The fields the worker wrote onto the job item, across all its patches, with
 * DynamoDB's `:` value-placeholder prefix stripped back to the field names.
 */
const patched = () =>
  send.mock.calls
    .map((c) => (c[0] as { input: { ExpressionAttributeValues?: Record<string, unknown> } }).input.ExpressionAttributeValues ?? {})
    .reduce<Record<string, unknown>>((acc, v) => {
      for (const [k, val] of Object.entries(v)) acc[k.replace(/^:/, '')] = val;
      return acc;
    }, {});

beforeEach(() => {
  send.mockClear();
  s3Send.mockClear();
  spawnSync.mockClear();
});

describe('key guard', () => {
  it.each([
    ['a published catalogue song', 'audio/poem-music/amma.wav'],
    ['an escape out of the workspace', 'audio/mastering/../poem-music/amma.wav'],
    ['a bare bucket-root object', 'amma.wav'],
    ['the prefix itself', 'audio/mastering/'],
  ])('refuses %s without reading or writing S3', async (_label, s3Key) => {
    const res = await handler({ jobId: 'j1', s3Key, target: -14 });

    expect(res).toEqual({ ok: false });
    // The important assertion: the object was never fetched, and — since
    // masterKeyFor would have derived a sibling key — never overwritten either.
    expect(s3Send).not.toHaveBeenCalled();
    expect(spawnSync).not.toHaveBeenCalled();
    expect(patched()).toMatchObject({ status: 'error', error: { code: 'bad-key' } });
  });

  it('still refuses to re-master one of its own outputs', async () => {
    const res = await handler({ jobId: 'j1', s3Key: 'audio/mastering/1_a_song-master-14LUFS.wav', target: -14 });
    expect(res).toEqual({ ok: false });
    expect(s3Send).not.toHaveBeenCalled();
    expect(patched()).toMatchObject({ error: { code: 'already-mastered' } });
  });

  it('refuses a target outside loudnorm range', async () => {
    const res = await handler({ jobId: 'j1', s3Key: 'audio/mastering/1_a_song.wav', target: 0 });
    expect(res).toEqual({ ok: false });
    expect(s3Send).not.toHaveBeenCalled();
    expect(patched()).toMatchObject({ error: { code: 'bad-target' } });
  });

  it('rejects an event with no key at all before touching anything', async () => {
    const res = await handler({ jobId: 'j1' });
    expect(res).toMatchObject({ ok: false });
    expect(s3Send).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled(); // no job id/key pair worth patching
  });
});

describe('bucket', () => {
  it('ignores a caller-supplied bucket and uses its own TAKES_BUCKET', async () => {
    // The role can write anywhere in tamil-web-media; the event must not be able
    // to widen that to another bucket, so `bucket` is no longer read from it.
    s3Send.mockRejectedValueOnce(new Error('stop after the GET'));
    await handler({ jobId: 'j1', s3Key: 'audio/mastering/1_a_song.wav', target: -14, bucket: 'attacker-bucket' } as never);

    expect(s3Send).toHaveBeenCalled();
    const get = s3Send.mock.calls[0][0] as { input: { Bucket: string } };
    expect(get.input.Bucket).toBe('tamil-web-media');
  });
});

/**
 * The three passes, composed.
 *
 * Everything above tests the guards — the checks that run BEFORE ffmpeg. What
 * had no coverage at all was the part that actually masters: which pass each
 * recorded field comes from, and what the job looks like when a pass fails.
 * That is not an academic gap. Every one of the module's July defects lived
 * exactly here and survived a 3,000-test suite:
 *
 *   PR #76  the tone-preservation claim was printed unconditionally
 *   PR #79  `print_format=json` was missing from PASS 2, so the normalization
 *           type — the one thing only pass 2 knows — silently parsed as null
 *   PR #80  the readiness verdict ignored a leg it had already computed
 *
 * The parsers were well covered in isolation; nothing asserted that the worker
 * fed them the right log. So these tests are about PROVENANCE: pass 1 measures
 * the source, pass 2 reports what was DONE, pass 3 measures the output, and
 * mixing them up is how the module has been wrong before.
 */
describe('the mastering passes', () => {
  const SRC_KEY = 'audio/mastering/1_a_song.wav';

  /**
   * A realistic pass-1 log: input header, then the loudnorm JSON. It deliberately
   * carries an OUTPUT stream line reporting loudnorm's internal 192000 Hz working
   * rate — the trap parseSourceInfo exists to survive.
   */
  const PASS1 = `ffmpeg version 6.0
Input #0, wav, from '/tmp/master-test/in.wav':
  Duration: 00:06:05.30, bitrate: 1536 kb/s
  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 48000 Hz, stereo, s16, 1536 kb/s
Stream mapping:
  Stream #0:0 -> #0:0 (pcm_s16le (native) -> pcm_s16le (native))
Output #0, null, to 'pipe:':
  Stream #0:0: Audio: pcm_s16le, 192000 Hz, stereo, s32, 12288 kb/s
[Parsed_loudnorm_0 @ 0x55] 
{
\t"input_i" : "-14.35",
\t"input_tp" : "-3.53",
\t"input_lra" : "3.00",
\t"input_thresh" : "-24.62",
\t"normalization_type" : "linear",
\t"target_offset" : "0.11"
}
`;

  /**
   * Pass 2 reports `dynamic` while passes 1 and 3 say `linear`. That divergence
   * is the whole point: if the worker ever reads the type from the wrong pass,
   * this fixture makes it say "linear" for a master that was compressed —
   * precisely the false promise PR #79 was about.
   */
  const PASS2 = `[Parsed_loudnorm_0 @ 0x77] 
{
\t"input_i" : "-14.35",
\t"input_tp" : "-3.53",
\t"input_lra" : "3.00",
\t"input_thresh" : "-24.62",
\t"normalization_type" : "dynamic",
\t"target_offset" : "0.11"
}
`;

  const PASS3 = `[Parsed_loudnorm_0 @ 0x99] 
{
\t"input_i" : "-14.00",
\t"input_tp" : "-3.18",
\t"input_lra" : "2.10",
\t"input_thresh" : "-24.30",
\t"normalization_type" : "linear",
\t"target_offset" : "0.00"
}
`;

  const logs = { p1: PASS1, p2: PASS2, p3: PASS3, p1status: 0, p2status: 0, p3status: 0 };

  /** Which ffmpeg invocation is this? Measure passes render to null; pass 2 writes out.wav. */
  const dispatch = (args: string[]) => {
    const measuring = args.includes('null');
    if (!measuring) return { status: logs.p2status, stdout: '', stderr: logs.p2 };
    const input = args[args.indexOf('-i') + 1] ?? '';
    return input.includes('out.wav')
      ? { status: logs.p3status, stdout: '', stderr: logs.p3 }
      : { status: logs.p1status, stdout: '', stderr: logs.p1 };
  };

  const argsOf = (n: number) => spawnSync.mock.calls[n][1] as string[];
  const putCall = () =>
    s3Send.mock.calls.map((c) => c[0] as { input: Record<string, unknown> }).find((c) => 'Body' in c.input);

  beforeEach(() => {
    logs.p1 = PASS1; logs.p2 = PASS2; logs.p3 = PASS3;
    logs.p1status = 0; logs.p2status = 0; logs.p3status = 0;
    mockRmSync.mockClear();
    spawnSync.mockReset();
    spawnSync.mockImplementation((_bin: string, args: string[]) => dispatch(args));
    s3Send.mockReset();
    s3Send.mockImplementation((cmd: { input: Record<string, unknown> }) =>
      'Body' in cmd.input
        ? Promise.resolve({})
        : Promise.resolve({ Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } })
    );
  });

  it('masters a source end to end and writes the output beside it', async () => {
    const res = await handler({ jobId: 'j1', s3Key: SRC_KEY, target: -14 });

    expect(res).toEqual({ ok: true, masterKey: 'audio/mastering/1_a_song-master-14LUFS.wav' });
    expect(spawnSync).toHaveBeenCalledTimes(3);
    const put = putCall();
    expect(put?.input).toMatchObject({
      Bucket: 'tamil-web-media',
      Key: 'audio/mastering/1_a_song-master-14LUFS.wav',
      ContentType: 'audio/wav',
    });
    expect(patched()).toMatchObject({ status: 'done', target: -14 });
  });

  it('records the normalization type from PASS 2, not from pass 1 or 3', async () => {
    // The regression guard for PR #79. Passes 1 and 3 both say "linear" here;
    // only pass 2 knows a linear gain was refused. Reading either of the others
    // would promise tone preservation for a compressed master.
    await handler({ jobId: 'j1', s3Key: SRC_KEY, target: -14 });
    expect(patched().normalizationType).toBe('dynamic');
  });

  it('asks pass 2 for JSON, without which the type parses as null', async () => {
    await handler({ jobId: 'j1', s3Key: SRC_KEY, target: -14 });
    const pass2 = argsOf(1).join(' ');
    expect(pass2).toContain('print_format=json');
    expect(pass2).toContain('linear=true');
    expect(pass2).toContain('measured_I=-14.35');
    // and it must actually produce the 24-bit/48k WAV the report promises
    expect(argsOf(1)).toEqual(expect.arrayContaining(['-ar', '48000', '-c:a', 'pcm_s24le']));
  });

  it('takes beforeLra from the source and afterLra from the output', async () => {
    await handler({ jobId: 'j1', s3Key: SRC_KEY, target: -14 });
    const p = patched();
    expect(p.beforeLufs).toBe(-14.35);
    expect(p.beforeLra).toBe(3.0);   // pass 1 — the source
    expect(p.afterLufs).toBe(-14.0);
    expect(p.afterLra).toBe(2.1);    // pass 3 — the output
    expect(p.afterTp).toBe(-3.18);
  });

  /**
   * Records the SOURCE's format even though the same log also advertises
   * loudnorm's internal 192 kHz working rate further down.
   *
   * Deliberately named for the outcome, not the mechanism. Mutation-testing this
   * showed the `inputRegion` cut in parseSourceInfo is NOT solely load-bearing
   * for a log of this shape: ffmpeg prints the input header first and every
   * field regex takes the FIRST match, so removing the cut leaves all six fields
   * unchanged. The cut is a second lock, not the only one. Asserting it as "the
   * region cut works" would be a test that cannot fail for the stated reason.
   */
  it('records the source format, not the rate loudnorm reports downstream', async () => {
    await handler({ jobId: 'j1', s3Key: SRC_KEY, target: -14 });
    expect(patched().source).toMatchObject({
      codec: 'pcm_s16le',
      sampleRate: 48000,
      bitDepth: 16,
      channelLayout: 'stereo',
      durationSec: 365.3,
    });
  });

  it('measures pass 1 against the source and pass 3 against the written master', async () => {
    await handler({ jobId: 'j1', s3Key: SRC_KEY, target: -14 });
    expect(argsOf(0)[argsOf(0).indexOf('-i') + 1]).toContain('in.wav');
    expect(argsOf(2)[argsOf(2).indexOf('-i') + 1]).toContain('out.wav');
  });

  it('names the output for its target so -14 and -16 cannot overwrite each other', async () => {
    const res = await handler({ jobId: 'j1', s3Key: SRC_KEY, target: -16 });
    expect(res).toMatchObject({ masterKey: 'audio/mastering/1_a_song-master-16LUFS.wav' });
    expect(argsOf(0).join(' ')).toContain('I=-16');
  });

  describe('when a pass fails', () => {
    it('stops before writing anything if pass 1 yields no stats', async () => {
      logs.p1 = 'ffmpeg version 6.0\nno json here\n';
      const res = await handler({ jobId: 'j1', s3Key: SRC_KEY, target: -14 });

      expect(res).toEqual({ ok: false });
      expect(patched()).toMatchObject({ status: 'error', error: { code: 'pass1' } });
      expect(putCall()).toBeUndefined();
      expect(spawnSync).toHaveBeenCalledTimes(1);
    });

    it('stops before writing anything if pass 2 exits non-zero', async () => {
      logs.p2status = 1;
      const res = await handler({ jobId: 'j1', s3Key: SRC_KEY, target: -14 });

      expect(res).toEqual({ ok: false });
      expect(patched()).toMatchObject({ status: 'error', error: { code: 'pass2' } });
      expect(putCall()).toBeUndefined();
    });

    /**
     * Pass 3 is the CHECK, not the master. Losing it must not lose the file —
     * but it must also not let the job imply a measurement that never happened,
     * which is what streamingReadiness keys off to refuse a green tick.
     */
    it('still delivers the master when the check pass returns nothing, with nulls not guesses', async () => {
      logs.p3 = 'ffmpeg version 6.0\nno json here\n';
      const res = await handler({ jobId: 'j1', s3Key: SRC_KEY, target: -14 });

      expect(res).toMatchObject({ ok: true });
      expect(putCall()).toBeDefined();
      const p = patched();
      expect(p.status).toBe('done');
      expect(p.afterLufs).toBeNull();
      expect(p.afterTp).toBeNull();
      expect(p.afterLra).toBeNull();
      expect(p.beforeLufs).toBe(-14.35); // what WAS measured survives
    });

    it('marks the job failed and never half-writes when S3 read throws', async () => {
      s3Send.mockReset();
      s3Send.mockRejectedValue(new Error('AccessDenied'));
      const res = await handler({ jobId: 'j1', s3Key: SRC_KEY, target: -14 });

      expect(res).toEqual({ ok: false });
      expect(patched()).toMatchObject({ status: 'error', error: { code: 'exception' } });
    });
  });

  it('clears its temp directory on success and on failure', async () => {
    await handler({ jobId: 'j1', s3Key: SRC_KEY, target: -14 });
    expect(mockRmSync).toHaveBeenCalledWith('/tmp/master-test', { recursive: true, force: true });

    mockRmSync.mockClear();
    logs.p2status = 1;
    await handler({ jobId: 'j1', s3Key: SRC_KEY, target: -14 });
    expect(mockRmSync).toHaveBeenCalledWith('/tmp/master-test', { recursive: true, force: true });
  });
});
