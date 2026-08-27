/** @jest-environment node */
/**
 * GET /api/admin/mastering/references — LIST route for the reference picker.
 */

jest.mock('@/lib/auth-helper', () => ({
  requireAdmin: jest.fn().mockResolvedValue({ email: 'admin@test' }),
  authErrorResponse: jest.fn((err: unknown) => new Response(String(err), { status: 401 })),
}));

const listFilesMock = jest.fn();
jest.mock('@/infrastructure/storage/s3-client', () => ({
  S3Operations: { listFiles: (...args: unknown[]) => listFilesMock(...args) },
}));

import { GET } from '@/app/api/admin/mastering/references/route';

afterEach(() => {
  listFilesMock.mockReset();
});

async function invoke() {
  const req = new Request('http://localhost/api/admin/mastering/references', { method: 'GET' });
  const res = await GET(req as unknown as import('next/server').NextRequest);
  return { status: res.status, body: await res.json() };
}

it('returns an empty list when the references prefix has no objects', async () => {
  listFilesMock.mockResolvedValue([]);
  const { status, body } = await invoke();
  expect(status).toBe(200);
  expect(body.success).toBe(true);
  expect(body.references).toEqual([]);
  expect(body.count).toBe(0);
});

it('maps S3 objects to {id, key, sizeBytes, uploadedAt} sorted newest-first', async () => {
  listFilesMock.mockResolvedValue([
    { Key: 'audio/references/older.wav', Size: 100, LastModified: new Date('2026-08-01T00:00:00Z') },
    { Key: 'audio/references/newer.wav', Size: 200, LastModified: new Date('2026-08-27T00:00:00Z') },
  ]);
  const { body } = await invoke();
  expect(body.references).toHaveLength(2);
  // Newer first.
  expect(body.references[0].id).toBe('newer');
  expect(body.references[0].key).toBe('audio/references/newer.wav');
  expect(body.references[0].sizeBytes).toBe(200);
  expect(body.references[0].uploadedAt).toBe('2026-08-27T00:00:00.000Z');
  expect(body.references[1].id).toBe('older');
});

it('filters out non-.wav files silently', async () => {
  listFilesMock.mockResolvedValue([
    { Key: 'audio/references/ref.wav', Size: 100, LastModified: new Date('2026-08-27T00:00:00Z') },
    { Key: 'audio/references/metadata.json', Size: 50, LastModified: new Date('2026-08-27T00:00:00Z') },
    { Key: 'audio/references/notes.txt', Size: 10, LastModified: new Date('2026-08-27T00:00:00Z') },
  ]);
  const { body } = await invoke();
  expect(body.references).toHaveLength(1);
  expect(body.references[0].id).toBe('ref');
});

it('filters out any key that somehow does not live under the references prefix', async () => {
  // Defence: shouldn't happen because we passed the prefix to listFiles, but
  // if a bug or an S3 quirk returned an out-of-prefix key, the double-check
  // rejects it rather than exposing it.
  listFilesMock.mockResolvedValue([
    { Key: 'audio/mastering/ref.wav', Size: 100, LastModified: new Date('2026-08-27T00:00:00Z') },
    { Key: 'audio/references/legit.wav', Size: 100, LastModified: new Date('2026-08-27T00:00:00Z') },
  ]);
  const { body } = await invoke();
  expect(body.references).toHaveLength(1);
  expect(body.references[0].id).toBe('legit');
});

it('returns 502 when the S3 list fails', async () => {
  listFilesMock.mockRejectedValue(new Error('S3 kaboom'));
  const { status, body } = await invoke();
  expect(status).toBe(502);
  expect(body.success).toBe(false);
});

it('handles a missing LastModified gracefully (uploadedAt=null)', async () => {
  listFilesMock.mockResolvedValue([
    { Key: 'audio/references/no-date.wav', Size: 100 /* no LastModified */ },
  ]);
  const { body } = await invoke();
  expect(body.references[0].uploadedAt).toBe(null);
});
