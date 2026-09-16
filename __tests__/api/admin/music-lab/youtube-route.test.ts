/** @jest-environment node */
import { POST } from '@/app/api/admin/music-lab/master/[jobId]/youtube/route';

jest.mock('@/lib/auth-helper', () => ({
  requireAdmin: jest.fn().mockResolvedValue(undefined),
  requireBearer: jest.fn(),
  authErrorResponse: jest.fn(() => new Response('unauthorised', { status: 401 })),
}));
const send = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn(() => ({ send })),
  InvokeCommand: jest.fn((i) => i),
}));
const consumeQuota = jest.fn().mockResolvedValue({ blocked: false, used: 1800, limit: 10000, day: '2026-09-16' });
jest.mock('@/lib/youtube-quota', () => {
  const actual = jest.requireActual('@/lib/youtube-quota');
  return { ...actual, consumeQuota: (...a: unknown[]) => consumeQuota(...a) };
});
const get = jest.fn();
const markUploadQueued = jest.fn().mockResolvedValue(undefined);
jest.mock('@/infrastructure/database/MasterJobRepository', () => ({
  MasterJobRepository: jest.fn(() => ({ get, markUploadQueued })),
}));

const body = {
  title: 'காதல் வந்து அரும்பியதே',
  description: 'body',
  tags: ['Tamil love song'],
  playlistIds: ['PLLsCQ9NH4rLSZU0Ycy6I-Xr8DMAbe4vjs'],
};
const req = () => new Request('http://x/youtube', { method: 'POST', body: JSON.stringify(body) }) as never;
const ctx = { params: Promise.resolve({ jobId: 'j1' }) };

const okJob = {
  id: 'j1', status: 'done', savedAt: '2026-09-15T00:00:00Z',
  masterKey: 'audio/mastering/a-master-14LUFS.wav',
  videoKey: 'audio/mastering/a-master-14LUFS-1440p.mp4',
  coverKey: 'audio/mastering/a-cover.png',
  youtubeVideoId: null, uploadStatus: null, uploadSessionUri: null,
};

beforeEach(() => {
  send.mockClear(); markUploadQueued.mockClear(); consumeQuota.mockClear();
  consumeQuota.mockResolvedValue({ blocked: false, used: 1800, limit: 10000, day: '2026-09-16' });
});

it('enqueues and returns 202 without doing the work', async () => {
  get.mockResolvedValue(okJob);
  const res = await POST(req(), ctx);
  expect(res.status).toBe(202);
  expect(send).toHaveBeenCalledTimes(1);
});

it('marks the job queued so the UI can show it immediately', async () => {
  get.mockResolvedValue(okJob);
  await POST(req(), ctx);
  expect(markUploadQueued).toHaveBeenCalledWith('j1');
});

it('REFUSES a job already on YouTube, and does not invoke the worker', async () => {
  get.mockResolvedValue({ ...okJob, youtubeVideoId: 'abc' });
  const res = await POST(req(), ctx);
  expect(res.status).toBe(409);
  expect(send).not.toHaveBeenCalled();
});

it('404s an unknown job', async () => {
  get.mockResolvedValue(null);
  expect((await POST(req(), ctx)).status).toBe(404);
});

// Code review Finding 3 (round 1): the four tests above would all still pass
// if the route invoked the worker BEFORE marking the job queued — the exact
// reversal that turns a double-click into two uploads. Pin the order itself.
it('marks the job queued BEFORE invoking the worker, not after', async () => {
  get.mockResolvedValue(okJob);
  await POST(req(), ctx);
  expect(markUploadQueued).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(1);
  expect(markUploadQueued.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
});


describe('quota accounting — an upload is 1600+ units and was charged nothing until 2026-09-16', () => {
  it('charges insert + thumbnail + one per playlist', async () => {
    get.mockResolvedValue(okJob);            // has a cover, one playlist in `body`
    await POST(req(), ctx);
    expect(consumeQuota).toHaveBeenCalledWith(1600 + 50 + 50, { surface: 'data' });
  });

  it('omits the thumbnail charge when the job has no cover', async () => {
    get.mockResolvedValue({ ...okJob, coverKey: null });
    await POST(req(), ctx);
    expect(consumeQuota).toHaveBeenCalledWith(1600 + 50, { surface: 'data' });
  });

  it('CHARGES BEFORE INVOKING — units reaching Google are spent whether or not the worker succeeds', async () => {
    get.mockResolvedValue(okJob);
    await POST(req(), ctx);
    expect(consumeQuota.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
  });

  it('returns 429 and does NOT invoke the worker when the guard trips', async () => {
    get.mockResolvedValue(okJob);
    consumeQuota.mockResolvedValue({ blocked: true, used: 9900, limit: 10000, day: '2026-09-16' });
    const res = await POST(req(), ctx);
    expect(res.status).toBe(429);
    expect(send).not.toHaveBeenCalled();
    expect(markUploadQueued).not.toHaveBeenCalled();
  });

  it('the 429 says what an upload costs, so the operator can reason about the wait', async () => {
    get.mockResolvedValue(okJob);
    consumeQuota.mockResolvedValue({ blocked: true, used: 9900, limit: 10000, day: '2026-09-16' });
    const body = await (await POST(req(), ctx)).json();
    expect(body.error).toMatch(/1700/);        // this job: insert + thumbnail + 1 playlist
    expect(body.error).toMatch(/9900\/10000/);
    expect(body.error).toMatch(/Pacific/);
  });

  it('a refused upload is never charged — the planner runs first', async () => {
    get.mockResolvedValue({ ...okJob, youtubeVideoId: 'already-there' });
    const res = await POST(req(), ctx);
    expect(res.status).toBe(409);
    expect(consumeQuota).not.toHaveBeenCalled();
  });
});
