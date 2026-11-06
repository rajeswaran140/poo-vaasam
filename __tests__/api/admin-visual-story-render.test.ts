/** @jest-environment node */
/**
 * Phase 6 render routes. What matters: every refusal is decided before
 * anything is queued, in words that say what to change; the worker receives
 * exactly the checked shot list; a failed invoke leaves no render stuck
 * "queued"; a dead render is failed (conditionally) when polled; a story is
 * not deleted while its video renders.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const repo = {
  loadTree: jest.fn(),
  createRender: jest.fn(),
  getRender: jest.fn(),
  transitionRender: jest.fn(),
  listDraftJobs: jest.fn().mockResolvedValue([]),
  transitionDraftJob: jest.fn(),
  settle: jest.fn(),
  remove: jest.fn(),
};
jest.mock('@/infrastructure/database/VisualStoryRepository', () => ({
  ...jest.requireActual('@/infrastructure/database/VisualStoryRepository'),
  VisualStoryRepository: jest.fn().mockImplementation(() => repo),
}));

const lambdaSend = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn().mockImplementation(() => ({ send: lambdaSend })),
  InvokeCommand: jest.fn((args: unknown) => ({ args })),
}));
jest.mock('@/lib/aws-config', () => ({
  ...jest.requireActual('@/lib/aws-config'),
  awsConfig: { region: 'ca-central-1', credentials: undefined },
}));

import { POST } from '@/app/api/admin/visual-story/[vsId]/render/route';
import { GET } from '@/app/api/admin/visual-story/[vsId]/render/[renderId]/route';
import { DELETE } from '@/app/api/admin/visual-story/[vsId]/route';
import * as auth from '@/lib/auth-helper';
import { __resetVisualStoryRateLimitForTests } from '@/lib/visual-story-rate-limit';
import { RENDER_QUEUED_STALE_MS, RENDER_RUNNING_STALE_MS, STALE_RENDER_ERROR } from '@/lib/visual-story-render';

const requireAdmin = auth.requireAdmin as jest.Mock;
const VS = 'vs_1700000000000_abcdef12';
const RD = 'rd_1700000000000_abcdef12';
const AUDIO = 'audio/mastering/1_a_song-master-14LUFS.wav';
const C = `audio/mastering/visual-story/${VS}/candidates`;

const mk = (method = 'POST') =>
  new NextRequest('https://tamilagaval.com/api/admin/visual-story/x', { method, headers: { Authorization: 'Bearer t' } });
const ctx = () => ({ params: Promise.resolve({ vsId: VS }) });
const rctx = (renderId = RD) => ({ params: Promise.resolve({ vsId: VS, renderId }) });

const shot = (sceneOrder: number, shotOrder: number, durationSec: number, selectedCandidateId: string | null) => ({
  sceneOrder, shotOrder, mode: 'HERO', durationSec, startSec: 0, visualPrompt: 'p', negativePrompt: '', charIds: [], selectedCandidateId,
});
const cand = (candId: string, ext: string) => ({
  candId, sceneOrder: 1, shotOrder: 1, jobId: null, providerId: 'grok', providerTaskId: null, mode: 'HERO',
  s3Key: `${C}/${candId}${ext}`, costUsd: 0, createdAt: '2026-11-06T00:00:00.000Z',
});
const tree = (over: Record<string, unknown> = {}) => ({
  story: { vsId: VS, audioKey: AUDIO, aspectRatio: '9:16', windowStartSec: 20, windowEndSec: 32 },
  shots: [shot(1, 1, 6, 'cd_1700000000000_aaaaaa'), shot(1, 2, 6, 'cd_1700000000000_bbbbbb')],
  candidates: [cand('cd_1700000000000_aaaaaa', '.mp4'), cand('cd_1700000000000_bbbbbb', '.jpg')],
  renders: [],
  genJobs: [],
  ...over,
});
const render = (over: Record<string, unknown> = {}) => ({
  renderId: RD, status: 'queued', aspectRatio: '9:16', windowStartSec: 20, windowEndSec: 32, shots: [], estimateSec: 30,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...over,
});
const sentEvent = () => JSON.parse((lambdaSend.mock.calls[0][0] as { args: { Payload: Buffer } }).args.Payload.toString());

beforeEach(() => {
  jest.clearAllMocks();
  __resetVisualStoryRateLimitForTests();
  requireAdmin.mockResolvedValue({ isAuthenticated: true, userId: 'admin-1' });
  repo.listDraftJobs.mockResolvedValue([]);
  repo.transitionRender.mockImplementation(async (_v, renderId, _f, to, fields) => ({ ...render({ renderId }), status: to, ...fields }));
});

describe('POST render', () => {
  it('queues the checked shot list and hands exactly that to the worker', async () => {
    repo.loadTree.mockResolvedValue(tree());
    const res = await POST(mk(), ctx());
    expect(res.status).toBe(202);
    const { data } = await res.json();
    expect(data.renderId).toMatch(/^rd_/);
    expect(repo.createRender.mock.calls[0][1]).toMatchObject({ status: 'queued', windowStartSec: 20, windowEndSec: 32 });
    expect(sentEvent()).toEqual({
      assemble: {
        vsId: VS, renderId: data.renderId, audioKey: AUDIO, aspectRatio: '9:16', windowStartSec: 20, windowEndSec: 32,
        shots: [
          { sceneOrder: 1, shotOrder: 1, key: `${C}/cd_1700000000000_aaaaaa.mp4`, durationSec: 6 },
          { sceneOrder: 1, shotOrder: 2, key: `${C}/cd_1700000000000_bbbbbb.jpg`, durationSec: 6 },
        ],
        createdAt: repo.createRender.mock.calls[0][1].createdAt,
      },
    });
  });

  it.each([
    ['a shot with nothing chosen', { shots: [shot(1, 1, 6, 'cd_1700000000000_aaaaaa'), shot(2, 3, 6, null)] }, 'Scene 2, shot 3 has no picture or clip chosen yet.'],
    ['shots that fall short of the window', { shots: [shot(1, 1, 6, 'cd_1700000000000_aaaaaa')] }, 'The shots add up to 0:06, but the story covers 0:12 of the song. Lengthen or add shots.'],
    ['no shots at all', { shots: [] }, 'Add shots before rendering.'],
    ['a render already running', { renders: [render({ status: 'running' })] }, 'A render is already running for this story.'],
  ])('refuses %s before queueing anything', async (_l, over, message) => {
    repo.loadTree.mockResolvedValue(tree(over));
    const res = await POST(mk(), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(message);
    expect(repo.createRender).not.toHaveBeenCalled();
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  it('refuses a render too long for the worker, saying what to change', async () => {
    const n = 300;
    const shots = Array.from({ length: n }, (_, i) => shot(1, i + 1, 1, `cd_1700000000000_s${String(i).padStart(5, '0')}`));
    const candidates = shots.map((s) => cand(s.selectedCandidateId!, '.png'));
    repo.loadTree.mockResolvedValue(tree({ shots, candidates, story: { ...tree().story, windowStartSec: 0, windowEndSec: n } }));
    const res = await POST(mk(), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('longer than the worker allows');
  });

  it('clears a dead render first, so it does not block a new one', async () => {
    const old = new Date(Date.now() - RENDER_RUNNING_STALE_MS - 1000).toISOString();
    repo.loadTree.mockResolvedValue(tree({ renders: [render({ status: 'running', createdAt: old, updatedAt: old })] }));
    expect((await POST(mk(), ctx())).status).toBe(202);
    expect(repo.transitionRender).toHaveBeenCalledWith(VS, RD, ['running'], 'failed', { error: STALE_RENDER_ERROR });
  });

  it('times a running render from when the worker claimed it, not from when it was queued', async () => {
    // Queued 20 minutes ago (waited in Lambda's queue), claimed 5 minutes ago: still running.
    const queued = new Date(Date.now() - 20 * 60_000).toISOString();
    const claimed = new Date(Date.now() - 5 * 60_000).toISOString();
    repo.loadTree.mockResolvedValue(tree({ renders: [render({ status: 'running', createdAt: queued, updatedAt: claimed })] }));
    const res = await POST(mk(), ctx());
    expect(res.status).toBe(409);
    expect(repo.transitionRender).not.toHaveBeenCalled();
  });

  it('fails the render it just queued when the worker cannot be invoked', async () => {
    repo.loadTree.mockResolvedValue(tree());
    lambdaSend.mockRejectedValueOnce(new Error('throttled'));
    const res = await POST(mk(), ctx());
    expect(res.status).toBe(502);
    const created = repo.createRender.mock.calls[0][1];
    expect(repo.transitionRender).toHaveBeenCalledWith(VS, created.renderId, ['queued'], 'failed', expect.objectContaining({ error: expect.any(String) }));
  });

  it('needs a bearer token (CSRF)', async () => {
    const res = await POST(new NextRequest('https://tamilagaval.com/x', { method: 'POST' }), ctx());
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(repo.createRender).not.toHaveBeenCalled();
  });
});

describe('GET render', () => {
  it('returns the render', async () => {
    repo.getRender.mockResolvedValue(render({ status: 'done', s3Key: 'k.mp4' }));
    const res = await GET(mk('GET'), rctx());
    expect((await res.json()).data.render).toMatchObject({ status: 'done', s3Key: 'k.mp4' });
    expect(repo.transitionRender).not.toHaveBeenCalled();
  });

  it('fails a render the worker can no longer be running', async () => {
    repo.getRender.mockResolvedValue(render({ status: 'queued', createdAt: new Date(Date.now() - RENDER_QUEUED_STALE_MS - 1).toISOString() }));
    const res = await GET(mk('GET'), rctx());
    expect((await res.json()).data.render).toMatchObject({ status: 'failed', error: STALE_RENDER_ERROR });
  });

  it('404s an unknown or malformed id', async () => {
    repo.getRender.mockResolvedValue(null);
    expect((await GET(mk('GET'), rctx())).status).toBe(404);
    expect((await GET(mk('GET'), rctx('nope'))).status).toBe(404);
  });
});

describe('DELETE story while the video renders', () => {
  it('is refused', async () => {
    repo.loadTree.mockResolvedValue(tree({ renders: [render({ status: 'running' })] }));
    const res = await DELETE(mk('DELETE'), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('Wait for the video render to finish first.');
    expect(repo.remove).not.toHaveBeenCalled();
  });

  it('goes ahead once the render is done', async () => {
    repo.loadTree.mockResolvedValue(tree({ renders: [render({ status: 'done' })] }));
    expect((await DELETE(mk('DELETE'), ctx())).status).toBe(200);
    expect(repo.remove).toHaveBeenCalled();
  });
});
