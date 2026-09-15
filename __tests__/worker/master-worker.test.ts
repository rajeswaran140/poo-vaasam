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
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: (...a: unknown[]) => send(...a) }) },
  UpdateCommand: class { constructor(public input: Record<string, unknown>) {} },
  GetCommand: class { constructor(public input: Record<string, unknown>) {} },
}));

process.env.TAKES_BUCKET = 'tamil-web-media';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).fetch = (...a: unknown[]) => fetchMock(...a);

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

/**
 * The video render.
 *
 * Shares the Lambda (ffmpeg layer, bucket access) and NOTHING else with
 * mastering. The properties worth pinning are the ones whose failure is silent:
 * that it encodes the mastered WAV rather than the 192k MP3 sitting on the same
 * job, and that it never runs a loudness pass — a render that quietly
 * re-measured a finished master would rewrite numbers the operator has already
 * read and acted on.
 */
/**
 * Pre-master analysis.
 *
 * Read-only: it decodes a source and writes nothing but numbers. The property
 * worth pinning is that it stores MEASUREMENTS and never verdicts — the app
 * decides what a 4 LU tail drop means, so a threshold change ships with an
 * Amplify build instead of a Lambda redeploy. A worker that quietly started
 * storing "fading: true" would move that decision back behind a deploy.
 */
describe('source analysis', () => {
  const SRC = 'audio/mastering/1_a_song.wav';
  const PARTB = 'audio/mastering/1_b_partb.wav';
  const HEADER = `ffmpeg version 6.0
Input #0, wav, from '/tmp/a.wav':
  Duration: 00:04:00.00, bitrate: 1536 kb/s
  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 48000 Hz, stereo, s16, 1536 kb/s
`;
  const SILENCE = `[silencedetect @ 0x1] silence_start: 0
[silencedetect @ 0x1] silence_end: 2.5 | silence_duration: 2.5
[silencedetect @ 0x1] silence_start: 236
`;
  /** 25s of steady programme, then a clear fade in the final second. */
  const timeline = (tailLufs: number) => {
    const lines: string[] = [];
    let t = 0;
    for (let i = 0; i < 250; i++) { t += 0.1; lines.push(`[Parsed_ebur128_0 @ 0x1] t: ${t.toFixed(1)}  M: -18.0 S: -18 I: -17.5 LUFS  LRA: 4 LU`); }
    for (let i = 0; i < 10; i++) { t += 0.1; lines.push(`[Parsed_ebur128_0 @ 0x1] t: ${t.toFixed(1)}  M: ${tailLufs.toFixed(1)} S: -18 I: -17.5 LUFS  LRA: 4 LU`); }
    return lines.join('\n');
  };

  const NO_TRAILING = `[silencedetect @ 0x1] silence_start: 0
[silencedetect @ 0x1] silence_end: 2.5 | silence_duration: 2.5
`;
  const wire = (tailLufs = -18, silence = SILENCE) => {
    spawnSync.mockReset();
    spawnSync.mockImplementation((_b: string, args: string[]) => {
      const j = args.join(' ');
      if (j.includes('silencedetect')) return { status: 0, stdout: '', stderr: silence };
      if (j.includes('ebur128')) return { status: 0, stdout: '', stderr: timeline(tailLufs) };
      return { status: 0, stdout: '', stderr: HEADER }; // the probe
    });
    s3Send.mockReset();
    s3Send.mockImplementation((cmd: { input: Record<string, unknown> }) =>
      'Body' in cmd.input
        ? Promise.resolve({})
        : Promise.resolve({ Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } })
    );
  };

  it('stores measurements, never verdicts', async () => {
    wire(-30);
    const res = await handler({ analyse: { analysisId: 'an-1', s3Key: SRC } } as never);

    expect(res).toMatchObject({ ok: true });
    const p = patched();
    expect(p).toMatchObject({ status: 'done', leadingSilenceSec: 2.5, durationSec: 240 });
    expect(typeof p.tailDropLu).toBe('number');
    // The words belong to the app. A worker storing them would put the
    // threshold behind a Lambda redeploy.
    for (const word of ['fading', 'verdict', 'message', 'fadeState']) {
      expect(p).not.toHaveProperty(word);
    }
  });

  it('measures the tail drop rather than deciding about it', async () => {
    // No trailing silence here: the drop is about the MUSIC's shape, and a file
    // that ends in dead air is a trim problem measured separately.
    wire(-30, NO_TRAILING); // 12 LU below the body
    await handler({ analyse: { analysisId: 'an-1', s3Key: SRC } } as never);
    expect(patched().tailDropLu).toBeCloseTo(12, 1);

    send.mockClear();
    wire(-18.5, NO_TRAILING); // steady
    await handler({ analyse: { analysisId: 'an-2', s3Key: SRC } } as never);
    expect(patched().tailDropLu).toBeCloseTo(0.5, 1);
  });

  it('excludes trailing SILENCE from the tail measurement', async () => {
    // With dead air counted as music the drop looks enormous and the advice
    // flips from "trim this" to "re-roll the take".
    wire(-30); // fixture: 4s of trailing silence, timeline ends at 26s
    await handler({ analyse: { analysisId: 'an-1', s3Key: SRC } } as never);
    expect(patched().tailDropLu).toBeCloseTo(0, 1);
  });

  it('closes a trailing silence at the duration, not at the last log line', async () => {
    // silencedetect prints silence_start with no end when the file ends inside
    // it — the commonest case in a SUNO export.
    wire();
    await handler({ analyse: { analysisId: 'an-1', s3Key: SRC } } as never);
    expect(patched().trailingSilenceSec).toBe(4);
  });

  it('measures Part B too when one is given, and only then', async () => {
    wire();
    await handler({ analyse: { analysisId: 'an-1', s3Key: SRC, partBKey: PARTB } } as never);
    const gets = s3Send.mock.calls.map((c) => c[0] as { input: Record<string, unknown> })
      .filter((c) => !('Body' in c.input)).map((c) => c.input.Key);
    expect(gets).toEqual([SRC, PARTB]);
    expect(patched().partBIntegratedLufs).toBeCloseTo(-17.5, 1);

    wire();
    await handler({ analyse: { analysisId: 'an-2', s3Key: SRC } } as never);
    expect(patched().partBIntegratedLufs).toBeNull();
  });

  it('writes nothing to S3 — it is a read-only pass', async () => {
    wire();
    await handler({ analyse: { analysisId: 'an-1', s3Key: SRC } } as never);
    const puts = s3Send.mock.calls.map((c) => c[0] as { input: Record<string, unknown> }).filter((c) => 'Body' in c.input);
    expect(puts).toHaveLength(0);
  });

  it('refuses keys outside the workspace without reading anything', async () => {
    wire();
    for (const spec of [{ s3Key: 'audio/poem-music/amma.wav' }, { s3Key: SRC, partBKey: 'audio/poem-music/x.wav' }]) {
      s3Send.mockClear();
      const res = await handler({ analyse: { analysisId: 'an-1', ...spec } } as never);
      expect(res).toEqual({ ok: false });
      expect(patched()).toMatchObject({ status: 'error', error: { code: 'bad-key' } });
      expect(s3Send).not.toHaveBeenCalled();
    }
  });

  it('never runs a loudnorm pass — analysis must not master anything', async () => {
    wire();
    await handler({ analyse: { analysisId: 'an-1', s3Key: SRC } } as never);
    expect(spawnSync.mock.calls.every((c) => !(c[1] as string[]).join(' ').includes('loudnorm'))).toBe(true);
  });
});

