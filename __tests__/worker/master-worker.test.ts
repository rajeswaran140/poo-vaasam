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
// Taken from the library rather than spelled out: the frame's format is a
// measured performance decision that has already changed once, and a test that
// hardcodes the extension fails for the wrong reason when it changes again.
//
// A plain import, unlike the worker above: that one is require()d so it loads
// after the jest.mock calls, and master-video is mocked by nothing.
import { FRAME_EXTENSION } from '@/lib/master-video';

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
    const args = ffArgs().find((a) => a.includes('libx264')) as string[];
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

    // Six passes now: the audio-duration probe, the cover probe, compose,
    // encode, then one measurement of the master and one of the MP4. What this
    // test guards is that exactly ONE of them filters and it is not the encode.
    //
    // Selected by SHAPE, not by index: two probes share a signature now, and a
    // positional read silently tests the wrong pass when an order changes.
    expect(spawnSync).toHaveBeenCalledTimes(6);
    const compose = ffArgs().find((a) => a.includes('-filter_complex')) as string[];
    const encode = ffArgs().find((a) => a.includes('libx264')) as string[];
    const probes = ffArgs().filter((a) => a.length === 3 && a[0] === '-hide_banner');

    // Two header reads, neither filtering nor producing a file.
    expect(probes).toHaveLength(2);
    for (const probe of probes) expect(probe).not.toContain('-filter_complex');

    // Compose: filters the cover, emits exactly one frame, touches no audio.
    expect(compose).toContain('-filter_complex');
    expect(compose[compose.indexOf('-frames:v') + 1]).toBe('1');
    expect(compose.join(' ')).not.toContain('master.wav');

    // Encode: no filter at all — that absence IS the fix.
    expect(encode).not.toContain('-filter_complex');
    expect(encode.join(' ')).not.toContain('boxblur');
    // It must consume the frame pass 1 produced, not the raw cover.
    expect(encode.join(' ')).toContain(`frame${FRAME_EXTENSION}`);
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
   * AN UNREADABLE COVER ASPECT MUST LEAVE A TRACE.
   *
   * probeCoverAspect returns undefined when it cannot read the header, and
   * buildVideoFilter then takes the blurred-backdrop branch on purpose — a
   * guessed 16:9 would crop the operator's artwork. But the RESULT is a cover
   * sitting at 82% on a blur, which is pixel-for-pixel what the square-box
   * defect looked like, and that defect has shipped TWICE. Nothing recorded
   * which of the two had happened, so the only way to tell was to re-probe the
   * cover by hand.
   */
  it('says so in the log when the cover aspect could not be read', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // Every call succeeds with an empty log: the cover probe finds no
      // "Video: WxH" line, so the aspect is unknown.
      spawnSync.mockImplementation(() => ({ status: 0, stdout: '', stderr: '' }));

      const res = await handler({ jobId: 'j1', render: render() } as never);
      expect(res).toMatchObject({ ok: true });

      const said = err.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(said).toContain('cover aspect');
    } finally {
      err.mockRestore();
    }
  });

  it('stays quiet when the aspect reads fine', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      spawnSync.mockImplementation((_cmd: string, args: string[]) =>
        args.length === 3 && args[0] === '-hide_banner' && !args[2].includes('master.wav')
          ? { status: 1, stdout: '', stderr: 'Stream #0:0: Video: png, rgb24, 1672x941 [SAR 1:1 DAR 1672:941]' }
          : { status: 0, stdout: '', stderr: '' }
      );

      await handler({ jobId: 'j1', render: render() } as never);
      const said = err.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(said).not.toContain('cover aspect');
    } finally {
      err.mockRestore();
    }
  });

  /**
   * THE SINGLE-COVER RENDER MUST BOUND ITS PICTURE BY THE AUDIO.
   *
   * Production runs ffmpeg 7.0.2, the dev box 6.1.1; `-shortest` overshoots on
   * 7.0.2 by a variable 1.0-2.4 s, so every upload has carried a held cover and
   * silence at the end. Measured 2026-09-23 with the layer's own binary.
   *
   * The slideshow branch has always probed the WAV header for its duration.
   * This pins that the SINGLE-cover branch does too, and that the figure
   * actually reaches the encode — a probe whose result is dropped would look
   * identical from the outside and leave the bug in place.
   */
  describe('the audio duration reaches the encode', () => {
    /** A 1:31.53 master, as the WAV header prints it. */
    const HEADER = "Input #0, wav, from '/tmp/master-test/master.wav':\n" +
      '  Duration: 00:01:31.53, bitrate: 2304 kb/s\n' +
      '  Stream #0:0: Audio: pcm_s24le, 48000 Hz, stereo, s32 (24 bit), 2304 kb/s\n';
    const encodeCall = () => ffArgs().find((a) => a.includes('libx264')) as string[];

    it('bounds the looped frame with -t and drops -shortest', async () => {
      // Only the audio-header probe answers; the cover probe shares its shape
      // and is told apart by the path, as the slideshow suite does.
      spawnSync.mockImplementation((_cmd: string, args: string[]) =>
        args.length === 3 && args[2].includes('master.wav')
          ? { status: 1, stdout: '', stderr: HEADER }
          : { status: 0, stdout: '', stderr: '' }
      );

      const res = await handler({ jobId: 'j1', render: render() } as never);
      expect(res).toMatchObject({ ok: true });

      const enc = encodeCall();
      // 91.5, not 91.53: parseSourceInfo rounds the header to 0.1 s. That is
      // fine here — with -shortest gone nothing trims the audio, so the worst
      // case either way is the picture missing or outliving the sound by 0.05 s
      // against the 1.0-2.4 s this replaces.
      expect(enc[enc.indexOf('-t') + 1]).toBe('91.5');
      expect(enc.indexOf('-t')).toBeLessThan(enc.indexOf('-i'));
      expect(enc).not.toContain('-shortest');
    });

    it('falls back to -shortest when the header will not say', async () => {
      // Every call succeeds with an empty log, so parseSourceInfo finds no
      // duration. The render must still END — see buildVideoArgs.
      spawnSync.mockImplementation(() => ({ status: 0, stdout: '', stderr: '' }));

      const res = await handler({ jobId: 'j1', render: render() } as never);
      expect(res).toMatchObject({ ok: true });

      const enc = encodeCall();
      expect(enc).toContain('-shortest');
      expect(enc).not.toContain('-t');
    });

    it('does not refuse the render when the probe fails outright', async () => {
      // A failed probe is missing data, not a bad job. Refusing here would
      // block every render the moment the header format shifted.
      spawnSync.mockImplementation((_cmd: string, args: string[]) =>
        args.length === 3 && args[2].includes('master.wav')
          ? { status: 1, stdout: '', stderr: 'could not read' }
          : { status: 0, stdout: '', stderr: '' }
      );

      const res = await handler({ jobId: 'j1', render: render() } as never);
      expect(res).toMatchObject({ ok: true });
      expect(encodeCall()).toContain('-shortest');
    });
  });

  /**
   * probeCoverAspect() feeds buildVideoFilter() — this is the whole point of
   * Task 1 + Task 2, and until now nothing pinned that the wiring actually
   * fires the fill branch on a real 16:9 probe result. Every other test in
   * this suite mocks spawnSync unconditionally, so the probe call always saw
   * an empty log and buildVideoFilter always took the backdrop branch.
   *
   * ⚠️ The cover probe NO LONGER has a unique signature. renderVideo probes
   * the AUDIO header first, with the identical
   * `['-hide_banner', '-i', PATH]` shape, so these are told apart by the PATH
   * — the same way the slideshow suite does it.
   */
  describe('the cover probe result reaches buildVideoFilter', () => {
    const isCoverProbe = (args: string[]) =>
      args.length === 3 && args[0] === '-hide_banner' && args[1] === '-i' &&
      !args[2].includes('master.wav');

    /** Only the probe call returns `header`; compose and encode still succeed. */
    const mockProbeHeader = (header: string) => {
      spawnSync.mockImplementation((_cmd: string, args: string[]) =>
        isCoverProbe(args)
          ? { status: 1, stdout: '', stderr: header }
          : { status: 0, stdout: '', stderr: '' }
      );
    };

    // By shape, not by index — the audio probe now runs ahead of this one.
    const composeFilter = () => {
      const compose = ffArgs().find((a) => a.includes('-filter_complex')) as string[];
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

/**
 * The vertical short.
 *
 * A third thing sharing the Lambda, and the properties worth pinning are the
 * same shape as the video's: it must cut from the MASTERED WAV, it must never
 * run a loudness pass that rewrites the job's measurements, and — the one that
 * is specific to it — the hook window it chooses must actually reach the
 * encode's `-ss`. A short that silently always opened at 0:00 would look
 * perfectly fine in every other assertion here.
 */
describe('short render', () => {
  const AUDIO = 'audio/mastering/1_a_song-master-14LUFS.wav';
  const COVER = 'audio/mastering/1_c_cover.jpg';
  const short = (over: Record<string, unknown> = {}) => ({ audioKey: AUDIO, coverKey: COVER, ...over });
  const ffArgs = () => spawnSync.mock.calls.map((c) => c[1] as string[]);
  /**
   * Passes are selected by SHAPE, not by index. renderShort gained a cover
   * probe between measuring and composing, and every positional assertion in
   * here broke at once — for a change that altered nothing they were testing.
   */
  const composePass = () => ffArgs().find((a) => a.includes('-frames:v'))!;
  const encodePass = () => ffArgs().find((a) => a.includes('-c:v'))!;
  const probePass = () => ffArgs().find((a) => a.length === 3 && a[1] === '-i')!;

  /**
   * A 4-minute track whose loudest stretch sits at 100-140s. Written as real
   * ebur128 lines so the parser is exercised, not bypassed.
   */
  const EBUR = (() => {
    const lines: string[] = [];
    for (let t = 0; t <= 240; t += 1) {
      const loud = t >= 100 && t < 140 ? -9.0 : -20.0;
      lines.push(`[Parsed_ebur128_0 @ 0x1] t: ${t.toFixed(1)}  TARGET:-23 LUFS  M: ${loud.toFixed(1)} S: -20.1 I: -16.0 LUFS  LRA: 6.0 LU`);
    }
    return lines.join('\n');
  })();

  beforeEach(() => {
    spawnSync.mockReset();
    // Only the ebur128 pass produces a log; compose and encode succeed silently.
    spawnSync.mockImplementation((_cmd: unknown, args: string[]) =>
      args.join(' ').includes('ebur128')
        ? { status: 0, stdout: '', stderr: EBUR }
        : { status: 0, stdout: '', stderr: '' }
    );
    s3Send.mockReset();
    s3Send.mockImplementation((cmd: { input: Record<string, unknown> }) =>
      'Body' in cmd.input
        ? Promise.resolve({})
        : Promise.resolve({ Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } })
    );
  });

  it('cuts from the MASTERED WAV, never the 192k MP3', async () => {
    const res = await handler({ jobId: 'j1', short: short() } as never);

    expect(res).toMatchObject({ ok: true });
    const encode = encodePass();
    expect(encode[encode.lastIndexOf('-i') + 1]).toContain('master.wav');
    expect(encode.join(' ')).not.toContain('.mp3');
  });

  /**
   * ⚠️ THREE passes, and the order matters for the same reason the video's two
   * do: composing the blurred 9:16 backdrop once and looping THAT frame is what
   * keeps the encode cheap. A regression does not throw — it just gets slow.
   */
  it('measures, THEN composes the frame once, THEN encodes against it', async () => {
    await handler({ jobId: 'j1', short: short() } as never);

    // measure, probe the cover, compose, encode, then the two verification
    // passes over the finished clip — the master's header and the clip's own
    // astats. See checkRenderedClip: NEITHER runs ebur128.
    expect(spawnSync).toHaveBeenCalledTimes(6);
    expect(ffArgs().filter((a) => a.join(' ').includes('ebur128'))).toHaveLength(1);
    const measure = ffArgs()[0];
    const compose = composePass();
    const encode = encodePass();
    expect(probePass()).toBeTruthy();

    // Pass 0: loudness only. Writes no file.
    expect(measure.join(' ')).toContain('ebur128');
    expect(measure[measure.indexOf('-f') + 1]).toBe('null');

    // Pass 1: filters the cover, emits exactly one frame, touches no audio.
    expect(compose).toContain('-filter_complex');
    expect(compose[compose.indexOf('-frames:v') + 1]).toBe('1');
    expect(compose.join(' ')).not.toContain('master.wav');

    // Pass 2: no -filter_complex at all — that absence IS what keeps it cheap.
    expect(encode).not.toContain('-filter_complex');
    expect(encode.join(' ')).not.toContain('boxblur');
    expect(encode.join(' ')).toContain(`frame${FRAME_EXTENSION}`);
    expect(encode.join(' ')).not.toContain('cover.jpg');
  });

  /**
   * The assertion the rest of this block cannot make for itself: the window the
   * picker chose has to arrive at the encode. A short that always opened at
   * 0:00 would satisfy every other test here.
   */
  it('seeks to the loudest stretch, minus the lead-in', async () => {
    await handler({ jobId: 'j1', short: short() } as never);

    const encode = encodePass();
    const ss = Number(encode[encode.indexOf('-ss') + 1]);
    // Peak starts at 100s; SHORT_LEAD_IN_SEC pulls the opening back to 96s.
    expect(ss).toBeCloseTo(96, 3);
    // And the seek is BEFORE its input, or ffmpeg decodes from zero. The
    // duration has to be on the input side too — an output-only -t reads the
    // whole file and only truncates what it writes.
    expect(encode.indexOf('-ss')).toBeLessThan(encode.lastIndexOf('-i'));
    expect(encode.indexOf('-t')).toBeLessThan(encode.lastIndexOf('-i'));
    expect(patched().shortStartSec).toBeCloseTo(96, 2);
  });

  it('runs no loudnorm and rewrites no measurement', async () => {
    await handler({ jobId: 'j1', short: short() } as never);

    expect(ffArgs().join(' ')).not.toContain('loudnorm');
    const p = patched();
    for (const field of ['afterLufs', 'afterTp', 'beforeLufs', 'normalizationType', 'status', 'videoKey']) {
      expect(p).not.toHaveProperty(field);
    }
  });

  it('stores the MP4 beside the master under its own key', async () => {
    await handler({ jobId: 'j1', short: short() } as never);

    const put = s3Send.mock.calls
      .map((c) => c[0] as { input: Record<string, unknown> })
      .find((c) => 'Body' in c.input);
    expect(put?.input).toMatchObject({
      Bucket: 'tamil-web-media',
      Key: 'audio/mastering/1_a_song-master-14LUFS-short-1920.mp4',
      ContentType: 'video/mp4',
    });
    expect(patched()).toMatchObject({
      shortKey: 'audio/mastering/1_a_song-master-14LUFS-short-1920.mp4',
      coverKey: COVER,
    });
    expect(typeof patched().shortRenderedAt).toBe('string');
  });

  /**
   * NO BURNED TEXT. The Lambda has no python3 and no Pillow-with-raqm, and
   * ffmpeg's drawtext does no complex-script shaping — Tamil clusters break.
   * Broken Tamil on a public feed is worse than no caption at all.
   */
  it('burns no text into the clip', async () => {
    await handler({ jobId: 'j1', short: short() } as never);
    const all = ffArgs().join(' ');
    expect(all).not.toContain('drawtext');
    expect(all).not.toContain('subtitles');
    expect(all).not.toContain('ass=');
  });

  describe('refusals never touch S3', () => {
    it.each([
      ['a source outside the workspace', { audioKey: 'audio/poem-music/amma.wav' }],
      ['a source that is not a master', { audioKey: 'audio/mastering/1_a_song.wav' }],
      ['a cover outside the workspace', { coverKey: 'images/song-covers/x.png' }],
      ['no cover at all', { coverKey: undefined }],
    ])('%s', async (_label, over) => {
      const res = await handler({ jobId: 'j1', short: short(over) } as never);

      expect(res).toEqual({ ok: false });
      expect(patched().shortError).toBeTruthy();
      expect(s3Send).not.toHaveBeenCalled();
      expect(spawnSync).not.toHaveBeenCalled();
    });
  });

  it('records the failure and leaves the master alone when ffmpeg fails', async () => {
    spawnSync.mockImplementation((_cmd: unknown, args: string[]) =>
      args.join(' ').includes('ebur128')
        ? { status: 0, stdout: '', stderr: EBUR }
        : { status: 1, stdout: '', stderr: 'x264 died' }
    );
    const res = await handler({ jobId: 'j1', short: short() } as never);

    expect(res).toEqual({ ok: false });
    expect(patched().shortError).toBeTruthy();
    expect(patched()).not.toHaveProperty('shortKey');
    const put = s3Send.mock.calls
      .map((c) => c[0] as { input: Record<string, unknown> })
      .find((c) => 'Body' in c.input);
    expect(put).toBeUndefined();
  });

  it('refuses rather than guessing when the track cannot be measured', async () => {
    spawnSync.mockImplementation(() => ({ status: 0, stdout: '', stderr: '' }));
    const res = await handler({ jobId: 'j1', short: short() } as never);

    expect(res).toEqual({ ok: false });
    expect(patched().shortError).toBeTruthy();
    expect(patched()).not.toHaveProperty('shortKey');
  });

  /**
   * planShort refuses a track it KNOWS is too short, but a job whose duration
   * was never measured reaches the worker unrefused. The ebur128 pass is then
   * the only thing that knows how long the track is, so the clip length is
   * clamped against it — otherwise a 20s track yields a 30s file whose last
   * 10s are silence over a still, with a fade-out that never fires.
   */
  describe('a track shorter than the clip', () => {
    const upTo = (last: number) => {
      const lines: string[] = [];
      for (let t = 0; t <= last; t += 1) {
        lines.push(`[Parsed_ebur128_0 @ 0x1] t: ${t.toFixed(1)}  TARGET:-23 LUFS  M: -18.0 S: -20.1 I: -16.0 LUFS  LRA: 6.0 LU`);
      }
      return lines.join('\n');
    };
    const measuring = (log: string) => (_cmd: unknown, args: string[]) =>
      args.join(' ').includes('ebur128')
        ? { status: 0, stdout: '', stderr: log }
        : { status: 0, stdout: '', stderr: '' };

    it('cuts only as much as there is, and fades at the real end', async () => {
      spawnSync.mockImplementation(measuring(upTo(25)));
      const res = await handler({ jobId: 'j1', short: short() } as never);

      expect(res).toMatchObject({ ok: true });
      const encode = encodePass();
      // Both -t values are the clamped length, not the nominal 30.
      expect(encode.filter((a, i) => encode[i - 1] === '-t')).toEqual(['25', '25']);
      // The fade-out is scheduled inside the audio that exists — 3s before the
      // clamped end, not before the nominal 30.
      expect(encode[encode.indexOf('-af') + 1]).toContain('afade=t=out:st=22.000:d=3');
      expect(patched().shortSeconds).toBe(25);
    });

    it('refuses outright when there is not even a stub to cut', async () => {
      spawnSync.mockImplementation(measuring(upTo(6)));
      const res = await handler({ jobId: 'j1', short: short() } as never);

      expect(res).toEqual({ ok: false });
      expect(patched().shortError).toMatch(/shorter/i);
      expect(patched()).not.toHaveProperty('shortKey');
      const put = s3Send.mock.calls
        .map((c) => c[0] as { input: Record<string, unknown> })
        .find((c) => 'Body' in c.input);
      expect(put).toBeUndefined();
    });
  });

  /**
   * The operator picked the window themselves.
   *
   * The property that matters is that NOTHING measures: running ebur128 anyway
   * would spend a pass producing a number this path discards, and would leave
   * two answers to one question. The length check moves to the file's own
   * header, which is one spawn and no decoding.
   */
  describe('a window the operator chose', () => {
    const HEADER = `ffmpeg version 6.0
Input #0, wav, from '/tmp/master.wav':
  Duration: 00:04:00.00, bitrate: 1536 kb/s
  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 48000 Hz, stereo, s16, 1536 kb/s
`;
    beforeEach(() => {
      spawnSync.mockImplementation((_cmd: unknown, args: string[]) =>
        // The header probe is `-hide_banner -i FILE` and nothing else.
        args.length === 3 && args[0] === '-hide_banner' && args[1] === '-i'
          ? { status: 0, stdout: '', stderr: HEADER }
          : { status: 0, stdout: '', stderr: '' }
      );
    });

    it('cuts exactly where it was told, and never measures loudness', async () => {
      const res = await handler({ jobId: 'j1', short: short({ startSec: 128.4, seconds: 45 }) } as never);

      expect(res).toMatchObject({ ok: true });
      const all = ffArgs().join(' ');
      expect(all).not.toContain('ebur128');

      const encode = encodePass();
      expect(Number(encode[encode.indexOf('-ss') + 1])).toBeCloseTo(128.4, 3);
      expect(encode.filter((a, i) => encode[i - 1] === '-t')).toEqual(['45', '45']);
      // The fade-out is scheduled against the chosen length, not the default.
      expect(encode[encode.indexOf('-af') + 1]).toContain('afade=t=out:st=42.000:d=3');
      expect(patched()).toMatchObject({ shortStartSec: 128.4, shortSeconds: 45, shortPicked: true });
    });

    it('records that the machine chose, when it did', async () => {
      spawnSync.mockImplementation((_cmd: unknown, args: string[]) =>
        args.join(' ').includes('ebur128')
          ? { status: 0, stdout: '', stderr: EBUR }
          : { status: 0, stdout: '', stderr: '' }
      );
      await handler({ jobId: 'j1', short: short() } as never);
      expect(patched().shortPicked).toBe(false);
    });

    it('REFUSES a window running past the end of the file', async () => {
      // 3:50 + 30s on a 4:00 track. Refused, not shortened — the operator
      // auditioned those seconds.
      const res = await handler({ jobId: 'j1', short: short({ startSec: 230, seconds: 30 }) } as never);

      expect(res).toEqual({ ok: false });
      expect(patched().shortError).toMatch(/past the end/i);
      const put = s3Send.mock.calls
        .map((c) => c[0] as { input: Record<string, unknown> })
        .find((c) => 'Body' in c.input);
      expect(put).toBeUndefined();
    });

    it.each([
      ['a half-given window', { startSec: 128 }],
      ['a length under the editorial floor', { startSec: 10, seconds: 20 }],
      ['a length over the ceiling', { startSec: 10, seconds: 200 }],
      ['a negative start', { startSec: -5, seconds: 30 }],
    ])('re-validates the event itself and refuses %s', async (_label, over) => {
      // The route is not the only thing that can invoke this Lambda.
      const res = await handler({ jobId: 'j1', short: short(over) } as never);

      expect(res).toEqual({ ok: false });
      expect(patched().shortError).toBeTruthy();
      expect(patched()).not.toHaveProperty('shortKey');
    });

    it('trusts the pick when the header will not say how long the file is', async () => {
      spawnSync.mockImplementation(() => ({ status: 0, stdout: '', stderr: 'ffmpeg version 6.0\n' }));
      const res = await handler({ jobId: 'j1', short: short({ startSec: 30, seconds: 30 }) } as never);

      expect(res).toMatchObject({ ok: true });
      expect(ffArgs().join(' ')).not.toContain('ebur128');
    });
  });

  it('clears its temp directory on success and on failure', async () => {
    mockRmSync.mockClear();
    await handler({ jobId: 'j1', short: short() } as never);
    expect(mockRmSync).toHaveBeenCalledWith('/tmp/master-test', { recursive: true, force: true });

    mockRmSync.mockClear();
    spawnSync.mockImplementation(() => ({ status: 1, stdout: '', stderr: '' }));
    await handler({ jobId: 'j1', short: short() } as never);
    expect(mockRmSync).toHaveBeenCalledWith('/tmp/master-test', { recursive: true, force: true });
  });
});

/**
 * The seam preview.
 *
 * A third kind of event, and the only one that writes NO job record: a preview
 * belongs to a set of settings, not to a job, because at the moment the
 * crossfade is being decided there is usually no job at all. The properties
 * worth pinning are that it never touches DynamoDB, that it refuses the same
 * crossfades the real master would, and that what it renders is the real join
 * graph rather than a lookalike.
 */
describe('the short is verified, and a bad one says so in the log', () => {
  const AUDIO = 'audio/mastering/1_a_song-master-14LUFS.wav';
  const COVER = 'audio/mastering/1_c_cover.jpg';
  const short = (over: Record<string, unknown> = {}) =>
    ({ audioKey: AUDIO, coverKey: COVER, startSec: 30, seconds: 30, ...over });
  /** A 4:00 master, so a 30 s window at 0:30 sits well inside it. */
  const HEADER = "Input #0, wav, from '/tmp/master-test/master.wav':\n" +
    '  Duration: 00:04:00.00, bitrate: 1536 kb/s\n' +
    '  Stream #0:0: Audio: pcm_s24le, 48000 Hz, stereo, s32 (24 bit), 1536 kb/s\n';
  /** What the finished clip measures as — 30 s, 48 kHz, stereo. */
  const CLIP_OK = "Input #0, mov,mp4, from '/tmp/master-test/short.mp4':\n" +
    '  Duration: 00:00:30.01, bitrate: 200 kb/s\n' +
    '  Stream #0:1: Audio: aac, 48000 Hz, stereo, fltp, 192 kb/s\n' +
    '[Parsed_astats_0 @ 0x1] Number of samples: 1440512\n';
  /** A clip cut short — the window ran past the end of the track. */
  const CLIP_SHORT = "Input #0, mov,mp4, from '/tmp/master-test/short.mp4':\n" +
    '  Duration: 00:00:24.50, bitrate: 200 kb/s\n' +
    '  Stream #0:1: Audio: aac, 48000 Hz, stereo, fltp, 192 kb/s\n' +
    '[Parsed_astats_0 @ 0x1] Number of samples: 1176000\n';

  const mockShort = (clipLog: string) => {
    spawnSync.mockImplementation((_cmd: string, args: string[]) => {
      const joined = args.join(' ');
      // the measurement pass over the finished clip
      if (joined.includes('astats')) return { status: 0, stdout: '', stderr: clipLog };
      // the window check against the master's own header
      if (args.length === 3 && args[2].includes('master.wav')) {
        return { status: 1, stdout: '', stderr: HEADER };
      }
      return { status: 0, stdout: '', stderr: '' };
    });
    s3Send.mockImplementation((cmd: { input: Record<string, unknown> }) =>
      'Body' in cmd.input
        ? Promise.resolve({})
        : Promise.resolve({ Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } })
    );
  };

  it('says nothing when the clip is the length that was asked for', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mockShort(CLIP_OK);
      const res = await handler({ jobId: 'j1', short: short() } as never);
      expect(res).toMatchObject({ ok: true });
      expect(err.mock.calls.map((c) => c.join(' ')).join('\n')).not.toContain('short verification');
    } finally { err.mockRestore(); }
  });

  /**
   * ⚠️ A SUSPECT CLIP IS STILL UPLOADED, ON PURPOSE. It goes in the log, not on
   * the job: `shortError` is what the UI THROWS on (MasteringStudio polls it and
   * treats any value as a failed render), so putting a verdict there would tell
   * the operator the short did not happen when the file is sitting in S3. That
   * is the confusion #348 existed to remove; this must not reintroduce it.
   */
  it('logs a clip that came out short, and still stores it', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mockShort(CLIP_SHORT);
      const res = await handler({ jobId: 'j1', short: short() } as never);

      expect(res).toMatchObject({ ok: true });
      expect(err.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('short verification');

      // The clip was still written, and the job was NOT marked failed.
      const put = s3Send.mock.calls
        .map((c) => c[0] as { input: Record<string, unknown> })
        .find((c) => 'Body' in c.input);
      expect(put).toBeDefined();
      expect(patched().shortError).toBeNull();
    } finally { err.mockRestore(); }
  });
});

