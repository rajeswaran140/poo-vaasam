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