describe('video render', () => {
  const AUDIO = 'audio/mastering/1_a_song-master-14LUFS.wav';
  const COVER = 'audio/mastering/1_c_cover.jpg';
  const render = (over: Record<string, unknown> = {}) => ({ audioKey: AUDIO, coverKey: COVER, height: 1440, ...over });
  const ffArgs = () => spawnSync.mock.calls.map((c) => c[1] as string[]);

  beforeEach(() => {
    spawnSync.mockReset();
    spawnSync.mockImplementation(() => ({ status: 0, stdout: '', stderr: '' }));
    s3Send.mockReset();
    s3Send.mockImplementation((cmd: { input: Record<string, unknown> }) =>
      'Body' in cmd.input
        ? Promise.resolve({})
        : Promise.resolve({ Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } })
    );
  });

  it('encodes the MASTERED WAV, never the 192k MP3', async () => {
    const res = await handler({ jobId: 'j1', render: render() } as never);

    expect(res).toMatchObject({ ok: true });
    // [0] probes the cover, [1] composes the frame, [2] encodes — the audio
    // only enters the last.
    const args = ffArgs()[2];
    expect(args[args.lastIndexOf('-i') + 1]).toContain('master.wav');
    expect(args.join(' ')).not.toContain('.mp3');
    expect(args[args.indexOf('-b:a') + 1]).toBe('384k');
  });

  /**
   * ⚠️ TWO ffmpeg passes, and the ORDER matters. Composing the cover into a
   * single frame first is what keeps the render inside the 900 s timeout —
   * measured at ~43 min for a 5:32 song when the filter ran per-frame. A
   * regression here does not throw; the Lambda is simply killed.
   */
  it('composes the frame once, THEN encodes against it', async () => {
    await handler({ jobId: 'j1', render: render() } as never);

    expect(spawnSync).toHaveBeenCalledTimes(3);
    const [probe, compose, encode] = ffArgs();

    // Pass 0: reads the cover's header only — no filter, no frame output.
    expect(probe).toContain('-i');
    expect(probe).not.toContain('-filter_complex');

    // Pass 1: filters the cover, emits exactly one frame, touches no audio.
    expect(compose).toContain('-filter_complex');
    expect(compose[compose.indexOf('-frames:v') + 1]).toBe('1');
    expect(compose.join(' ')).not.toContain('master.wav');

    // Pass 2: no filter at all — that absence IS the fix.
    expect(encode).not.toContain('-filter_complex');
    expect(encode.join(' ')).not.toContain('boxblur');
    // It must consume the frame pass 1 produced, not the raw cover.
    expect(encode.join(' ')).toContain('frame.png');
    expect(encode.join(' ')).not.toContain('cover.jpg');
  });

  it('runs NO loudness pass and rewrites no measurement', async () => {
    await handler({ jobId: 'j1', render: render() } as never);

    expect(ffArgs().join(' ')).not.toContain('loudnorm');
    const p = patched();
    for (const field of ['afterLufs', 'afterTp', 'beforeLufs', 'normalizationType', 'status']) {
      expect(p).not.toHaveProperty(field);
    }
  });

  it('fetches both inputs and stores the MP4 beside the master', async () => {
    await handler({ jobId: 'j1', render: render() } as never);

    const gets = s3Send.mock.calls
      .map((c) => c[0] as { input: Record<string, unknown> })
      .filter((c) => !('Body' in c.input)).map((c) => c.input.Key);
    expect(gets).toEqual([AUDIO, COVER]);

    const put = s3Send.mock.calls
      .map((c) => c[0] as { input: Record<string, unknown> })
      .find((c) => 'Body' in c.input);
    expect(put?.input).toMatchObject({
      Bucket: 'tamil-web-media',
      Key: 'audio/mastering/1_a_song-master-14LUFS-1440p.mp4',
      ContentType: 'video/mp4',
    });
    expect(patched()).toMatchObject({ videoKey: 'audio/mastering/1_a_song-master-14LUFS-1440p.mp4', coverKey: COVER });
  });

  it('records the cover, so a re-render is reproducible', async () => {
    await handler({ jobId: 'j1', render: render() } as never);
    expect(patched().coverKey).toBe(COVER);
    expect(typeof patched().videoRenderedAt).toBe('string');
  });

  describe('refusals never touch S3', () => {
    it.each([
      ['a source outside the workspace', { audioKey: 'audio/poem-music/amma.wav' }],
      ['a source that is not a master', { audioKey: 'audio/mastering/1_a_song.wav' }],
      ['a cover outside the workspace', { coverKey: 'images/song-covers/x.png' }],
      ['an unoffered height', { height: 720 }],
    ])('%s', async (_label, over) => {
      const res = await handler({ jobId: 'j1', render: render(over) } as never);

      expect(res).toEqual({ ok: false });
      expect(patched().videoError).toBeTruthy();
      expect(s3Send).not.toHaveBeenCalled();
      expect(spawnSync).not.toHaveBeenCalled();
    });
  });

  it('records the failure and leaves the master alone when ffmpeg fails', async () => {
    // The WAV was already delivered; losing a finished master to a failed
    // picture render would be absurd.
    spawnSync.mockImplementation(() => ({ status: 1, stdout: '', stderr: 'x264 died' }));
    const res = await handler({ jobId: 'j1', render: render() } as never);

    expect(res).toEqual({ ok: false });
    expect(patched().videoError).toBeTruthy();
    expect(patched()).not.toHaveProperty('videoKey');
    const put = s3Send.mock.calls
      .map((c) => c[0] as { input: Record<string, unknown> })
      .find((c) => 'Body' in c.input);
    expect(put).toBeUndefined();
  });

  it('clears its temp directory on success and on failure', async () => {
    mockRmSync.mockClear();
    await handler({ jobId: 'j1', render: render() } as never);
    expect(mockRmSync).toHaveBeenCalledWith('/tmp/master-test', { recursive: true, force: true });

    mockRmSync.mockClear();
    spawnSync.mockImplementation(() => ({ status: 1, stdout: '', stderr: '' }));
    await handler({ jobId: 'j1', render: render() } as never);
    expect(mockRmSync).toHaveBeenCalledWith('/tmp/master-test', { recursive: true, force: true });
  });

  /**
   * probeCoverAspect() feeds buildVideoFilter() — this is the whole point of
   * Task 1 + Task 2, and until now nothing pinned that the wiring actually
   * fires the fill branch on a real 16:9 probe result. Every other test in
   * this suite mocks spawnSync unconditionally, so the probe call always saw
   * an empty log and buildVideoFilter always took the backdrop branch.
   *
   * The probe call is distinguished from compose/encode by shape: it is
   * exactly `['-hide_banner', '-i', coverPath]` — nothing else in renderVideo
   * calls ffmpeg with that signature.
   */
  describe('the cover probe result reaches buildVideoFilter', () => {
    const isProbeCall = (args: string[]) =>
      args.length === 3 && args[0] === '-hide_banner' && args[1] === '-i';

    /** Only the probe call returns `header`; compose and encode still succeed. */
    const mockProbeHeader = (header: string) => {
      spawnSync.mockImplementation((_cmd: string, args: string[]) =>
        isProbeCall(args)
          ? { status: 1, stdout: '', stderr: header }
          : { status: 0, stdout: '', stderr: '' }
      );
    };

    const composeFilter = () => {
      const [, compose] = ffArgs();
      return compose[compose.indexOf('-filter_complex') + 1];
    };

    it('a 16:9 cover fills the frame: crop to the full frame, no blurred backdrop', async () => {
      mockProbeHeader('Stream #0:0: Video: png, rgb24, 1672x941 [SAR 1:1 DAR 1672:941]');
      const res = await handler({ jobId: 'j1', render: render() } as never);

      expect(res).toMatchObject({ ok: true });
      const filter = composeFilter();
      expect(filter).toContain('crop=2560:1440');
      expect(filter).not.toContain('boxblur');
    });

    it('a square cover uses the blurred backdrop', async () => {
      mockProbeHeader('Stream #0:0: Video: png, rgb24, 1000x1000 [SAR 1:1 DAR 1:1]');
      await handler({ jobId: 'j1', render: render() } as never);

      expect(composeFilter()).toContain('boxblur');
    });

    it('an unreadable header falls back to the blurred backdrop, not a guessed 16:9', async () => {
      mockProbeHeader('no recognizable stream info here');
      await handler({ jobId: 'j1', render: render() } as never);

      expect(composeFilter()).toContain('boxblur');
    });

    /**
     * The dangerous case Finding 2 is about: a camera JPEG can print an
     * embedded EXIF/MPF thumbnail as its OWN "Video:" line, before the real
     * image's line. A first-match read would probe the thumbnail instead of
     * the cover. Here the SMALLER (first) stream is square — if it won, the
     * backdrop branch would fire — and the LARGER (second) stream is 16:9.
     * Largest-by-area must win, so the fill branch must fire.
     */
    it('an embedded thumbnail does not fool the probe — the largest stream wins', async () => {
      mockProbeHeader(
        'Stream #0:0: Video: mjpeg, yuvj420p, 160x160 [SAR 1:1 DAR 1:1], 90k tbr\n' +
        'Stream #0:1: Video: mjpeg, yuvj420p, 1672x941 [SAR 1:1 DAR 1672:941], 25 tbr'
      );
      await handler({ jobId: 'j1', render: render() } as never);

      const filter = composeFilter();
      expect(filter).toContain('crop=2560:1440');
      expect(filter).not.toContain('boxblur');
    });
  });
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

  /**
   * Pass 4 measures the ENCODED MP3, and its numbers deliberately match no other
   * pass. If the worker ever records the master's peak (pass 3, -3.18) or the
   * source's (pass 1, -3.53) as the MP3's, this fixture makes that visible —
   * the MP3 check exists precisely because nothing else measures the delivered
   * file, so silently reusing another pass's figure would be worse than not
   * measuring at all.
   */
  const PASS4 = `[Parsed_loudnorm_0 @ 0xaa]
{
\t"input_i" : "-13.90",
\t"input_tp" : "-2.95",
\t"input_lra" : "2.10",
\t"input_thresh" : "-24.10",
\t"normalization_type" : "linear",
\t"target_offset" : "0.00"
}
`;

  const logs = {
    p1: PASS1, p2: PASS2, p3: PASS3, p4: PASS4,
    p1status: 0, p2status: 0, p3status: 0, encodeStatus: 0,
  };

  /**
   * Which ffmpeg invocation is this? Measure passes render to null; pass 2
   * writes out.wav; the MP3 encode writes out.mp3 and is told apart by its
   * codec flag rather than by elimination, so adding another writing pass
   * cannot quietly reroute it here.
   */
  const dispatch = (args: string[]) => {
    // The source probe: the only call with neither a filter nor an output. It
    // must answer with a real header — an edit whose duration cannot be read is
    // refused before ffmpeg ever runs, so a headerless fixture would make every
    // edit test exercise the refusal path instead of the pre-pass.
    if (!args.includes('-af') && !args.includes('null') && !args.includes('libmp3lame')) {
      return { status: 0, stdout: '', stderr: PASS1 };
    }
    const measuring = args.includes('null');
    if (!measuring) {
      return args.includes('libmp3lame')
        ? { status: logs.encodeStatus, stdout: '', stderr: '' }
        : { status: logs.p2status, stdout: '', stderr: logs.p2 };
    }
    const input = args[args.indexOf('-i') + 1] ?? '';
    if (input.includes('out.mp3')) return { status: 0, stdout: '', stderr: logs.p4 };
    return input.includes('out.wav')
      ? { status: logs.p3status, stdout: '', stderr: logs.p3 }
      : { status: logs.p1status, stdout: '', stderr: logs.p1 };
  };

  const argsOf = (n: number) => spawnSync.mock.calls[n][1] as string[];
  const putCalls = () =>
    s3Send.mock.calls
      .map((c) => c[0] as { input: Record<string, unknown> })
      .filter((c) => 'Body' in c.input);
  /** The WAV master put — the first and primary write. */
  const putCall = () => putCalls().find((c) => String(c.input.Key).endsWith('.wav'));
  const mp3Put = () => putCalls().find((c) => String(c.input.Key).endsWith('.mp3'));

  beforeEach(() => {
    logs.p1 = PASS1; logs.p2 = PASS2; logs.p3 = PASS3; logs.p4 = PASS4;
    logs.p1status = 0; logs.p2status = 0; logs.p3status = 0; logs.encodeStatus = 0;
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
    // measure · master · re-measure · encode MP3 · measure MP3
    expect(spawnSync).toHaveBeenCalledTimes(5);
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

  /**
   * The trim/fade pre-pass, and the property that makes its copy honest.
   *
   * The Studio promises "applied before loudness normalisation, so the master
   * still lands exactly on target". That holds ONLY if the measurement pass
   * sees the edited audio. Measure the whole file, render a trimmed region, and
   * the measured LUFS describes something that was never rendered — trimming a
   * long quiet intro would push the master 1-3 LU hot, silently, with an
   * on-target number displayed beside it.
   *
   * The worker gets this right by rendering the edit to an intermediate and
   * pointing BOTH loudnorm passes at that file. NOTHING ASSERTED IT until an
   * external audit raised it (2026-08-04) — the same shape as every other
   * defect this module has shipped: correct-looking code, untested composition.
   */
  describe('the trim/fade pre-pass', () => {
    const EDIT = { trimStartSec: 12, trimEndSec: 200, fadeInSec: 0, fadeOutSec: 4, curve: 'qsin' as const };

    // Located by CONTENT, not call index: an edit adds a source probe ahead of
    // the pre-pass, so positions shift. The property is about which FILE each
    // pass reads, which is what these read off.
    const ffCalls = () => spawnSync.mock.calls.map((c) => c[1] as string[]);
    const inputOf = (a: string[]) => a[a.indexOf('-i') + 1] ?? '';
    const preCall = () => ffCalls().find((a) => a.join(' ').includes('atrim'));
    /** Pass 2 — the only call that writes the master. */
    const renderCall = () => ffCalls().find((a) => a[a.length - 1].endsWith('out.wav'));
    /** Pass 1 — measures a source, never the finished master. */
    const measureCall = () =>
      ffCalls().find((a) => a.includes('null') && !inputOf(a).includes('out.'));

    it('measures the EDITED audio, not the original', async () => {
      await handler({ jobId: 'j1', s3Key: SRC_KEY, target: -14, edit: EDIT } as never);

      expect(preCall()?.join(' ')).toContain('atrim=start=12');
      expect(preCall()?.[preCall()!.length - 1]).toContain('edited.wav');

      const measured = inputOf(measureCall()!);
      const rendered = inputOf(renderCall()!);
      expect(measured).toContain('edited.wav');
      // THE property: measurement and render read the same file. If they ever
      // diverge, the LUFS on screen describes audio nobody shipped.
      expect(measured).toBe(rendered);
    });

    it('renders the intermediate in 32-bit float, so fades are not quantised twice', async () => {
      await handler({ jobId: 'j1', s3Key: SRC_KEY, target: -14, edit: EDIT } as never);
      expect(preCall()).toEqual(expect.arrayContaining(['-c:a', 'pcm_f32le']));
    });

    it('skips the pre-pass entirely for a no-op edit', async () => {
      // A pointless decode/encode of a 70 MB WAV, and a second chance to alter
      // audio that was supposed to be untouched.
      await handler({
        jobId: 'j1', s3Key: SRC_KEY, target: -14,
        edit: { trimStartSec: 0, trimEndSec: null, fadeInSec: 0, fadeOutSec: 0, curve: 'qsin' },
      } as never);
      expect(preCall()).toBeUndefined();
      expect(inputOf(measureCall()!)).toContain('in.wav');
    });

    it('fails the job when the edit cannot be applied, before any S3 write', async () => {
      logs.encodeStatus = 0;
      spawnSync.mockImplementation((_b: string, args: string[]) =>
        args.includes('atrim=start=12:end=200') || args.join(' ').includes('atrim')
          ? { status: 1, stdout: '', stderr: 'trim failed' }
          : dispatch(args)
      );
      const res = await handler({ jobId: 'j1', s3Key: SRC_KEY, target: -14, edit: EDIT } as never);

      expect(res).toEqual({ ok: false });
      expect(patched()).toMatchObject({ status: 'error', error: { code: 'pass0' } });
      expect(putCall()).toBeUndefined();
    });
  });

  /**
   * Two-part assembly.
   *
   * The reason the join lives in the pre-pass is ordering: splice first, master
   * the assembled song ONCE. Mastering two halves separately and crossfading
   * afterwards leaves neither on target, because integrated loudness is an
   * average over a programme. So the property these pin is the same one the
   * edit pre-pass has — every measurement downstream must read the ASSEMBLED
   * file, not either source.
   */
  describe('the crossfade join', () => {
    const PART_B = 'audio/mastering/1_b_partb.wav';
    const JOIN = { partBKey: PART_B, overlapSec: 3, curve: 'qsin' as const, editB: null };
    const ffCalls = () => spawnSync.mock.calls.map((c) => c[1] as string[]);
    const inputOf = (a: string[]) => a[a.indexOf('-i') + 1] ?? '';
    const graphCall = () => ffCalls().find((a) => a.includes('-filter_complex'));
    const graphOf = () => graphCall()?.[graphCall()!.indexOf('-filter_complex') + 1] ?? '';
    const measureCall = () =>
      ffCalls().find((a) => a.includes('null') && !inputOf(a).includes('out.'));
    const renderCall = () => ffCalls().find((a) => a[a.length - 1].endsWith('out.wav'));

    it('fetches BOTH parts and crossfades them into one intermediate', async () => {
      const res = await handler({ jobId: 'j1', s3Key: SRC_KEY, target: -14, join: JOIN } as never);

      expect(res).toMatchObject({ ok: true });
      const gets = s3Send.mock.calls
        .map((c) => c[0] as { input: Record<string, unknown> })
        .filter((c) => !('Body' in c.input))
        .map((c) => c.input.Key);
      expect(gets).toEqual([SRC_KEY, PART_B]);

      expect(graphOf()).toContain('acrossfade=d=3:c1=qsin:c2=qsin');
      expect(graphCall()?.[graphCall()!.length - 1]).toContain('edited.wav');
    });

    it('measures and masters the ASSEMBLED file, never either source', async () => {
      await handler({ jobId: 'j1', s3Key: SRC_KEY, target: -14, join: JOIN } as never);

      const measured = inputOf(measureCall()!);
      const rendered = inputOf(renderCall()!);
      expect(measured).toContain('edited.wav');
      expect(measured).toBe(rendered);
      // Neither loudnorm pass may read a raw part — that is the whole reason the
      // join happens here rather than after mastering.
      expect(measured).not.toContain('in-b.wav');
    });

    it('keeps Part A as input 0 and Part B as input 1', async () => {
      // Reversed, this crossfades B's tail into A's head and still produces a
      // plausible file that masters perfectly cleanly.
      await handler({ jobId: 'j1', s3Key: SRC_KEY, target: -14, join: JOIN } as never);
      const args = graphCall()!;
      const inputs = args.reduce<string[]>((acc, a, i) => (a === '-i' ? [...acc, args[i + 1]] : acc), []);
      expect(inputs[0]).toContain('in.wav');
      expect(inputs[1]).toContain('in-b.wav');
    });

    it('renders the seam in 32-bit float', async () => {
      // A crossfade multiplies both sides by fractional gains; an integer
      // intermediate quantises every sample of the seam before mastering starts.
      await handler({ jobId: 'j1', s3Key: SRC_KEY, target: -14, join: JOIN } as never);
      expect(graphCall()).toEqual(expect.arrayContaining(['-c:a', 'pcm_f32le']));
    });

    it('records the seam on the job, and the ASSEMBLED duration', async () => {
      await handler({ jobId: 'j1', s3Key: SRC_KEY, target: -14, join: JOIN } as never);
      const p = patched();
      expect(p.join).toMatchObject({ partBKey: PART_B, overlapSec: 3, curve: 'qsin' });
      // The fixture header says 365.3s for both parts: 365.3 + 365.3 - 3.
      expect(p.editedDurationSec).toBeCloseTo(727.6, 1);
    });

    it('refuses a Part B outside the mastering workspace, without reading it', async () => {
      // The join field must not become a second, unchecked way to point the
      // worker at any object in the bucket.
      const res = await handler({
        jobId: 'j1', s3Key: SRC_KEY, target: -14,
        join: { ...JOIN, partBKey: 'audio/poem-music/amma.mp3' },
      } as never);

      expect(res).toEqual({ ok: false });
      expect(patched()).toMatchObject({ error: { code: 'bad-join-key' } });
      expect(s3Send).not.toHaveBeenCalled();
      expect(spawnSync).not.toHaveBeenCalled();
    });

    it('refuses one of its own mastering outputs as Part B', async () => {
      const res = await handler({
        jobId: 'j1', s3Key: SRC_KEY, target: -14,
        join: { ...JOIN, partBKey: 'audio/mastering/1_a_song-master-14LUFS.wav' },
      } as never);
      expect(res).toEqual({ ok: false });
      expect(patched()).toMatchObject({ error: { code: 'bad-join-key' } });
      expect(s3Send).not.toHaveBeenCalled();
    });

    it('refuses an overlap longer than a part, before spending a render', async () => {
      // Fixture parts are 365.3s each.
      const res = await handler({
        jobId: 'j1', s3Key: SRC_KEY, target: -14,
        join: { ...JOIN, overlapSec: 3, editB: { trimStartSec: 364, trimEndSec: null, fadeInSec: 0, fadeOutSec: 0, curve: 'qsin' } },
      } as never);

      expect(res).toEqual({ ok: false });
      expect(patched()).toMatchObject({ status: 'error', error: { code: 'bad-join' } });
      expect(putCall()).toBeUndefined();
    });

    it('fails the job when the crossfade render fails, before any S3 write', async () => {
      spawnSync.mockImplementation((_b: string, args: string[]) =>
        args.includes('-filter_complex')
          ? { status: 1, stdout: '', stderr: 'acrossfade failed' }
          : dispatch(args)
      );
      const res = await handler({ jobId: 'j1', s3Key: SRC_KEY, target: -14, join: JOIN } as never);

      expect(res).toEqual({ ok: false });
      expect(patched()).toMatchObject({ status: 'error', error: { code: 'pass0' } });
      expect(putCall()).toBeUndefined();
    });

    it('leaves a single-source master completely untouched', async () => {
      // The regression that matters most: the join is additive, so a job with no
      // join must produce exactly the run it always did.
      await handler({ jobId: 'j1', s3Key: SRC_KEY, target: -14 });
      expect(graphCall()).toBeUndefined();
      expect(spawnSync).toHaveBeenCalledTimes(5);
      expect(patched().join).toBeNull();
    });
  });

  /**
   * The web MP3 export.
   *
   * This is the only artifact in the module that listeners actually receive, and
   * until now nothing measured it — the 2026-07-24 sweep found 2 of 17 served
   * MP3s above the -1 dBTP ceiling. Two properties matter and neither is
   * self-evident from reading the handler: the encode reads the MASTER (encoding
   * the source would ship an unmastered file under a mastered name), and every
   * MP3 field is best-effort — the WAV is the deliverable, so no MP3 failure may
   * cost the operator a master they waited 15 minutes for.
   */
  describe('the web MP3 export', () => {
    it('encodes from the MASTER, not from the source', async () => {
      await handler({ jobId: 'j1', s3Key: SRC_KEY, target: -14 });
      const encode = argsOf(3);
      expect(encode[encode.indexOf('-i') + 1]).toContain('out.wav');
      expect(encode[encode.indexOf('-i') + 1]).not.toContain('in.wav');
      expect(encode).toContain('libmp3lame');
      expect(encode[encode.indexOf('-b:a') + 1]).toBe('192k');
    });

    it('stores it beside the master, as audio/mpeg', async () => {
      await handler({ jobId: 'j1', s3Key: SRC_KEY, target: -14 });
      expect(mp3Put()?.input).toMatchObject({
        Bucket: 'tamil-web-media',
        Key: 'audio/mastering/1_a_song-master-14LUFS.mp3',
        ContentType: 'audio/mpeg',
      });
      expect(patched().mp3Key).toBe('audio/mastering/1_a_song-master-14LUFS.mp3');
    });

    it('records the MP3\'s OWN measurement, not the master\'s and not the source\'s', async () => {
      // The whole point of the pass. Pass 3 read -3.18 dBTP off the master and
      // pass 1 read -3.53 off the source; copying either would report a peak for
      // a file nobody measured, while looking perfectly plausible.
      await handler({ jobId: 'j1', s3Key: SRC_KEY, target: -14 });
      const p = patched();
      expect(p.mp3Lufs).toBe(-13.9);
      expect(p.mp3Tp).toBe(-2.95);
      expect(p.afterTp).toBe(-3.18);
      const measure = argsOf(4);
      expect(measure[measure.indexOf('-i') + 1]).toContain('out.mp3');
    });

    it('delivers the master anyway when the encode fails, with no MP3 claimed', async () => {
      logs.encodeStatus = 1;
      const res = await handler({ jobId: 'j1', s3Key: SRC_KEY, target: -14 });

      expect(res).toMatchObject({ ok: true, masterKey: 'audio/mastering/1_a_song-master-14LUFS.wav' });
      expect(putCall()).toBeDefined();      // the WAV still shipped
      expect(mp3Put()).toBeUndefined();     // nothing half-written
      expect(spawnSync).toHaveBeenCalledTimes(4); // no point measuring a file that failed to encode
      const p = patched();
      expect(p.status).toBe('done');
      expect(p.mp3Key).toBeNull();
      expect(p.mp3Lufs).toBeNull();
      expect(p.mp3Tp).toBeNull();
    });

    it('records no peak for an MP3 that was never stored', async () => {
      // The figures used to be assigned BEFORE the PutObject. When the upload
      // threw, mp3Key was nulled but mp3Lufs/mp3Tp survived — a measurement on
      // the job describing a file that does not exist in the bucket. Nothing
      // rendered it (the Studio keys off mp3Key), which is exactly why it would
      // have gone unnoticed until some later consumer trusted it.
      let bodies = 0;
      s3Send.mockReset();
      s3Send.mockImplementation((cmd: { input: Record<string, unknown> }) => {
        if (!('Body' in cmd.input)) {
          return Promise.resolve({ Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } });
        }
        bodies += 1;
        return bodies === 1 ? Promise.resolve({}) : Promise.reject(new Error('AccessDenied'));
      });

      const res = await handler({ jobId: 'j1', s3Key: SRC_KEY, target: -14 });

      expect(res).toMatchObject({ ok: true });
      const p = patched();
      expect(p.status).toBe('done');
      expect(p.mp3Key).toBeNull();
      expect(p.mp3Lufs).toBeNull();
      expect(p.mp3Tp).toBeNull();
    });

    it('still ships the MP3 when it cannot be measured, with null figures', async () => {
      // A missing measurement must not withhold the file; the verdict reads
      // "unverified" from the nulls rather than assuming it is safe.
      logs.p4 = 'ffmpeg version 6.0\nno json here\n';
      await handler({ jobId: 'j1', s3Key: SRC_KEY, target: -14 });

      expect(mp3Put()).toBeDefined();
      const p = patched();
      expect(p.mp3Key).toBe('audio/mastering/1_a_song-master-14LUFS.mp3');
      expect(p.mp3Lufs).toBeNull();
      expect(p.mp3Tp).toBeNull();
    });
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

/**
 * The YouTube upload.
 *
 * ⚠️ THE PROPERTY THAT MATTERS MOST: this function may only ever write to the
 * video its OWN `videos.insert` just created. thumbnails.set and every
 * playlistItems.insert must carry exactly the id that came back from that
 * insert — never the job's pre-existing `youtubeVideoId`, never anything off
 * the event. And when `planUpload` refuses because the job already has a
 * `youtubeVideoId`, the whole operation must stop: no insert, no thumbnail,
 * no playlist call, no network activity at all.
 */
describe('youtube upload', () => {
  const YT = {
    title: 'A song title',
    description: 'A description of the song.',
    tags: ['tamil', 'poem'],
    playlistIds: ['PL_ONE', 'PL_TWO'],
  };

  let job: Record<string, unknown>;

  beforeEach(() => {
    job = {
      id: 'j1',
      videoKey: 'audio/mastering/1_a_song-master-14LUFS-1440p.mp4',
      savedAt: '2026-09-01T00:00:00.000Z',
      coverKey: 'audio/mastering/1_c_cover.jpg',
      youtubeVideoId: null,
      uploadStatus: 'idle',
      uploadSessionUri: null,
    };

    send.mockReset();
    send.mockImplementation((cmd: { input: Record<string, unknown> }) =>
      'UpdateExpression' in cmd.input
        ? Promise.resolve({})
        : Promise.resolve({ Item: job })
    );
    s3Send.mockReset();
    s3Send.mockImplementation((cmd: { input: Record<string, unknown> }) =>
      'Body' in cmd.input
        ? Promise.resolve({})
        : Promise.resolve({ Body: { transformToByteArray: async () => new Uint8Array([9, 9, 9]) } })
    );
    ssmSend.mockReset();
    ssmSend.mockResolvedValue({ Parameter: { Value: 'shhh' } });
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return Promise.resolve({ ok: true, json: async () => ({ access_token: 'ACCESS-TOKEN' }) });
      }
      if (url.includes('uploadType=resumable')) {
        return Promise.resolve({
          ok: true,
          headers: { get: (k: string) => (k === 'location' ? 'https://upload.example/session-abc' : null) },
        });
      }
      if (url === 'https://upload.example/session-abc') {
        // The id ONLY this response may ever produce — see the describe block
        // comment. It must never match anything already sitting on the job.
        return Promise.resolve({ ok: true, json: async () => ({ id: 'FRESH_INSERT_ID' }) });
      }
      if (url.includes('/thumbnails/set')) {
        return Promise.resolve({ ok: true });
      }
      if (url.includes('/playlistItems')) {
        return Promise.resolve({ ok: true });
      }
      return Promise.resolve({ ok: false, status: 500, text: async () => '' });
    });
    process.env.YOUTUBE_OAUTH_CLIENT_ID = 'test-client-id';
  });

  it('uses ONLY the freshly inserted id for the thumbnail and every playlist call', async () => {
    // A decoy id riding along on the event, shaped like something a careless
    // future refactor might reach for instead of the insert response. The
    // event type carries no such field — this asserts the extra property is
    // simply ignored, not merely absent.
    const res = await handler({ jobId: 'j1', youtube: { ...YT, videoId: 'DECOY_FROM_EVENT' } } as never);

    expect(res).toMatchObject({ ok: true, videoId: 'FRESH_INSERT_ID' });

    const thumbCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/thumbnails/set'));
    expect(thumbCall).toBeDefined();
    expect(String(thumbCall![0])).toContain('videoId=FRESH_INSERT_ID');

    const playlistCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/playlistItems'));
    expect(playlistCalls).toHaveLength(2);
    for (const call of playlistCalls) {
      const body = JSON.parse((call[1] as { body: string }).body);
      // Not job.youtubeVideoId (null here), not anything from the event —
      // exactly the id this run's own insert returned.
      expect(body.snippet.resourceId.videoId).toBe('FRESH_INSERT_ID');
    }

    // The cover is job.coverKey's own '1_c_cover.jpg' — a hardcoded
    // 'image/png' Content-Type would silently fail this call (finding 5).
    const thumbHeaders = (thumbCall![1] as { headers: Record<string, string> }).headers;
    expect(thumbHeaders['Content-Type']).toBe('image/jpeg');

    expect(patched()).toMatchObject({ uploadStatus: 'uploaded', youtubeVideoId: 'FRESH_INSERT_ID' });
  });

  it('writes youtubeVideoId the moment the insert returns, before the thumbnail or playlists', async () => {
    await handler({ jobId: 'j1', youtube: YT } as never);

    const idWriteIndex = send.mock.calls.findIndex((c) => {
      const values = (c[0] as { input: { ExpressionAttributeValues?: Record<string, unknown> } }).input
        .ExpressionAttributeValues;
      return values?.[':youtubeVideoId'] === 'FRESH_INSERT_ID';
    });
    const thumbIndex = fetchMock.mock.calls.findIndex((c) => String(c[0]).includes('/thumbnails/set'));

    expect(idWriteIndex).toBeGreaterThan(-1);
    expect(thumbIndex).toBeGreaterThan(-1);
    // jest.fn() stamps every call across every mock with a shared, monotonic
    // invocationCallOrder — this is the one reliable way to compare "when" two
    // calls on DIFFERENT mocks happened relative to each other.
    expect(send.mock.invocationCallOrder[idWriteIndex]).toBeLessThan(
      fetchMock.mock.invocationCallOrder[thumbIndex],
    );
  });

  it('stops entirely when the job already has a youtubeVideoId — no insert, no thumbnail, no playlist call', async () => {
    job.youtubeVideoId = 'EXISTING_LIVE_VIDEO_ID';

    const res = await handler({ jobId: 'j1', youtube: YT } as never);

    expect(res).toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
    // ⚠️ A refusal must NEVER overwrite a terminal 'uploaded' state as
    // 'failed' — that is what invites an operator to clear youtubeVideoId by
    // hand to "retry" a job whose video is already live, producing exactly
    // the duplicate this file exists to prevent.
    const p = patched();
    expect(p.uploadStatus).toBe('uploaded');
    expect(String(p.uploadError)).toContain('already');
    expect(p.youtubeVideoId).toBeUndefined();
  });

  it('marks the upload uploaded-with-a-note, never failed, when the thumbnail rejects', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return Promise.resolve({ ok: true, json: async () => ({ access_token: 'ACCESS-TOKEN' }) });
      }
      if (url.includes('uploadType=resumable')) {
        return Promise.resolve({
          ok: true,
          headers: { get: (k: string) => (k === 'location' ? 'https://upload.example/session-abc' : null) },
        });
      }
      if (url === 'https://upload.example/session-abc') {
        return Promise.resolve({ ok: true, json: async () => ({ id: 'FRESH_INSERT_ID' }) });
      }
      if (url.includes('/thumbnails/set')) {
        return Promise.resolve({ ok: false, status: 400, text: async () => 'bad thumbnail' });
      }
      return Promise.resolve({ ok: true });
    });

    const res = await handler({ jobId: 'j1', youtube: YT } as never);

    expect(res).toMatchObject({ ok: true, videoId: 'FRESH_INSERT_ID' });
    const p = patched();
    expect(p.uploadStatus).toBe('uploaded');
    expect(p.youtubeVideoId).toBe('FRESH_INSERT_ID');
    expect(String(p.uploadError)).toContain('thumbnail');
  });

  /**
   * Resuming an existing session.
   *
   * `grep uploadSessionUri __tests__/worker/master-worker.test.ts` used to
   * hit exactly one `null` fixture — the resume branch (`job.uploadSessionUri
   * ?? null`) had NOTHING behind it. A refactor that dropped it would open a
   * fresh `videos.insert` on every retry — a second video on the channel to
   * find and delete by hand — and all other suites would stay green. These
   * pin the actual resumable-upload protocol: query first, never a bare
   * re-PUT (see `uploadToYoutube`'s doc comment for why a bare re-PUT cannot
   * tell "still uploading" apart from "already finished").
   */
  describe('resuming an existing session', () => {
    const EXISTING_SESSION = 'https://upload.example/existing-session-777';

    beforeEach(() => {
      job.uploadSessionUri = EXISTING_SESSION;
    });

    it('queries the stored session and NEVER opens a new one — the resume, pinned', async () => {
      fetchMock.mockImplementation((url: string, init?: { body?: unknown }) => {
        if (url.includes('oauth2.googleapis.com/token')) {
          return Promise.resolve({ ok: true, json: async () => ({ access_token: 'ACCESS-TOKEN' }) });
        }
        if (url === EXISTING_SESSION) {
          // The query carries no body; the resumed data PUT does — that is
          // how this fixture tells the two apart, exactly as the real fetch
          // calls differ.
          if (!init?.body) return Promise.resolve({ status: 308, ok: false, headers: { get: () => null } });
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: 'RESUMED_INSERT_ID' }) });
        }
        if (url.includes('/thumbnails/set')) return Promise.resolve({ ok: true });
        if (url.includes('/playlistItems')) return Promise.resolve({ ok: true });
        return Promise.resolve({ ok: false, status: 500, text: async () => '' });
      });

      const res = await handler({ jobId: 'j1', youtube: YT } as never);

      expect(res).toMatchObject({ ok: true, videoId: 'RESUMED_INSERT_ID' });
      // THE property this whole describe exists to pin.
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('uploadType=resumable'))).toBe(false);
      // Both the query and the resumed PUT went to the STORED uri.
      const sessionCalls = fetchMock.mock.calls.filter((c) => c[0] === EXISTING_SESSION);
      expect(sessionCalls).toHaveLength(2);
      expect(patched()).toMatchObject({ youtubeVideoId: 'RESUMED_INSERT_ID', uploadStatus: 'uploaded' });
    });

    it('recovers a lost id when the query reports the upload already completed (200/201) — no second PUT', async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes('oauth2.googleapis.com/token')) {
          return Promise.resolve({ ok: true, json: async () => ({ access_token: 'ACCESS-TOKEN' }) });
        }
        if (url === EXISTING_SESSION) {
          // This IS the sole recovery for "the PUT succeeded on a prior
          // invocation but the youtubeVideoId write never landed."
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: 'RECOVERED_ID' }) });
        }
        if (url.includes('/thumbnails/set')) return Promise.resolve({ ok: true });
        if (url.includes('/playlistItems')) return Promise.resolve({ ok: true });
        return Promise.resolve({ ok: false, status: 500, text: async () => '' });
      });

      const res = await handler({ jobId: 'j1', youtube: YT } as never);

      expect(res).toMatchObject({ ok: true, videoId: 'RECOVERED_ID' });
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('uploadType=resumable'))).toBe(false);
      const sessionCalls = fetchMock.mock.calls.filter((c) => c[0] === EXISTING_SESSION);
      expect(sessionCalls).toHaveLength(1); // the query alone — no data PUT needed
      expect(patched()).toMatchObject({ youtubeVideoId: 'RECOVERED_ID', uploadStatus: 'uploaded' });
    });

    it('clears a 404 session and opens a fresh one, instead of jamming forever', async () => {
      fetchMock.mockImplementation((url: string, init?: { body?: unknown }) => {
        if (url.includes('oauth2.googleapis.com/token')) {
          return Promise.resolve({ ok: true, json: async () => ({ access_token: 'ACCESS-TOKEN' }) });
        }
        if (url === EXISTING_SESSION) {
          return Promise.resolve({ ok: false, status: 404, text: async () => 'gone' });
        }
        if (url.includes('uploadType=resumable')) {
          return Promise.resolve({
            ok: true,
            headers: { get: (k: string) => (k === 'location' ? 'https://upload.example/session-new' : null) },
          });
        }
        if (url === 'https://upload.example/session-new') {
          return Promise.resolve({ ok: true, json: async () => ({ id: 'FRESH_AFTER_404' }) });
        }
        if (url.includes('/thumbnails/set')) return Promise.resolve({ ok: true });
        if (url.includes('/playlistItems')) return Promise.resolve({ ok: true });
        return Promise.resolve({ ok: false, status: 500, text: async () => '' });
      });

      const res = await handler({ jobId: 'j1', youtube: YT } as never);

      expect(res).toMatchObject({ ok: true, videoId: 'FRESH_AFTER_404' });
      // A 404 proved the OLD session dead, so opening a new one here is
      // correct — unlike the 5xx case below, where it would not be.
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('uploadType=resumable'))).toBe(true);
      expect(patched()).toMatchObject({ youtubeVideoId: 'FRESH_AFTER_404', uploadStatus: 'uploaded' });
    });

    /**
     * ⚠️ A 400 is deliberately NOT treated as "session gone" — see
     * sessionIsGone's doc comment for the asymmetry that decides this: a
     * live session wrongly discarded costs a duplicate video (unrecoverable
     * without a manual delete on the channel); a dead one wrongly kept costs
     * only a failed job an operator has to look at (fully recoverable). A
     * bare 400 is not proof enough to risk the first outcome.
     */
    it('does NOT clear a 400 session — the ambiguous status takes the recoverable branch, not the discard branch', async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes('oauth2.googleapis.com/token')) {
          return Promise.resolve({ ok: true, json: async () => ({ access_token: 'ACCESS-TOKEN' }) });
        }
        if (url === EXISTING_SESSION) {
          return Promise.resolve({ ok: false, status: 400, text: async () => 'Bad Request' });
        }
        return Promise.resolve({ ok: false, status: 500, text: async () => '' });
      });

      const res = await handler({ jobId: 'j1', youtube: YT } as never);

      expect(res).toEqual({ ok: false });
      // THE property: a 400 must never open a second insert.
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('uploadType=resumable'))).toBe(false);
      const p = patched();
      expect(p.uploadStatus).toBe('failed');
      expect(p).not.toHaveProperty('uploadSessionUri');
    });

    /**
     * The one case that MAY discard a session with no Google call at all:
     * local, certain evidence (the file on disk no longer matches what the
     * session declared) rather than an ambiguous HTTP status.
     */
    it('discards and reopens on a LOCAL size mismatch, with no query call needed to decide', async () => {
      // mockStatSync always returns { size: 123456 } (see the top of this
      // file) — a declared size that disagrees with that is unambiguously a
      // different file than the one the session was opened against.
      job.uploadSessionSize = 999;

      fetchMock.mockImplementation((url: string) => {
        if (url.includes('oauth2.googleapis.com/token')) {
          return Promise.resolve({ ok: true, json: async () => ({ access_token: 'ACCESS-TOKEN' }) });
        }
        if (url.includes('uploadType=resumable')) {
          return Promise.resolve({
            ok: true,
            headers: { get: (k: string) => (k === 'location' ? 'https://upload.example/session-new' : null) },
          });
        }
        if (url === 'https://upload.example/session-new') {
          return Promise.resolve({ ok: true, json: async () => ({ id: 'FRESH_AFTER_SIZE_MISMATCH' }) });
        }
        if (url.includes('/thumbnails/set')) return Promise.resolve({ ok: true });
        if (url.includes('/playlistItems')) return Promise.resolve({ ok: true });
        return Promise.resolve({ ok: false, status: 500, text: async () => '' });
      });

      const res = await handler({ jobId: 'j1', youtube: YT } as never);

      expect(res).toMatchObject({ ok: true, videoId: 'FRESH_AFTER_SIZE_MISMATCH' });
      // THE property: the old session URI is never even queried.
      expect(fetchMock.mock.calls.some((c) => c[0] === EXISTING_SESSION)).toBe(false);
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('uploadType=resumable'))).toBe(true);
      expect(patched()).toMatchObject({ youtubeVideoId: 'FRESH_AFTER_SIZE_MISMATCH', uploadStatus: 'uploaded' });
    });

    it('KEEPS a session alive on a 500 query — a 5xx does not prove the session is dead', async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes('oauth2.googleapis.com/token')) {
          return Promise.resolve({ ok: true, json: async () => ({ access_token: 'ACCESS-TOKEN' }) });
        }
        if (url === EXISTING_SESSION) {
          return Promise.resolve({ ok: false, status: 500, text: async () => 'server error' });
        }
        return Promise.resolve({ ok: false, status: 500, text: async () => '' });
      });

      const res = await handler({ jobId: 'j1', youtube: YT } as never);

      expect(res).toEqual({ ok: false });
      // Opening a new session here would be exactly how a genuinely-alive
      // session gets abandoned and a retry risks a second video.
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('uploadType=resumable'))).toBe(false);
      const p = patched();
      expect(p.uploadStatus).toBe('failed');
      expect(p).not.toHaveProperty('uploadSessionUri');
    });

    it('clears the session when the resumed PUT itself reports it gone (410) — the same discrimination applied to the data PUT, not just the query', async () => {
      fetchMock.mockImplementation((url: string, init?: { body?: unknown }) => {
        if (url.includes('oauth2.googleapis.com/token')) {
          return Promise.resolve({ ok: true, json: async () => ({ access_token: 'ACCESS-TOKEN' }) });
        }
        if (url === EXISTING_SESSION) {
          if (!init?.body) return Promise.resolve({ status: 308, ok: false, headers: { get: () => null } });
          return Promise.resolve({ ok: false, status: 410, text: async () => 'gone mid-flight' });
        }
        return Promise.resolve({ ok: false, status: 500, text: async () => '' });
      });

      const res = await handler({ jobId: 'j1', youtube: YT } as never);

      expect(res).toEqual({ ok: false });
      const p = patched();
      expect(p.uploadStatus).toBe('failed');
      // Cleared — so the NEXT invocation opens a fresh session instead of
      // resuming a URI Google has already discarded.
      expect(p.uploadSessionUri).toBeNull();
    });
  });
});
