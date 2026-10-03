/** @jest-environment node */
// __tests__/api/admin-mastering-upload-stem.test.ts
jest.mock('@/lib/auth-helper', () => ({
  requireAdmin: jest.fn().mockResolvedValue({}), requireBearer: jest.fn(),
  authErrorResponse: jest.fn(() => new Response('no', { status: 401 })),
}));
const presign = jest.fn().mockResolvedValue({ url: 'https://s3/u', fields: { key: 'k' } });
jest.mock('@/infrastructure/storage/s3-client', () => ({ S3Operations: { getSignedUploadPost: (...a: unknown[]) => presign(...a) } }));

import { POST } from '@/app/api/admin/mastering/upload/route';
import { MAX_UPLOAD_BYTES } from '@/lib/mastering-storage';

const JOB = '0b5e2c1a-1111-4222-8333-444455556666';
const post = (body: unknown) =>
  POST(new Request('http://x/api/admin/mastering/upload', { method: 'POST', body: JSON.stringify(body) }) as never);

beforeEach(() => presign.mockClear());

it('puts a stem in its master\'s own folder, WAV only, with the WAV cap', async () => {
  const res = await post({ filename: '2_Drums.wav', contentType: 'audio/wav', size: 1000, kind: 'stem', masterJobId: JOB });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.key).toMatch(new RegExp(`^audio/mastering/stems/${JOB}/\\d+_[0-9a-f]{8}_2_Drums\\.wav$`));
  expect(presign).toHaveBeenCalledWith(body.key, 'audio/wav', MAX_UPLOAD_BYTES, expect.any(Number));
});

it('refuses a stem with no master, or a path-like one', async () => {
  for (const masterJobId of [undefined, '../x', 'a/b']) {
    const res = await post({ filename: 'x.wav', contentType: 'audio/wav', kind: 'stem', masterJobId });
    expect(res.status).toBe(400);
  }
  expect(presign).not.toHaveBeenCalled();
});

it('refuses a stem that is not a WAV', async () => {
  const res = await post({ filename: 'x.mp3', contentType: 'audio/mpeg', kind: 'stem', masterJobId: JOB });
  expect(res.status).toBe(400);
});

it('leaves ordinary audio uploads exactly as they were', async () => {
  const res = await post({ filename: 'take.wav', contentType: 'audio/wav' });
  const body = await res.json();
  expect(body.key).toMatch(/^audio\/mastering\/\d+_[0-9a-f]{8}_take\.wav$/);
});
