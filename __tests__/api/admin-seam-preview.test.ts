/** @jest-environment node */
/**
 * /api/admin/mastering/seam-preview — enqueue a crossfade preview, then poll it.
 *
 * Two properties carry this route. First, it is NOT job-scoped: at the moment a
 * crossfade is being decided there is usually no MasterJob at all, so the
 * preview is named by a fingerprint of the settings instead. Second, the GET
 * presigns — so it must only ever presign keys this module produced, or an
 * admin session becomes a presigner for the whole bucket.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const mockLambdaSend = jest.fn();
jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn().mockImplementation(() => ({ send: mockLambdaSend })),
  InvokeCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

const mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
  HeadObjectCommand: jest.fn().mockImplementation((input) => ({ input, __head: true })),
  GetObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://s3/presigned-seam'),
}));

import { POST, GET } from '@/app/api/admin/mastering/seam-preview/route';
import { InvokeCommand } from '@aws-sdk/client-lambda';
import { seamPreviewKey } from '@/lib/seam-preview';
import { DEFAULT_CROSSFADE_CURVE } from '@/lib/master-join';
import * as auth from '@/lib/auth-helper';

const requireAdmin = auth.requireAdmin as jest.Mock;
const MockInvoke = InvokeCommand as unknown as jest.Mock;

const A = 'audio/mastering/1700000000000_ab12_part-a.wav';
const B = 'audio/mastering/1700000000000_cd34_part-b.wav';
const JOIN = { partBKey: B, overlapSec: 4, curve: DEFAULT_CROSSFADE_CURVE, editB: null };
const KEY = seamPreviewKey({ partAKey: A, partBKey: B, editA: null, join: JOIN });

const post = (body: unknown, withBearer = true) =>
  POST(
    new NextRequest('https://tamilagaval.com/api/admin/mastering/seam-preview', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: withBearer ? { Authorization: 'Bearer test-token' } : undefined,
    })
  );
const get = (key: string) =>
  GET(new NextRequest(`https://tamilagaval.com/api/admin/mastering/seam-preview?key=${encodeURIComponent(key)}`));

/** S3 says "not there" the way it actually does — by throwing. */
const notFound = () => mockS3Send.mockRejectedValue(Object.assign(new Error('NotFound'), { name: 'NotFound' }));
const found = (meta: Record<string, string> = {}) =>
  mockS3Send.mockResolvedValue({ Metadata: meta });

beforeEach(() => {
  jest.clearAllMocks();
  requireAdmin.mockResolvedValue({ isAuthenticated: true, userId: 'admin-1' });
  mockLambdaSend.mockResolvedValue({});
});

describe('POST — enqueue', () => {
  it('403s for a non-admin and 401s without a Bearer token', async () => {
    const { AuthError } = jest.requireActual('@/lib/auth-helper');
    requireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
    expect((await post({ partAKey: A, join: JOIN })).status).toBe(403);

    expect((await post({ partAKey: A, join: JOIN }, false)).status).toBe(401);
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });

  it('queues a seam event carrying NO jobId', async () => {
    notFound();
    const res = await post({ partAKey: A, join: JOIN });
    expect(res.status).toBe(202);

    const payload = JSON.parse(Buffer.from(MockInvoke.mock.calls[0][0].Payload).toString());
    expect(payload.seam).toMatchObject({ partAKey: A, partBKey: B });
    // A preview belongs to no job, and must not look like a master run.
    expect(payload.jobId).toBeUndefined();
    expect(payload.s3Key).toBeUndefined();
    expect(payload.render).toBeUndefined();
    expect((await res.json()).previewKey).toBe(KEY);
  });

  it('returns a seam already rendered without invoking anything', async () => {
    // The fingerprint means identical settings name an identical file, so
    // nudging a value back to one already heard costs a HeadObject.
    found({ 'seam-tail-lufs': '-14.0', 'seam-head-lufs': '-14.3' });
    const res = await post({ partAKey: A, join: JOIN });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ready');
    expect(body.levels).toMatchObject({ gapLu: 0.3, mismatched: false });
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });

  it('refuses a part outside the mastering workspace', async () => {
    notFound();
    expect((await post({ partAKey: 'audio/poem-music/a.wav', join: JOIN })).status).toBe(409);
    expect(
      (await post({ partAKey: A, join: { ...JOIN, partBKey: 'audio/poem-music/b.wav' } })).status
    ).toBe(409);
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });

  it('rejects a malformed crossfade with the SAME parser mastering uses', async () => {
    notFound();
    // An overlap outside the module's bounds must not preview, or the operator
    // tunes against something that will later be refused.
    expect((await post({ partAKey: A, join: { ...JOIN, overlapSec: 200 } })).status).toBe(400);
    expect((await post({ partAKey: A, join: { ...JOIN, curve: 'wobble' } })).status).toBe(400);
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });

  it('says there is nothing to preview when no crossfade was given', async () => {
    // Distinct from malformed: no join is an ordinary state (a single-part
    // master), not a bad request.
    notFound();
    for (const body of [{ partAKey: A, join: null }, { partAKey: A }]) {
      const res = await post(body);
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/no crossfade/i);
    }
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });
});

describe('GET — poll', () => {
  it('reports pending until the render lands', async () => {
    notFound();
    const res = await get(KEY);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('pending');
  });

  it('presigns the clip and explains the level gap once it is there', async () => {
    found({ 'seam-tail-lufs': '-13.0', 'seam-head-lufs': '-16.0' });
    const body = await (await get(KEY)).json();

    expect(body).toMatchObject({ status: 'ready', url: 'https://s3/presigned-seam' });
    expect(body.levels).toMatchObject({ gapLu: 3, mismatched: true });
    expect(body.levelsNote).toMatch(/Match the parts/i);
  });

  it('REFUSES to presign anything but its own previews', async () => {
    // Otherwise an admin session turns this into a presigner for the bucket.
    for (const key of [
      'audio/mastering/1_a_song-master-14LUFS.wav',
      'audio/poem-music/published.mp3',
      'audio/mastering/seam/../../secret.mp3',
      '',
    ]) {
      const res = await get(key);
      expect(res.status).toBe(400);
    }
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  it('403s for a non-admin', async () => {
    const { AuthError } = jest.requireActual('@/lib/auth-helper');
    requireAdmin.mockRejectedValueOnce(new AuthError('Forbidden', 403));
    expect((await get(KEY)).status).toBe(403);
  });

  it('says unknown rather than zero when a reading is missing', async () => {
    found({});
    const body = await (await get(KEY)).json();
    expect(body.levels.gapLu).toBeNull();
    expect(body.levelsNote).toMatch(/could not be measured/i);
  });
});
