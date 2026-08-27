/** @jest-environment node */
/**
 * POST /api/admin/music-lab/master — reference-matching validation branches
 * (Phase 1B PR 3). The pre-existing loudnorm-only path is not re-verified here
 * beyond a smoke case that confirms the reference-matching additions did not
 * change its shape.
 */

jest.mock('@/lib/auth-helper', () => ({
  requireAdmin: jest.fn().mockResolvedValue({ email: 'admin@test' }),
  requireBearer: jest.fn(),
  authErrorResponse: jest.fn((err: unknown) => new Response(String(err), { status: 401 })),
}));

const createMock = jest.fn().mockResolvedValue({});
jest.mock('@/infrastructure/database/MasterJobRepository', () => ({
  MasterJobRepository: jest.fn().mockImplementation(() => ({ create: createMock })),
}));

const lambdaSend = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn().mockImplementation(() => ({ send: lambdaSend })),
  InvokeCommand: jest.fn((args: unknown) => ({ __command: 'Invoke', args })),
}));

jest.mock('@/lib/aws-config', () => ({
  awsConfig: { region: 'ca-central-1', credentials: undefined },
}));

import { POST } from '@/app/api/admin/music-lab/master/route';
import { FEATURES } from '@/config/features';

const originalFlag = FEATURES.ADMIN.MASTERING_REFERENCE_MATCHING;
afterEach(() => {
  (FEATURES.ADMIN as { MASTERING_REFERENCE_MATCHING: boolean }).MASTERING_REFERENCE_MATCHING = originalFlag;
  createMock.mockClear();
  lambdaSend.mockClear();
});

async function invoke(body: unknown) {
  const req = new Request('http://localhost/api/admin/music-lab/master', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
  return POST(req as unknown as import('next/server').NextRequest);
}

describe('feature-flag gate — MASTERING_REFERENCE_MATCHING off', () => {
  it('accepts a loudnorm-only job (referenceKey/matchingMethod absent) even with the flag off', async () => {
    (FEATURES.ADMIN as { MASTERING_REFERENCE_MATCHING: boolean }).MASTERING_REFERENCE_MATCHING = false;
    const res = await invoke({ s3Key: 'audio/mastering/song.wav' });
    expect(res.status).toBe(202);
    expect(createMock).toHaveBeenCalledTimes(1);
    // Reference-matching fields ARE persisted as null, but no matching params leak into the Lambda payload.
    const [, input] = createMock.mock.calls[0];
    expect(input.referenceKey).toBe(null);
    expect(input.matchingMethod).toBe(null);
    const payload = JSON.parse(Buffer.from(lambdaSend.mock.calls[0][0].args.Payload).toString());
    expect(payload).not.toHaveProperty('referenceKey');
    expect(payload).not.toHaveProperty('matchingMethod');
  });

  it('rejects a referenceKey with 501 when the flag is off', async () => {
    (FEATURES.ADMIN as { MASTERING_REFERENCE_MATCHING: boolean }).MASTERING_REFERENCE_MATCHING = false;
    const res = await invoke({
      s3Key: 'audio/mastering/song.wav',
      referenceKey: 'audio/references/ref.wav',
      matchingMethod: 'matched',
    });
    expect(res.status).toBe(501);
    expect(createMock).not.toHaveBeenCalled();
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  it("rejects matchingMethod='matched' with 501 even when referenceKey is absent (caller clearly wanted it)", async () => {
    (FEATURES.ADMIN as { MASTERING_REFERENCE_MATCHING: boolean }).MASTERING_REFERENCE_MATCHING = false;
    const res = await invoke({ s3Key: 'audio/mastering/song.wav', matchingMethod: 'matched' });
    expect(res.status).toBe(501);
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe('validation when the flag is on', () => {
  beforeEach(() => {
    (FEATURES.ADMIN as { MASTERING_REFERENCE_MATCHING: boolean }).MASTERING_REFERENCE_MATCHING = true;
  });

  it("rejects matchingMethod='matched' without a referenceKey (400)", async () => {
    const res = await invoke({ s3Key: 'audio/mastering/song.wav', matchingMethod: 'matched' });
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rejects a referenceKey with the wrong prefix (400)', async () => {
    const res = await invoke({
      s3Key: 'audio/mastering/song.wav',
      referenceKey: 'audio/mastering/not-a-reference.wav',
      matchingMethod: 'matched',
    });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown matchingMethod value (400)', async () => {
    const res = await invoke({ s3Key: 'audio/mastering/song.wav', matchingMethod: 'aggressive' });
    expect(res.status).toBe(400);
  });

  it('rejects referenceKey supplied without matchingMethod (400)', async () => {
    const res = await invoke({
      s3Key: 'audio/mastering/song.wav',
      referenceKey: 'audio/references/ref.wav',
    });
    expect(res.status).toBe(400);
  });

  it("rejects referenceKey supplied with matchingMethod='loudnorm' (400)", async () => {
    const res = await invoke({
      s3Key: 'audio/mastering/song.wav',
      referenceKey: 'audio/references/ref.wav',
      matchingMethod: 'loudnorm',
    });
    expect(res.status).toBe(400);
  });

  it('accepts a valid reference-matching request and passes fields through', async () => {
    const res = await invoke({
      s3Key: 'audio/mastering/song.wav',
      referenceKey: 'audio/references/raj-emo-01.wav',
      referenceId: 'raj-emo-01',
      matchingMethod: 'both',
    });
    expect(res.status).toBe(202);
    const [, input] = createMock.mock.calls[0];
    expect(input.referenceKey).toBe('audio/references/raj-emo-01.wav');
    expect(input.referenceId).toBe('raj-emo-01');
    expect(input.matchingMethod).toBe('both');
    // Lambda payload carries the matching fields when actually requested.
    const payload = JSON.parse(Buffer.from(lambdaSend.mock.calls[0][0].args.Payload).toString());
    expect(payload.referenceKey).toBe('audio/references/raj-emo-01.wav');
    expect(payload.referenceId).toBe('raj-emo-01');
    expect(payload.matchingMethod).toBe('both');
  });
});