describe('seam preview', () => {
  const A = 'audio/mastering/1700000000000_ab12_part-a.wav';
  const B = 'audio/mastering/1700000000000_cd34_part-b.wav';
  const seam = (over: Record<string, unknown> = {}) => ({
    partAKey: A,
    editA: null,
    join: { partBKey: B, overlapSec: 4, curve: 'qsin', editB: null },
    ...over,
  });
  const ffArgs = () => spawnSync.mock.calls.map((c) => c[1] as string[]);
  const header = (seconds: number) => `ffmpeg version 6.0
Input #0, wav, from '/tmp/x.wav':
  Duration: 00:0${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}.00, bitrate: 1536 kb/s
  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 48000 Hz, stereo, s16, 1536 kb/s
`;
  const SUMMARY = `[Parsed_ebur128_0 @ 0x1] Summary:

  Integrated loudness:
    I:         -14.2 LUFS
    Threshold: -24.8 LUFS
`;

  beforeEach(() => {
    spawnSync.mockReset();
    // Probes report 2:00 per part; the ebur128 runs report a summary; the
    // render itself says nothing.
    spawnSync.mockImplementation((_cmd: unknown, args: string[]) => {
      if (args.length === 3 && args[1] === '-i') return { status: 0, stdout: '', stderr: header(120) };
      if (args.join(' ').includes('ebur128')) return { status: 0, stdout: '', stderr: SUMMARY };
      return { status: 0, stdout: '', stderr: '' };
    });
    s3Send.mockReset();
    s3Send.mockImplementation((cmd: { input: Record<string, unknown> }) =>
      'Body' in cmd.input
        ? Promise.resolve({})
        : Promise.resolve({ Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } })
    );
  });

  it('writes NO job record — a preview belongs to no job', async () => {
    const res = await handler({ seam: seam() } as never);

    expect(res).toMatchObject({ ok: true });
    // The one assertion that distinguishes this from every other branch here.
    expect(send).not.toHaveBeenCalled();
  });

  it('renders the REAL join graph, trimmed around the seam', async () => {
    await handler({ seam: seam() } as never);

    const render = ffArgs().find((a) => a.includes('-filter_complex'))!;
    const graph = render[render.indexOf('-filter_complex') + 1];
    // Equal-power crossfade at the asked-for length — the same filter the
    // master will run, not a lookalike built for previewing.
    expect(graph).toContain('acrossfade=d=4:c1=qsin:c2=qsin');
    expect(graph).toContain('atrim=start=108:end=128');
    expect(graph).toContain('asetpts=PTS-STARTPTS');
    expect(graph).not.toContain('loudnorm');
  });

  /**
   * ⚠️ Select the MP3 by CONTENT TYPE, not by "the first put with a Body".
   * The analysis sidecar is written first — deliberately, because the MP3's
   * existence is what the poll treats as readiness, so everything else has to
   * be in place before it appears.
   */
  it('stores an MP3 under the seam prefix, with both readings on it', async () => {
    await handler({ seam: seam() } as never);

    const put = s3Send.mock.calls
      .map((c) => c[0] as { input: Record<string, unknown> })
      .find((c) => c.input.ContentType === 'audio/mpeg')!;
    expect(String(put.input.Key)).toMatch(/^audio\/mastering\/seam\/[0-9a-f]{16}\.mp3$/);
    expect(put.input.ContentType).toBe('audio/mpeg');
    // The readings ride on the object, so the poll that asks "is it ready" also
    // learns why the seam sounds the way it does.
    expect(put.input.Metadata).toMatchObject({
      'seam-tail-lufs': '-14.2',
      'seam-head-lufs': '-14.2',
      'seam-gap-lu': '0',
    });
  });

  it('writes the part analysis BESIDE the preview, before it', async () => {
    await handler({ seam: seam() } as never);

    const puts = s3Send.mock.calls
      .map((c) => c[0] as { input: Record<string, unknown> })
      .filter((c) => 'Body' in c.input);
    const json = puts.find((c) => c.input.ContentType === 'application/json');
    const mp3 = puts.find((c) => c.input.ContentType === 'audio/mpeg');

    expect(String(json?.input.Key)).toBe(`${String(mp3?.input.Key)}.json`);
    // Order matters: the MP3 appearing is what the poll reads as "ready", so
    // the analysis must already be there when it does.
    expect(puts.indexOf(json!)).toBeLessThan(puts.indexOf(mp3!));
  });

  it('still stores the preview when the analysis cannot be produced', async () => {
    // A failed measurement must never cost the operator the clip they asked for.
    spawnSync.mockImplementation((_cmd: unknown, args: string[]) => {
      if (args.includes('s16le')) return { status: 1, stdout: '', stderr: 'decode failed' };
      if (args.length === 3 && args[1] === '-i') return { status: 0, stdout: '', stderr: header(120) };
      return { status: 0, stdout: '', stderr: SUMMARY };
    });
    const res = await handler({ seam: seam() } as never);

    expect(res).toMatchObject({ ok: true });
    const mp3 = s3Send.mock.calls
      .map((c) => c[0] as { input: Record<string, unknown> })
      .find((c) => c.input.ContentType === 'audio/mpeg');
    expect(mp3).toBeTruthy();
  });

  it('measures both sides of the overlap where they actually overlap', async () => {
    await handler({ seam: seam() } as never);

    const measures = ffArgs().filter((a) => a.join(' ').includes('ebur128'));
    expect(measures).toHaveLength(2);
    // Part A's tail: 2:00 long, 6s window ⇒ from 114s.
    expect(measures[0][measures[0].indexOf('-ss') + 1]).toBe('114');
    // Part B's head: from its own start.
    expect(measures[1][measures[1].indexOf('-ss') + 1]).toBe('0');
  });

  describe('refusals never write anything', () => {
    it.each([
      ['Part A outside the workspace', { partAKey: 'audio/poem-music/a.wav' }],
      ['Part B outside the workspace', { join: { partBKey: 'audio/poem-music/b.wav', overlapSec: 4, curve: 'qsin', editB: null } }],
      ['no crossfade at all', { join: null }],
      ['two different Part Bs', { partBKey: 'audio/mastering/other.wav' }],
    ])('%s', async (_label, over) => {
      const res = await handler({ seam: seam(over) } as never);

      expect(res).toMatchObject({ ok: false });
      expect(send).not.toHaveBeenCalled();
      const put = s3Send.mock.calls
        .map((c) => c[0] as { input: Record<string, unknown> })
        .find((c) => 'Body' in c.input);
      expect(put).toBeUndefined();
    });
  });

  it('refuses a crossfade the real master would refuse, rather than previewing it', async () => {
    // An overlap longer than a part silently truncates the join — and a
    // silently truncated join still masters cleanly, which is what makes it
    // dangerous. Better to say no here than to preview a lie. The check is the
    // SAME validateJoinAgainstSources the real master runs.
    spawnSync.mockImplementation((_cmd: unknown, args: string[]) =>
      args.length === 3 && args[1] === '-i'
        ? { status: 0, stdout: '', stderr: header(20) }
        : { status: 0, stdout: '', stderr: SUMMARY }
    );
    const res = await handler({
      seam: seam({ join: { partBKey: B, overlapSec: 25, curve: 'qsin', editB: null } }),
    } as never);

    expect(res).toMatchObject({ ok: false });
    expect(String((res as { error?: string }).error)).toMatch(/longer than Part/i);
    const put = s3Send.mock.calls
      .map((c) => c[0] as { input: Record<string, unknown> })
      .find((c) => 'Body' in c.input);
    expect(put).toBeUndefined();
  });

  it('refuses an overlap outside the module-s own bounds before reading anything', async () => {
    const res = await handler({
      seam: seam({ join: { partBKey: B, overlapSec: 200, curve: 'qsin', editB: null } }),
    } as never);

    expect(res).toMatchObject({ ok: false });
    expect(s3Send).not.toHaveBeenCalled();
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('reports a failed render instead of storing a broken file', async () => {
    spawnSync.mockImplementation((_cmd: unknown, args: string[]) => {
      if (args.length === 3 && args[1] === '-i') return { status: 0, stdout: '', stderr: header(120) };
      return { status: 1, stdout: '', stderr: 'lame died' };
    });
    const res = await handler({ seam: seam() } as never);

    expect(res).toMatchObject({ ok: false });
    const put = s3Send.mock.calls
      .map((c) => c[0] as { input: Record<string, unknown> })
      .find((c) => 'Body' in c.input);
    expect(put).toBeUndefined();
  });

  it('clears its temp directory either way', async () => {
    mockRmSync.mockClear();
    await handler({ seam: seam() } as never);
    expect(mockRmSync).toHaveBeenCalledWith('/tmp/master-test', { recursive: true, force: true });
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

  /**
   * The loudness path is UNCHANGED by peak mode.
   *
   * Peak mode branches inside this same handler, so the cheapest way for it to
   * go wrong is to alter the path it was supposed to sit beside. This asserts
   * the loudness shape as a whole: four of the five passes are loudnorm —
   * measure, normalize, re-measure the WAV, measure the MP3 — and only the
   * libmp3lame encode is filter-free. If peak mode ever reroutes one of them,
   * this fails before any of the peak assertions do.
   */
  it('loudness mode still runs loudnorm in every pass but the encode', async () => {
    await handler({ jobId: 'j1', s3Key: SRC_KEY, target: -14 });
    const all = spawnSync.mock.calls.map((c) => c[1] as string[]);
    expect(all).toHaveLength(5);
    expect(all.filter((a) => a.join(' ').includes('loudnorm'))).toHaveLength(4);
    expect(all.filter((a) => a.includes('libmp3lame'))).toHaveLength(1);
    // And it must never reach for the peak path's one filter.
    expect(all.join(' ')).not.toContain('volume=');
    expect(patched().normalizationMode).toBeUndefined();
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
 * Peak mode — the karaoke bed.
 *
 * The mode is defined by an ABSENCE: no loudnorm, no limiter, no compressor,
 * anywhere on the path. Measured on the real Sevvanthi bed (2026-09-16),
 * loudnorm reports `Dynamic` at -14, -18 and -20 alike even with `linear=true`,
 * so there is no integrated target that leaves a bed's dynamics alone — which
 * is why the mode exists at all rather than being "master it quieter".
 *
 * An absence is only testable if something asserts it, so the first test here
 * greps every argument list this path produces. It is the test most likely to
 * catch a future edit that reaches for the loudness path's passes because they
 * were sitting right there — including the tempting one, reusing pass 1 to
 * measure. That is why the measurement is `ebur128`.
 *
 * The three fixtures below carry DELIBERATELY DIFFERENT numbers, for the same
 * reason PASS1/PASS3/PASS4 do above: a bed's whole claim is that it came out
 * the way it went in, so a crossed wire between "before" and "after" would make
 * that claim unfalsifiable exactly where it matters.
 */
describe('peak mode — a karaoke bed', () => {
  const SRC_KEY = 'audio/mastering/2_a_bed.wav';
  const BED_KEY = 'audio/mastering/2_a_bed-karaoke-1dBTP.wav';

  /**
   * The bed as built: -2.80 dBTP, so it needs +1.80 dB to reach the -1 ceiling.
   * Carries an input header too — the peak path records the source format from
   * this log, since there is no loudnorm pass 1 to read it from.
   */
  const EBU_SRC = `ffmpeg version 6.0
Input #0, wav, from '/tmp/master-test/in.wav':
  Duration: 00:07:04.64, bitrate: 2304 kb/s
  Stream #0:0: Audio: pcm_s24le ([1][0][0][0] / 0x0001), 48000 Hz, stereo, s32 (24 bit), 2304 kb/s
[Parsed_ebur128_0 @ 0x55] Summary:

  Integrated loudness:
    I:         -20.2 LUFS
    Threshold: -30.9 LUFS

  Loudness range:
    LRA:         6.4 LU
    Threshold:  -35.0 LUFS
    LRA low:   -25.1 LUFS
    LRA high:  -18.7 LUFS

  True peak:
    Peak:       -2.8 dBFS
`;

  /** The output: lifted by exactly the gain, dynamics untouched. */
  const EBU_OUT = `[Parsed_ebur128_0 @ 0x77] Summary:

  Integrated loudness:
    I:         -18.4 LUFS
    Threshold: -29.1 LUFS

  Loudness range:
    LRA:         6.4 LU
    Threshold:  -33.2 LUFS
    LRA low:   -23.3 LUFS
    LRA high:  -16.9 LUFS

  True peak:
    Peak:       -1.0 dBFS
`;

  /** The delivered MP3, measured on the ENCODED file and on nothing else. */
  const EBU_MP3 = `[Parsed_ebur128_0 @ 0x99] Summary:

  Integrated loudness:
    I:         -18.3 LUFS
    Threshold: -29.0 LUFS

  Loudness range:
    LRA:         6.3 LU
    Threshold:  -33.1 LUFS
    LRA low:   -23.2 LUFS
    LRA high:  -16.8 LUFS

  True peak:
    Peak:       -0.95 dBFS
`;

  /** A file 19 dB below the ceiling — a stem or a muted bounce, not a bed. */
  const EBU_QUIET = EBU_SRC.replace('Peak:       -2.8 dBFS', 'Peak:       -20.0 dBFS');

  const logs = { src: EBU_SRC, gainStatus: 0, encodeStatus: 0 };

  /**
   * Passes are told apart by SHAPE, never by index — adding one pass to the
   * short broke six positional assertions at once, and this path is about to
   * grow an MP3 measure that the loudness path numbers differently.
   */
  const dispatch = (args: string[]) => {
    if (args.includes('libmp3lame')) return { status: logs.encodeStatus, stdout: '', stderr: '' };
    if (args.some((a) => a.startsWith('volume='))) return { status: logs.gainStatus, stdout: '', stderr: '' };
    if (args.some((a) => a.includes('ebur128'))) {
      const input = args[args.indexOf('-i') + 1] ?? '';
      if (input.includes('out.mp3')) return { status: 0, stdout: '', stderr: EBU_MP3 };
      return input.includes('out.wav')
        ? { status: 0, stdout: '', stderr: EBU_OUT }
        : { status: 0, stdout: '', stderr: logs.src };
    }
    return { status: 0, stdout: '', stderr: logs.src };
  };

  const peak = { jobId: 'k1', s3Key: SRC_KEY, target: -14, normalizationMode: 'peak' };
  const ffArgs = () => spawnSync.mock.calls.map((c) => c[1] as string[]);
  const putCalls = () =>
    s3Send.mock.calls
      .map((c) => c[0] as { input: Record<string, unknown> })
      .filter((c) => 'Body' in c.input);

  beforeEach(() => {
    logs.src = EBU_SRC;
    logs.gainStatus = 0;
    logs.encodeStatus = 0;
    spawnSync.mockReset();
    spawnSync.mockImplementation((_bin: string, args: string[]) => dispatch(args));
    s3Send.mockReset();
    s3Send.mockImplementation((cmd: { input: Record<string, unknown> }) =>
      'Body' in cmd.input
        ? Promise.resolve({})
        : Promise.resolve({ Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } })
    );
  });

  it.each([-14, -20])('runs NO loudnorm at target %s, not even to measure', async (target) => {
    await handler({ ...peak, target } as never);
    expect(ffArgs().join(' ')).not.toContain('loudnorm');
  });

  it('measures first, then applies ONE gain and nothing else', async () => {
    await handler(peak as never);
    const all = ffArgs();
    const gains = all.filter((a) => a.some((x) => x.startsWith('volume=')));
    expect(gains).toHaveLength(1);

    const gain = gains[0];
    expect(gain[gain.indexOf('-af') + 1]).toMatch(/^volume=-?\d+\.\d\ddB$/);
    // The one filter, and no companions: a limiter or compressor here would
    // make the mode's name a lie.
    expect(gain.join(' ')).not.toContain('alimiter');
    expect(gain.join(' ')).not.toContain('acompressor');
    // ...and it is written with the same format as the loudness path's pass 2,
    // so everything downstream treats the two outputs alike.
    expect(gain).toEqual(expect.arrayContaining(['-ar', '48000', '-c:a', 'pcm_s24le']));

    // Ordering, not just presence: the gain must come FROM a measurement.
    const measuredAt = all.findIndex((a) => a.some((x) => x.includes('ebur128')));
    expect(measuredAt).toBeGreaterThanOrEqual(0);
    expect(measuredAt).toBeLessThan(all.indexOf(gain));
  });

  it('applies the gain the measured peak actually calls for', async () => {
    await handler(peak as never);
    // -2.8 dBTP measured, -1.0 ceiling: +1.80 dB, and no rounding slop.
    const gain = ffArgs().find((a) => a.some((x) => x.startsWith('volume=')))!;
    expect(gain[gain.indexOf('-af') + 1]).toBe('volume=1.80dB');
    expect(patched().peakGainDb).toBe(1.8);
  });

  it('stores the bed under its own key, never the loudness one', async () => {
    const res = await handler(peak as never);
    const put = putCalls().find((c) => String(c.input.Key).endsWith('.wav'))!;
    expect(String(put.input.Key)).toBe(BED_KEY);
    expect(String(put.input.Key)).not.toContain('LUFS');
    expect(res).toEqual({ ok: true, masterKey: BED_KEY });
    expect(patched().masterKey).toBe(BED_KEY);
  });

  it('encodes the MP3 at 320k, which is what buyers are promised', async () => {
    await handler(peak as never);
    const mp3 = ffArgs().find((a) => a.includes('libmp3lame'))!;
    // The module default is 192k; KARAOKE_DELIVERABLE promises 320.
    expect(mp3[mp3.indexOf('-b:a') + 1]).toBe('320k');
    const put = putCalls().find((c) => String(c.input.Key).endsWith('.mp3'))!;
    expect(String(put.input.Key)).toBe('audio/mastering/2_a_bed-karaoke-1dBTP.mp3');
  });

  it('records the mode, and no loudnorm verdict it has no right to', async () => {
    await handler(peak as never);
    const p = patched();
    expect(p.normalizationMode).toBe('peak');
    expect(p.status).toBe('done');
    // No loudnorm ran, so there is no normalization type. 'linear' here would
    // be a claim about a filter that never executed.
    expect(p.normalizationType).toBeNull();
  });

  it('takes before from the source and after from the output, never the reverse', async () => {
    await handler(peak as never);
    const p = patched();
    expect(p.beforeLufs).toBe(-20.2);
    expect(p.beforeTp).toBe(-2.8);
    expect(p.beforeLra).toBe(6.4);
    expect(p.afterLufs).toBe(-18.4);
    expect(p.afterTp).toBe(-1.0);
    // The claim the whole mode exists to make: the range came out untouched.
    expect(p.afterLra).toBe(6.4);
    // Measured on the encoded MP3 and on nothing else.
    expect(p.mp3Tp).toBe(-0.95);
    expect(p.mp3Lufs).toBe(-18.3);
  });

  it('records the source format from the measure pass, there being no pass 1', async () => {
    await handler(peak as never);
    expect(patched().source).toMatchObject({ codec: 'pcm_s24le', sampleRate: 48000, channelLayout: 'stereo' });
  });

  it('refuses a bed needing an absurd boost, and stores nothing', async () => {
    logs.src = EBU_QUIET;
    const res = await handler(peak as never);
    expect(res).toEqual({ ok: false });
    expect(putCalls()).toHaveLength(0);
    expect(patched()).toMatchObject({ status: 'error', error: { code: 'needs-too-much-gain' } });
    // It stopped at the measurement — no gain pass, no encode.
    expect(ffArgs().some((a) => a.some((x) => x.startsWith('volume=')))).toBe(false);
  });

  it('refuses a file whose peak cannot be read at all', async () => {
    logs.src = 'ffmpeg version 6.0\nnothing measurable here\n';
    const res = await handler(peak as never);
    expect(res).toEqual({ ok: false });
    expect(putCalls()).toHaveLength(0);
    expect(patched()).toMatchObject({ status: 'error', error: { code: 'unreadable-peak' } });
  });

  it('fails the job rather than storing a bed the gain pass never wrote', async () => {
    logs.gainStatus = 1;
    const res = await handler(peak as never);
    expect(res).toEqual({ ok: false });
    expect(putCalls()).toHaveLength(0);
    expect(patched()).toMatchObject({ status: 'error', error: { code: 'peak-pass' } });
  });

  it('still delivers the WAV when the MP3 encode fails', async () => {
    logs.encodeStatus = 1;
    const res = await handler(peak as never);
    expect(res).toEqual({ ok: true, masterKey: BED_KEY });
    expect(patched()).toMatchObject({ status: 'done', mp3Key: null });
  });

  /**
   * The re-master guard must cover this path's OWN output.
   *
   * `isMasterKey` is deliberately not widened to match a karaoke key — it also
   * answers "is this a valid source for a video, short or upload?", and a bed
   * must never be eligible for those. So the guard composes the two predicates
   * instead. See the docblock on isKaraokeMasterKey.
   */
  it('refuses to re-master an existing karaoke bed', async () => {
    const res = await handler({ ...peak, s3Key: BED_KEY } as never);
    expect(res).toEqual({ ok: false });
    expect(spawnSync).not.toHaveBeenCalled();
    expect(s3Send).not.toHaveBeenCalled();
    expect(patched()).toMatchObject({ status: 'error', error: { code: 'already-mastered' } });
  });

  it('refuses a karaoke bed as Part B of a join, for the same reason', async () => {
    const res = await handler({
      ...peak,
      join: { partBKey: BED_KEY, overlapSec: 2 },
    } as never);
    expect(res).toEqual({ ok: false });
    expect(spawnSync).not.toHaveBeenCalled();
    expect(patched()).toMatchObject({ status: 'error', error: { code: 'bad-join-key' } });
  });

  it('refuses reference matching, which has no meaning without a loudness target', async () => {
    const res = await handler({
      ...peak,
      referenceKey: 'audio/references/a-ref.wav',
      referenceId: 'ref1',
      matchingMethod: 'matched',
    } as never);
    expect(res).toEqual({ ok: false });
    expect(spawnSync).not.toHaveBeenCalled();
    expect(patched()).toMatchObject({ status: 'error', error: { code: 'bad-mode' } });
  });

  it('refuses a normalization mode it does not recognise', async () => {
    const res = await handler({ ...peak, normalizationMode: 'brickwall' } as never);
    expect(res).toEqual({ ok: false });
    expect(spawnSync).not.toHaveBeenCalled();
    expect(patched()).toMatchObject({ status: 'error', error: { code: 'bad-mode' } });
  });

  /**
   * The OTHER half of the split, asserted end to end.
   *
   * The re-master guard composes two predicates so that `isMasterKey` can keep
   * answering its second question — "is this a valid source for a video, short
   * or YouTube upload?" — with a NO for a karaoke bed. The unit test pins that
   * `isMasterKey` does not match a bed's key; these pin what that buys, which
   * is the thing a future widening would actually break. A bed is a product
   * someone bought, not a song for the channel.
   */
  it.each([
    ['render', { render: { audioKey: BED_KEY, coverKey: 'audio/mastering/c.jpg' } }, 'videoError'],
    ['short', { short: { audioKey: BED_KEY, coverKey: 'audio/mastering/c.jpg' } }, 'shortError'],
  ])('refuses to %s a karaoke bed as if it were a master', async (_what, spec, field) => {
    const res = await handler({ jobId: 'k1', ...spec } as never);
    expect(res).toEqual({ ok: false });
    expect(spawnSync).not.toHaveBeenCalled();
    expect(s3Send).not.toHaveBeenCalled();
    expect(String(patched()[field])).toContain('mastered WAV');
  });

  it('clears its temp directory when it refuses mid-run', async () => {
    mockRmSync.mockClear();
    logs.src = EBU_QUIET;
    await handler(peak as never);
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
      // ⚠️ THE STATE THE WORKER ACTUALLY RECEIVES, not a convenient one.
      // The enqueue route calls markUploadQueued BEFORE it Event-invokes this
      // worker, so every real invocation reads back `uploadStatus: 'queued'`
      // with an `updatedAt` seconds old. This fixture used to prime `'idle'`
      // — a state the route never produces — which is the only reason the
      // worker's `in-flight` refusal of its own queued job stayed invisible
      // for twelve commits. Keep these two fields in lockstep with
      // markUploadQueued's write.
      uploadStatus: 'queued',
      updatedAt: new Date().toISOString(),
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

  /**
   * ⚠️ THE WORKER MUST NOT REFUSE THE JOB IT WAS INVOKED FOR.
   *
   * The enqueue route marks the job `queued` (stamping a fresh `updatedAt`)
   * and THEN Event-invokes this worker, so the row the worker reads back is
   * always `queued` and always seconds old. `planUpload`'s `in-flight`
   * refusal is the ENQUEUE gate — it exists to make a double-click lose the
   * race. Re-applying it here made the worker refuse its own invocation and
   * patch `failed` before any insert, so the feature could not complete even
   * once; a retry just repeated the loop. The worker therefore runs the
   * planner at `stage: 'execute'`, which skips ONLY that check.
   */
  it('uploads the job it was invoked for, even though the route already marked it queued', async () => {
    // Exactly what markUploadQueued leaves behind, re-read moments later.
    job.uploadStatus = 'queued';
    job.updatedAt = new Date().toISOString();

    const res = await handler({ jobId: 'j1', youtube: YT } as never);

    // Asserted first and separately: pre-fix this printed the refusal itself
    // — "An upload is already running for this master." — which is the worker
    // declining the very invocation the route had just queued for it.
    expect(patched().uploadError ?? null).toBeNull();
    expect(patched()).toMatchObject({ uploadStatus: 'uploaded', youtubeVideoId: 'FRESH_INSERT_ID' });
    expect(res).toMatchObject({ ok: true, videoId: 'FRESH_INSERT_ID' });
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
     * A LOCAL size mismatch says the bytes on disk are no longer the bytes the
     * session was opened against — but it says NOTHING about whether that
     * session already finished.
     *
     * ⚠️ Discarding it before the query was a second duplicate-insert path,
     * and a reachable one: PUT succeeds → the worker dies before the id patch
     * → the operator re-renders (same videoKey, different bytes) → retry →
     * mismatch → fresh session → a SECOND video on the channel. The session is
     * therefore always queried first; the mismatch only decides what happens
     * after the answer comes back.
     */
    it('queries the session even on a LOCAL size mismatch, then discards it only once the query says 308', async () => {
      // mockStatSync always returns { size: 123456 } (see the top of this
      // file) — a declared size that disagrees with that is unambiguously a
      // different file than the one the session was opened against.
      job.uploadSessionSize = 999;

      fetchMock.mockImplementation((url: string) => {
        if (url.includes('oauth2.googleapis.com/token')) {
          return Promise.resolve({ ok: true, json: async () => ({ access_token: 'ACCESS-TOKEN' }) });
        }
        if (url === EXISTING_SESSION) {
          // Incomplete — so the session really is unusable for these bytes.
          return Promise.resolve({ status: 308, ok: false, headers: { get: () => null } });
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
      // THE property, inverted from what this test used to assert: the stored
      // session IS asked, exactly once (the query — never a data PUT against
      // bytes it cannot accept), before it is given up on.
      const sessionCalls = fetchMock.mock.calls.filter((c) => c[0] === EXISTING_SESSION);
      expect(sessionCalls).toHaveLength(1);
      expect((sessionCalls[0][1] as { body?: unknown }).body).toBeUndefined();
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('uploadType=resumable'))).toBe(true);
      expect(patched()).toMatchObject({ youtubeVideoId: 'FRESH_AFTER_SIZE_MISMATCH', uploadStatus: 'uploaded' });
    });

    /**
     * ⚠️ THE DUPLICATE THIS FIX EXISTS TO STOP. Same mismatch, but the session
     * had ALREADY completed — the previous invocation's PUT landed and only
     * the id write was lost. Discarding on the local mismatch skipped this
     * 200 branch entirely and opened a fresh insert: a second video on a real
     * channel, removable only by hand.
     *
     * The recovered video was built from the OLDER bytes (the re-render is not
     * what is on YouTube). That is the correct trade: a video file cannot be
     * replaced on YouTube either way, and recovering the id leaves ONE video
     * the operator can see and delete, rather than two.
     */
    it('recovers the id when a size-mismatched session turns out to have COMPLETED — never a second insert', async () => {
      job.uploadSessionSize = 999;

      fetchMock.mockImplementation((url: string) => {
        if (url.includes('oauth2.googleapis.com/token')) {
          return Promise.resolve({ ok: true, json: async () => ({ access_token: 'ACCESS-TOKEN' }) });
        }
        if (url === EXISTING_SESSION) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: 'RECOVERED_DESPITE_MISMATCH' }) });
        }
        if (url.includes('/thumbnails/set')) return Promise.resolve({ ok: true });
        if (url.includes('/playlistItems')) return Promise.resolve({ ok: true });
        return Promise.resolve({ ok: false, status: 500, text: async () => '' });
      });

      const res = await handler({ jobId: 'j1', youtube: YT } as never);

      expect(res).toMatchObject({ ok: true, videoId: 'RECOVERED_DESPITE_MISMATCH' });
      // THE property: no second video was created.
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('uploadType=resumable'))).toBe(false);
      // The query's total describes the SESSION (999), not the re-rendered
      // file on disk (mockStatSync's 123456). Getting this backwards asks
      // Google about a size the session never declared — a 400, which
      // sessionIsGone deliberately keeps, jamming every later retry.
      const queryCall = fetchMock.mock.calls.find((c) => c[0] === EXISTING_SESSION)!;
      expect((queryCall[1] as { headers: Record<string, string> }).headers['Content-Range']).toBe('bytes */999');
      expect(patched()).toMatchObject({
        youtubeVideoId: 'RECOVERED_DESPITE_MISMATCH',
        uploadStatus: 'uploaded',
      });
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

/**
 * The slideshow render.
 *
 * The property under test is never "the cut lands at 2:10" — the planner owns
 * that and has its own tests. It is that the worker's execution keeps the
 * compose-once architecture: one filter run per IMAGE, none per frame, and a
 * join that copies the picture rather than re-encoding it. A regression here
 * does not throw. The Lambda is killed at 900 s and the row says nothing.
 */
describe('slideshow render', () => {
  const AUDIO = 'audio/mastering/1_a_song-master-14LUFS.wav';
  const A = 'audio/mastering/1_c_a.jpg';
  const B = 'audio/mastering/1_c_b.jpg';
  const C = 'audio/mastering/1_c_c.png';
  const ffArgs = () => spawnSync.mock.calls.map((c) => c[1] as string[]);
  /** A 5:32 master, as the WAV header prints it. */
  const HEADER = 'Input #0, wav, from \'/tmp/master-test/master.wav\':\n' +
    '  Duration: 00:05:32.00, bitrate: 2304 kb/s\n' +
    '  Stream #0:0: Audio: pcm_s24le, 48000 Hz, stereo, s32 (24 bit), 2304 kb/s\n';

  const slideshow = (over: Record<string, unknown> = {}) => ({
    audioKey: AUDIO,
    coverKey: A,
    height: 1440,
    covers: [
      { coverKey: A, startSec: 0 },
      { coverKey: B, startSec: 130 },
      { coverKey: C, startSec: 240 },
    ],
    ...over,
  });

  beforeEach(() => {
    spawnSync.mockReset();
    // Only the audio-header probe returns a duration; every other call is a
    // plain success. The duration probe and the cover probe share a shape
    // (`-hide_banner -i PATH`), so they are told apart by the path.
    spawnSync.mockImplementation((_cmd: string, args: string[]) =>
      args.length === 3 && args[2].includes('master.wav')
        ? { status: 1, stdout: '', stderr: HEADER }
        : { status: 0, stdout: '', stderr: '' }
    );
    s3Send.mockReset();
    s3Send.mockImplementation((cmd: { input: Record<string, unknown> }) =>
      'Body' in cmd.input
        ? Promise.resolve({})
        : Promise.resolve({ Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } })
    );
  });

  it('composes once per image and never filters an encode', async () => {
    const res = await handler({ jobId: 'j1', render: slideshow() } as never);
    expect(res).toMatchObject({ ok: true });

    const filtered = ffArgs().filter((a) => a.includes('-filter_complex'));
    // Three images, three filter runs. Not 3,320 — which is what a filter in
    // any encode step would silently cost.
    expect(filtered).toHaveLength(3);
    for (const a of filtered) expect(a).toContain('-frames:v');

    const encodes = ffArgs().filter((a) => a.includes('libx264'));
    expect(encodes).toHaveLength(3);
    for (const a of encodes) {
      expect(a).not.toContain('-filter_complex');
      expect(a).not.toContain('-vf');
    }
  });

  it('bounds each segment by the planned length, with the last from the song', async () => {
    await handler({ jobId: 'j1', render: slideshow() } as never);
    const lengths = ffArgs()
      .filter((a) => a.includes('libx264'))
      .map((a) => Number(a[a.indexOf('-t') + 1]));
    // 5:32 is 332 s: 0-130, 130-240, and the tail nobody supplied.
    expect(lengths).toEqual([130, 110, 92]);
  });

  it('joins with a stream copy and encodes the song exactly once', async () => {
    await handler({ jobId: 'j1', render: slideshow() } as never);
    const join = ffArgs().find((a) => a.includes('concat'))!;

    expect(join[join.indexOf('-c:v') + 1]).toBe('copy');
    expect(join[join.lastIndexOf('-i') + 1]).toContain('master.wav');
    // One AAC encode for the whole song. Per-segment audio would put a codec
    // seam at every cut, mid-song.
    expect(ffArgs().filter((a) => a.includes('aac'))).toHaveLength(1);
  });

  it('derives the duration from the WAV, never from the event', async () => {
    // An event that got the duration wrong would freeze on a still or truncate
    // the song, with no error to point at.
    await handler({
      jobId: 'j1',
      render: slideshow({ durationSec: 9999, covers: [{ coverKey: A, startSec: 0 }, { coverKey: B, startSec: 130 }] }),
    } as never);
    const lengths = ffArgs()
      .filter((a) => a.includes('libx264'))
      .map((a) => Number(a[a.indexOf('-t') + 1]));
    expect(lengths).toEqual([130, 202]);
  });

  it('refuses when the header will not say how long the song is', async () => {
    spawnSync.mockImplementation(() => ({ status: 0, stdout: '', stderr: '' }));
    const res = await handler({ jobId: 'j1', render: slideshow() } as never);

    expect(res).toEqual({ ok: false });
    expect(patched().videoError).toMatch(/length|unknown/i);
    expect(ffArgs().some((a) => a.includes('libx264'))).toBe(false);
  });

  it('guards every cover key, and downloads nothing when one fails', async () => {
    const res = await handler({
      jobId: 'j1',
      render: slideshow({ covers: [{ coverKey: A, startSec: 0 }, { coverKey: 'deliveries/theirs.jpg', startSec: 130 }] }),
    } as never);

    expect(res).toEqual({ ok: false });
    expect(patched().videoError).toContain('mastering workspace');
    expect(s3Send).not.toHaveBeenCalled();
  });

  it('refuses a cut past the end of the song rather than rendering a gap', async () => {
    const res = await handler({
      jobId: 'j1',
      render: slideshow({ covers: [{ coverKey: A, startSec: 0 }, { coverKey: B, startSec: 400 }] }),
    } as never);
    expect(res).toEqual({ ok: false });
    expect(patched().videoError).toMatch(/after the song ends/i);
  });

  it('records the FIRST image as the cover — it becomes the thumbnail', async () => {
    await handler({ jobId: 'j1', render: slideshow() } as never);
    // The thumbnail should be the frame the video opens on, not an image from
    // the middle of it.
    expect(patched().coverKey).toBe(A);
    expect(patched().videoKey).toContain('-1440p.mp4');
  });

  it('composes a repeated image once, not once per appearance', async () => {
    // An image that returns later in the song is a real edit, and downloading
    // and re-composing it is pure waste inside a 900 s budget.
    await handler({
      jobId: 'j1',
      render: slideshow({
        covers: [{ coverKey: A, startSec: 0 }, { coverKey: B, startSec: 100 }, { coverKey: A, startSec: 200 }],
      }),
    } as never);

    expect(ffArgs().filter((a) => a.includes('-filter_complex'))).toHaveLength(2);
    expect(ffArgs().filter((a) => a.includes('libx264'))).toHaveLength(3);
  });

  it('a render with no covers takes the single-image path, untouched', async () => {
    // The regression guard for the whole feature: the old event shape must not
    // gain a segment encode or a concat.
    const res = await handler({ jobId: 'j1', render: { audioKey: AUDIO, coverKey: A, height: 1440 } } as never);

    expect(res).toMatchObject({ ok: true });
    expect(ffArgs().some((a) => a.includes('concat'))).toBe(false);
    expect(ffArgs().some((a) => a.includes('-an'))).toBe(false);
    // the audio-duration probe, the cover probe, compose, encode, and the two
    // verification measurements — no segment encode and no join.
    expect(spawnSync).toHaveBeenCalledTimes(6);
    expect(ffArgs().filter((a) => a.includes('libx264'))).toHaveLength(1);
  });
});

/**
 * The worker writes its intermediate frames in the format the library names —
 * all three of them. The Short composes one, the single-image render composes
 * one, and the slideshow composes one per image; a site left on `.png` would
 * silently keep paying the 2.5x on that path alone.
 */
describe('composed frames use the library\'s format', () => {
  const AUDIO = 'audio/mastering/1_a_song-master-14LUFS.wav';
  const COVER = 'audio/mastering/1_c_cover.jpg';
  const ffArgs = () => spawnSync.mock.calls.map((c) => c[1] as string[]);
  /** Whatever a compose pass wrote — it is the last argument, after -y. */
  const composedFrames = () => ffArgs()
    .filter((a) => a.includes('-frames:v'))
    .map((a) => a[a.length - 1]);

  beforeEach(() => {
    spawnSync.mockReset();
    spawnSync.mockImplementation((_cmd: string, args: string[]) =>
      args.length === 3 && args[2].includes('master.wav')
        ? { status: 1, stdout: '', stderr: 'Input #0, wav, from \'/tmp/x.wav\':\n  Duration: 00:05:32.00, bitrate: 2304 kb/s\n  Stream #0:0: Audio: pcm_s24le, 48000 Hz, stereo, s32 (24 bit), 2304 kb/s\n' }
        : { status: 0, stdout: '', stderr: '' }
    );
    s3Send.mockReset();
    s3Send.mockImplementation((cmd: { input: Record<string, unknown> }) =>
      'Body' in cmd.input
        ? Promise.resolve({})
        : Promise.resolve({ Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } })
    );
  });

  it('the single-image render composes to .ppm', async () => {
    await handler({ jobId: 'j1', render: { audioKey: AUDIO, coverKey: COVER, height: 1440 } } as never);
    const frames = composedFrames();
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatch(/\.ppm$/);
  });

  it('every slideshow frame is .ppm, not just the first', async () => {
    await handler({
      jobId: 'j1',
      render: {
        audioKey: AUDIO, coverKey: COVER, height: 1440,
        covers: [
          { coverKey: COVER, startSec: 0 },
          { coverKey: 'audio/mastering/1_c_b.jpg', startSec: 130 },
          { coverKey: 'audio/mastering/1_c_c.png', startSec: 240 },
        ],
      },
    } as never);
    const frames = composedFrames();
    expect(frames).toHaveLength(3);
    for (const f of frames) expect(f).toMatch(/\.ppm$/);
  });

  it('the encode reads back the frame that was composed', async () => {
    // The format is two edits in two places; getting one and not the other
    // means ffmpeg is handed a path that does not exist.
    await handler({ jobId: 'j1', render: { audioKey: AUDIO, coverKey: COVER, height: 1440 } } as never);
    const [composed] = composedFrames();
    const encode = ffArgs().find((a) => a.includes('libx264'))!;
    expect(encode).toContain(composed);
  });
});

/**
 * Verifying the rendered audio against its master.
 *
 * Until this existed the render wrote an MP4 and nothing measured it, so a
 * video stage that resampled or truncated the song produced a file that looked
 * finished and was uploaded by hand. The first evidence would have been a
 * listener.
 *
 * The behaviour worth pinning hardest is the negative one: this check must
 * never be able to break a render. A safety net that drops good work is one the
 * operator learns to cut away.
 */
describe('rendered audio is checked against the master', () => {
  const AUDIO = 'audio/mastering/1_a_song-master-14LUFS.wav';
  const COVER = 'audio/mastering/1_c_cover.jpg';
  const ffArgs = () => spawnSync.mock.calls.map((c) => c[1] as string[]);

  /**
   * ffmpeg's measurement output for one file. The verifier reads duration,
   * sample rate and channels from the input header and the loudness figures
   * from the ebur128 summary, so a realistic log carries both.
   */
  const measureLog = (o: { dur?: string; rate?: number; ch?: string; lufs?: number; tp?: number; lra?: number; samples?: number } = {}) =>
    `Input #0, wav, from '/tmp/x':\n` +
    `  Duration: ${o.dur ?? '00:05:32.00'}, bitrate: 2304 kb/s\n` +
    `  Stream #0:0: Audio: pcm_s24le, ${o.rate ?? 48000} Hz, ${o.ch ?? 'stereo'}, s32 (24 bit), 2304 kb/s\n` +
    `[Parsed_ebur128_0 @ 0x0] Summary:\n\n` +
    `  Integrated loudness:\n` +
    `    I:         ${o.lufs ?? -14.0} LUFS\n` +
    `    Threshold: -24.5 LUFS\n\n` +
    `  Loudness range:\n` +
    `    LRA:       ${o.lra ?? 7.2} LU\n` +
    `    Threshold: -34.5 LUFS\n` +
    `    LRA low:   -20.0 LUFS\n` +
    `    LRA high:  -12.8 LUFS\n\n` +
    `  True peak:\n` +
    `    Peak:      ${o.tp ?? -1.5} dBFS\n` +
    // astats' sample count is where the AUDIO length comes from — the header
    // Duration above is the container's, which for an MP4 is the picture.
    `[Parsed_astats_1 @ 0x0] Number of samples: ${o.samples ?? 15960960}\n`;

  /** Only the two measurement passes return logs; everything else succeeds plainly. */
  const wireMeasure = (masterLog: string, outputLog: string) => {
    spawnSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('ebur128=peak=true,astats=metadata=1:measure_perchannel=0')) {
        const target = args[args.indexOf('-i') + 1];
        return { status: 0, stdout: '', stderr: target.includes('.mp4') ? outputLog : masterLog };
      }
      return { status: 0, stdout: '', stderr: '' };
    });
  };

  beforeEach(() => {
    spawnSync.mockReset();
    wireMeasure(measureLog(), measureLog());
    s3Send.mockReset();
    s3Send.mockImplementation((cmd: { input: Record<string, unknown> }) =>
      'Body' in cmd.input
        ? Promise.resolve({})
        : Promise.resolve({ Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } })
    );
  });

  const render = () => handler({
    jobId: 'j1', render: { audioKey: AUDIO, coverKey: COVER, height: 1440 },
  } as never);

  it('measures both files and records that they match', async () => {
    const res = await render();

    expect(res).toMatchObject({ ok: true, audioCheck: 'passed' });
    expect(patched().videoAudioCheck).toBe('passed');
    expect(patched().videoAudioFindings).toEqual([]);
    // Two measurement passes: the master and the MP4. Comparing a measured
    // figure against a stored one would be comparing two different things.
    const measures = ffArgs().filter((a) => a.join(' ').includes('ebur128'));
    expect(measures).toHaveLength(2);
    expect(measures.map((a) => a[a.indexOf('-i') + 1]).some((p) => p.endsWith('.wav'))).toBe(true);
    expect(measures.map((a) => a[a.indexOf('-i') + 1]).some((p) => p.endsWith('.mp4'))).toBe(true);
  });

  it('records a failure when the render truncated the song', async () => {
    // The likeliest real fault, and the one a human would never catch by
    // looking at the library.
    // 310 s of audio against the master's 332 s — expressed in samples,
    // because the sample count is what the length is read from now.
    wireMeasure(measureLog(), measureLog({ dur: '00:05:10.00', samples: 310 * 48000 }));
    const res = await render();

    expect(res).toMatchObject({ ok: true });
    expect(patched().videoAudioCheck).toBe('failed');
    expect((patched().videoAudioFindings as string[])[0]).toMatch(/cut off/);
  });

  it('records a failure when the audio was re-levelled', async () => {
    wireMeasure(measureLog(), measureLog({ lufs: -11.2 }));
    await render();
    expect(patched().videoAudioCheck).toBe('failed');
    expect((patched().videoAudioFindings as string[])[0]).toMatch(/re-levelled/);
  });

  it('still uploads the MP4 when the check fails — the operator has to see it', async () => {
    wireMeasure(measureLog(), measureLog({ dur: '00:05:10.00', samples: 310 * 48000 }));
    await render();

    // A failed check means LOOK at the file. Deleting it, or refusing to store
    // it, makes that impossible and turns a diagnosis into a mystery.
    const puts = s3Send.mock.calls.filter((c) => 'Body' in (c[0] as { input: object }).input);
    expect(puts).toHaveLength(1);
    expect(patched().videoKey).toContain('-1440p.mp4');
    expect(patched().videoError).toBeNull();
  });

  it('never fails the render when the check itself cannot run', async () => {
    // ⚠️ The property that matters most. A verification step able to break a
    // good render is worse than none: the operator routes around it, and then
    // it defends nothing.
    spawnSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.join(' ').includes('ebur128')) throw new Error('ffmpeg exploded');
      return { status: 0, stdout: '', stderr: '' };
    });
    const res = await render();

    expect(res).toMatchObject({ ok: true });
    expect(patched().videoAudioCheck).toBe('unknown');
    expect(patched().videoKey).toContain('-1440p.mp4');
  });

  it('records unknown, not failed, when ffmpeg reports nothing useful', async () => {
    wireMeasure('', '');
    await render();
    expect(patched().videoAudioCheck).toBe('unknown');
  });
});

