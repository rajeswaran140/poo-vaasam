/** @jest-environment node */
/**
 * /api/admin/music-lab/studio-phase0/results — the listening test's ratings,
 * stored as one JSON object at a fixed key. The client never names the key.
 */
const requireAdmin = jest.fn().mockResolvedValue({});
const requireBearer = jest.fn();
jest.mock('@/lib/auth-helper', () => ({
  requireAdmin: (...a: unknown[]) => requireAdmin(...a),
  requireBearer: (...a: unknown[]) => requireBearer(...a),
  authErrorResponse: jest.fn(() => new Response('no', { status: 401 })),
}));
const getFile = jest.fn();
const uploadFile = jest.fn().mockResolvedValue({});
jest.mock('@/infrastructure/storage/s3-client', () => ({
  S3Operations: { getFile: (...a: unknown[]) => getFile(...a), uploadFile: (...a: unknown[]) => uploadFile(...a) },
}));

import { GET, PUT } from '@/app/api/admin/music-lab/studio-phase0/results/route';
import { RESULTS_KEY, newSession, addRating, buildTrials, PHASE0_PREFIX, type Results } from '@/lib/studio-phase0/model';

const URL_ = 'http://x/api/admin/music-lab/studio-phase0/results';
const trials = buildTrials({
  version: 1,
  lines: [{ lineId: 'F1', instrument: 'flute', stemKey: `${PHASE0_PREFIX}a.wav`, notesKey: `${PHASE0_PREFIX}a.json`, durationSec: 5, spanStartSec: 0 }],
  packs: [{ packId: 'vsco2-flute', instrument: 'flute', packKey: 'audio/mastering/studio-samples/vsco2-flute/pack.json' }],
});
const NOW = new Date('2026-10-26T10:00:00Z');
const session = newSession(trials, '0123456789abcdef');
const rated = addRating(session, 'F1-vsco2-flute', { renderScore: 3, sunoScore: 4, guess: 'A', note: '' }, NOW);

const stored = (r: Results | null) =>
  r === null
    ? getFile.mockRejectedValueOnce(Object.assign(new Error('nope'), { name: 'NoSuchKey' }))
    : getFile.mockResolvedValueOnce({ transformToString: () => Promise.resolve(JSON.stringify(r)) });
const put = (body: string) => PUT(new Request(URL_, { method: 'PUT', body }) as never);

beforeEach(() => {
  jest.clearAllMocks();
  requireAdmin.mockResolvedValue({});
});

it('GET is admin-only', async () => {
  requireAdmin.mockRejectedValueOnce(new Error('unauthorised'));
  expect((await GET(new Request(URL_) as never)).status).toBe(401);
});

it('PUT needs a bearer token', async () => {
  requireBearer.mockImplementationOnce(() => { throw new Error('cookie only'); });
  expect((await put(JSON.stringify(session))).status).toBe(401);
  expect(uploadFile).not.toHaveBeenCalled();
});

it('GET returns null when results.json does not exist yet', async () => {
  stored(null);
  const res = await GET(new Request(URL_) as never);
  expect(await res.json()).toEqual({ success: true, results: null });
  expect(getFile).toHaveBeenCalledWith(RESULTS_KEY);
});

it('GET returns the parsed results', async () => {
  stored(rated);
  expect(await (await GET(new Request(URL_) as never)).json()).toEqual({ success: true, results: rated });
});

it('PUT writes exactly RESULTS_KEY as application/json, ignoring any key in the body', async () => {
  stored(null);
  const res = await put(JSON.stringify({ ...rated, key: 'audio/songs/evil.json' }));
  expect(res.status).toBe(200);
  expect(uploadFile).toHaveBeenCalledTimes(1);
  const arg = uploadFile.mock.calls[0][0];
  expect(arg).toMatchObject({ key: RESULTS_KEY, contentType: 'application/json' });
  expect(JSON.parse(arg.file)).toEqual(rated);
});

it('PUT rejects an invalid body with 400', async () => {
  const bad = JSON.parse(JSON.stringify(rated));
  bad.trials['F1-vsco2-flute'].ratings[0].renderScore = 6;
  expect((await put(JSON.stringify(bad))).status).toBe(400);
  expect((await put('{not json')).status).toBe(400);
  expect(uploadFile).not.toHaveBeenCalled();
});

it('PUT rejects a body over 256 KB with 413', async () => {
  expect((await put(JSON.stringify({ ...rated, pad: 'x'.repeat(256 * 1024) }))).status).toBe(413);
  expect(uploadFile).not.toHaveBeenCalled();
});

it('PUT refuses to drop a rating a newer tab already saved (409)', async () => {
  stored(rated);
  const res = await put(JSON.stringify(session));
  expect(res.status).toBe(409);
  expect(uploadFile).not.toHaveBeenCalled();
});

it('PUT refuses to replace a stored session with a different seed (409)', async () => {
  stored(session);
  const other = newSession(trials, 'fedcba9876543210');
  expect((await put(JSON.stringify(other))).status).toBe(409);
  expect(uploadFile).not.toHaveBeenCalled();
});
