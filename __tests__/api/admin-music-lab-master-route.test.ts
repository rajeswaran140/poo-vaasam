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
const parentGet = jest.fn();
jest.mock('@/infrastructure/database/MasterJobRepository', () => ({
  MasterJobRepository: jest.fn().mockImplementation(() => ({ create: createMock, get: parentGet })),
}));

const setGet = jest.fn().mockResolvedValue(null);
jest.mock('@/infrastructure/database/StemSetRepository', () => ({
  StemSetRepository: jest.fn().mockImplementation(() => ({ get: setGet })),
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
    // The create() call shape stays byte-identical to before: matching fields
    // are only spread in when actually requested. Repository defaults-null-fill
    // absent fields, so the DB row still shows null for the matching columns.
    const [, input] = createMock.mock.calls[0];
    expect(input).not.toHaveProperty('referenceKey');
    expect(input).not.toHaveProperty('matchingMethod');
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

describe('lineage', () => {
  const PARENT = { id: 'p1', savedAt: '2026-10-01T00:00:00.000Z', s3Key: 'audio/mastering/song.wav' };
  beforeEach(() => { parentGet.mockReset(); setGet.mockReset().mockResolvedValue(null); });

  it('sends nothing new when no parent is claimed', async () => {
    await invoke({ s3Key: 'audio/mastering/song.wav' });
    expect(createMock.mock.calls[0][1]).not.toHaveProperty('derivedFrom');
    expect(parentGet).not.toHaveBeenCalled();
  });

  it('records a verified re-master', async () => {
    parentGet.mockResolvedValue(PARENT);
    const res = await invoke({ s3Key: 'audio/mastering/song.wav', derivedFrom: { jobId: 'p1' } });
    expect(res.status).toBe(202);
    expect(createMock.mock.calls[0][1].derivedFrom).toEqual({ jobId: 'p1', via: 're-master' });
    // The worker never sees it.
    const payload = JSON.parse(Buffer.from(lambdaSend.mock.calls[0][0].args.Payload).toString());
    expect(payload).not.toHaveProperty('derivedFrom');
  });

  it('records a stem remix with the mix it was made from', async () => {
    const REMIX = 'audio/mastering/stems/p1/remix.wav';
    parentGet.mockResolvedValue(PARENT);
    setGet.mockResolvedValue({ remix: { key: REMIX, mixUsed: { s1: { gainDb: -2, muted: false } } } });
    await invoke({ s3Key: REMIX, derivedFrom: { jobId: 'p1' } });
    expect(createMock.mock.calls[0][1].derivedFrom)
      .toEqual({ jobId: 'p1', via: 'stem-remix', mixUsed: { s1: { gainDb: -2, muted: false } } });
  });

  it('refuses a claim it cannot verify, and creates no job', async () => {
    parentGet.mockResolvedValue(PARENT);
    const res = await invoke({ s3Key: 'audio/mastering/other.wav', derivedFrom: { jobId: 'p1' } });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('parent-mismatch');
    parentGet.mockResolvedValue(null);
    const res2 = await invoke({ s3Key: 'audio/mastering/song.wav', derivedFrom: { jobId: 'p1' } });
    expect((await res2.json()).code).toBe('bad-parent');
    expect(createMock).not.toHaveBeenCalled();
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  it('two re-masters of one parent at once are two jobs with the same parent', async () => {
    parentGet.mockResolvedValue(PARENT);
    await Promise.all([
      invoke({ s3Key: 'audio/mastering/song.wav', derivedFrom: { jobId: 'p1' } }),
      invoke({ s3Key: 'audio/mastering/song.wav', derivedFrom: { jobId: 'p1' } }),
    ]);
    const [a, b] = createMock.mock.calls;
    expect(a[0]).not.toBe(b[0]);
    expect(a[1].derivedFrom).toEqual(b[1].derivedFrom);
  });
});