/**
 * The regression that blocked அன்னக் கிளியே.
 *
 * ⚠️ A REAL FALSE POSITIVE, 2026-09-22. The render was correct — its audio
 * matched the master exactly — but the MP4's container duration is its LONGEST
 * stream, and the picture ran 2.4 s past the sound. The check compared that
 * against the WAV's header and refused the upload of a good file.
 *
 * These numbers are the real ones from that render.
 */
describe('a video whose picture outruns its sound still passes', () => {
  const AUDIO = 'audio/mastering/1_a_song-master-14LUFS.wav';
  const COVER = 'audio/mastering/1_c_cover.jpg';

  /** 221.92 s of audio. The MP4 additionally claims 224.30 s in its header. */
  const MASTER_LOG =
    "Input #0, wav, from '/tmp/master.wav':\n" +
    '  Duration: 00:03:41.92, bitrate: 2304 kb/s\n' +
    '  Stream #0:0: Audio: pcm_s24le, 48000 Hz, stereo, s32 (24 bit), 2304 kb/s\n' +
    '[Parsed_ebur128_0 @ 0x0] Summary:\n\n  Integrated loudness:\n    I:         -14.0 LUFS\n' +
    '\n  Loudness range:\n    LRA:       3.7 LU\n\n  True peak:\n    Peak:      -1.5 dBFS\n' +
    '[Parsed_astats_1 @ 0x0] Number of samples: 10652160\n';

  const VIDEO_LOG =
    "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/tmp/out.mp4':\n" +
    // ⚠️ The container says 224.30 — that is the PICTURE.
    '  Duration: 00:03:44.30, bitrate: 1457 kb/s\n' +
    '  Stream #0:1: Audio: aac (LC), 48000 Hz, stereo, fltp, 384 kb/s\n' +
    '[Parsed_ebur128_0 @ 0x0] Summary:\n\n  Integrated loudness:\n    I:         -14.0 LUFS\n' +
    '\n  Loudness range:\n    LRA:       3.7 LU\n\n  True peak:\n    Peak:      -1.5 dBFS\n' +
    // …while the audio is 10652672 samples = 221.93 s. 512 samples of AAC
    // padding above the master, and nothing else.
    '[Parsed_astats_1 @ 0x0] Number of samples: 10652672\n';

  beforeEach(() => {
    spawnSync.mockReset();
    spawnSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('ebur128=peak=true,astats=metadata=1:measure_perchannel=0')) {
        const target = args[args.indexOf('-i') + 1];
        return { status: 0, stdout: '', stderr: target.includes('.mp4') ? VIDEO_LOG : MASTER_LOG };
      }
      return { status: 0, stdout: '', stderr: '' };
    });
    s3Send.mockReset();
    s3Send.mockImplementation((cmd: { input: Record<string, unknown> }) =>
      'Body' in cmd.input
        ? Promise.resolve({})
        : Promise.resolve({ Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } })
    );
  });

  it('passes, because the AUDIO matches even though the container does not', async () => {
    const res = await handler({
      jobId: 'j1', render: { audioKey: AUDIO, coverKey: COVER, height: 1440 },
    } as never);

    expect(res).toMatchObject({ ok: true, audioCheck: 'passed' });
    expect(patched().videoAudioCheck).toBe('passed');
    expect(patched().videoAudioFindings).toEqual([]);
  });

  it('does not report a duration difference of any kind', async () => {
    await handler({ jobId: 'j1', render: { audioKey: AUDIO, coverKey: COVER, height: 1440 } } as never);
    expect((patched().videoAudioFindings as string[]).join(' ')).not.toMatch(/longer|SHORTER|cut off/);
  });
});
