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

beforeEach(() => { send.mockClear(); markUploadQueued.mockClear(); });

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
