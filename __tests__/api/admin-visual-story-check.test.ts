/** @jest-environment node */
/**
 * Storyboard check routes. The silent failures: a reservation never released
 * when the enqueue fails, two checks billed at once, lyrics written to the
 * row, an event too big for an async invoke, and an old check shown as if it
 * still described the storyboard.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const repo = {
  loadTree: jest.fn(),
  reserve: jest.fn(),
  settle: jest.fn(),
  createCheck: jest.fn(),
  listChecks: jest.fn(),
  getCheck: jest.fn(),
  transitionCheck: jest.fn(),
};
jest.mock('@/infrastructure/database/VisualStoryRepository', () => ({
  ...jest.requireActual('@/infrastructure/database/VisualStoryRepository'),
  VisualStoryRepository: jest.fn().mockImplementation(() => repo),
}));

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  InvokeCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import { GET as latestGET, POST as checkPOST } from '@/app/api/admin/visual-story/[vsId]/check/route';
import { GET as pollGET } from '@/app/api/admin/visual-story/[vsId]/check/[checkId]/route';
import * as auth from '@/lib/auth-helper';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { __resetVisualStoryRateLimitForTests } from '@/lib/visual-story-rate-limit';
import { buildCheckInput, buildCheckMessage } from '@/lib/visual-story-check';
import { storyboardHash } from '@/services/ai/storyboard-checker';
import { checkReserveUsd } from '@/services/video/cost';
import { CHECK_STALE_MS, STALE_CHECK_ERROR } from '@/services/video/check-job';

const requireAdmin = auth.requireAdmin as jest.Mock;
const VS = 'vs_1700000000000_abcdef12';
const CK = 'ck_1700000000000_abcdef12';
const LYRICS = 'Placeholder line one\nPlaceholder line two';
const bearer = { Authorization: 'Bearer t' };
const mk = (body?: unknown, withBearer = true) =>
  new NextRequest('https://tamilagaval.com/api/admin/visual-story/x/check', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: withBearer ? bearer : undefined,
  });
const getReq = () => new NextRequest('https://tamilagaval.com/api/admin/visual-story/x/check');
const ctx = (vsId = VS) => ({ params: Promise.resolve({ vsId }) });
const pctx = (checkId = CK) => ({ params: Promise.resolve({ vsId: VS, checkId }) });

const story = { vsId: VS, aspectRatio: '9:16', windowStartSec: 10, windowEndSec: 55, budgetUsdCap: 40, spentUsd: 1, style: 'warm film' };
const shot = (shotOrder: number, visualPrompt = `p${shotOrder}`) => ({
  sceneOrder: 1, shotOrder, mode: 'STILL', durationSec: 15, startSec: (shotOrder - 1) * 15, visualPrompt,
  negativePrompt: '', charIds: [], selectedCandidateId: null,
});
const tree = (shots = [shot(1), shot(2), shot(3)]) => ({
  story, scenes: [{ order: 1, heading: 'One', summary: 's' }], shots, characters: [], candidates: [], drafts: [], genJobs: [], renders: [],
});
const row = (over: Record<string, unknown> = {}) => ({
  checkId: CK, status: 'done', createdAt: new Date().toISOString(), updatedAt: 't', reservedUsd: 0.07,
  shotsHash: storyboardHash(buildCheckInput(tree())), withLyrics: false, summary: 'Ready.', issues: [], costUsd: 0.02, ...over,
});

beforeEach(() => {
  jest.resetAllMocks();
  (VisualStoryRepository as unknown as jest.Mock).mockImplementation(() => repo);
  (LambdaClient as unknown as jest.Mock).mockImplementation(() => ({ send: mockSend }));
  (InvokeCommand as unknown as jest.Mock).mockImplementation((input) => ({ input }));
  __resetVisualStoryRateLimitForTests();
  requireAdmin.mockResolvedValue({ userId: 'admin-1', email: 'a@x.com' });
  repo.loadTree.mockResolvedValue(tree());
  repo.reserve.mockResolvedValue(true);
  repo.listChecks.mockResolvedValue([]);
  repo.transitionCheck.mockImplementation(async (_v, checkId, _f, to, fields) => ({ ...row(), checkId, status: to, ...fields }));
  mockSend.mockResolvedValue({ StatusCode: 202 });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('POST check', () => {
  it('needs a bearer; nothing reserved', async () => {
    expect((await checkPOST(mk({}, false), ctx())).status).toBe(401);
    expect(repo.reserve).not.toHaveBeenCalled();
  });

  it('202: reserves the message-bounded price, writes a lyrics-free row, sends the whole storyboard', async () => {
    const res = await checkPOST(mk({ lyrics: LYRICS }), ctx());
    expect(res.status).toBe(202);
    const input = buildCheckInput(tree());
    const reserve = checkReserveUsd(buildCheckMessage(input, LYRICS).length);
    expect(repo.reserve).toHaveBeenCalledWith(VS, reserve);

    const [, saved] = repo.createCheck.mock.calls[0];
    expect(saved).toEqual({
      checkId: expect.stringMatching(/^ck_\d{13}_[a-z0-9]{8}$/), status: 'queued', createdAt: expect.any(String),
      updatedAt: expect.any(String), reservedUsd: reserve, shotsHash: storyboardHash(input), withLyrics: true,
    });
    expect(JSON.stringify(saved)).not.toContain('Placeholder');

    const cmd = (InvokeCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(cmd.InvocationType).toBe('Event');
    expect(JSON.parse(Buffer.from(cmd.Payload).toString())).toEqual({ kind: 'story-check', checkId: saved.checkId, vsId: VS, input, lyrics: LYRICS });
    expect((await res.json()).data.checkId).toBe(saved.checkId);
  });

  it('no lyrics: no lyrics key, withLyrics false', async () => {
    expect((await checkPOST(mk({ lyrics: '  ' }), ctx())).status).toBe(202);
    const cmd = (InvokeCommand as unknown as jest.Mock).mock.calls[0][0];
    expect('lyrics' in JSON.parse(Buffer.from(cmd.Payload).toString())).toBe(false);
    expect(repo.createCheck.mock.calls[0][1].withLyrics).toBe(false);
  });

  it('refuses an empty storyboard, a running check, an over-budget check — none reserve twice', async () => {
    repo.loadTree.mockResolvedValueOnce(tree([]));
    expect((await checkPOST(mk({}), ctx())).status).toBe(400);

    repo.listChecks.mockResolvedValueOnce([row({ status: 'running' })]);
    const busy = await checkPOST(mk({}), ctx());
    expect(busy.status).toBe(409);
    expect((await busy.json()).error).toBe('A check is already running. Wait for it to finish.');
    expect(repo.reserve).not.toHaveBeenCalled();

    repo.reserve.mockResolvedValueOnce(false);
    expect((await checkPOST(mk({}), ctx())).status).toBe(402);
    expect(repo.createCheck).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('a dead running check is swept and does not block a new one', async () => {
    const old = new Date(Date.now() - CHECK_STALE_MS - 1000).toISOString();
    repo.listChecks.mockResolvedValueOnce([row({ status: 'running', createdAt: old })]);
    expect((await checkPOST(mk({}), ctx())).status).toBe(202);
    expect(repo.transitionCheck).toHaveBeenCalledWith(VS, CK, ['queued', 'running'], 'failed', { code: 'timeout', error: STALE_CHECK_ERROR });
  });

  it('413 for a storyboard too big for one invoke, before reserving', async () => {
    const big = Array.from({ length: 120 }, (_, i) => shot(i + 1, 'x'.repeat(2000)));
    repo.loadTree.mockResolvedValueOnce(tree(big));
    expect((await checkPOST(mk({}), ctx())).status).toBe(413);
    expect(repo.reserve).not.toHaveBeenCalled();
  });

  it('a failed invoke fails the row and releases the reservation, unbilled', async () => {
    mockSend.mockRejectedValueOnce(new Error('lambda down'));
    expect((await checkPOST(mk({}), ctx())).status).toBe(502);
    const id = repo.createCheck.mock.calls[0][1].checkId;
    expect(repo.transitionCheck).toHaveBeenCalledWith(VS, id, ['queued'], 'failed', expect.objectContaining({ code: 'enqueue' }));
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: expect.any(Number), billedUsd: 0 });
  });

  it('a failed invoke the worker already claimed is left to the worker (one settle)', async () => {
    mockSend.mockRejectedValueOnce(new Error('timeout'));
    repo.transitionCheck.mockResolvedValueOnce(null);
    expect((await checkPOST(mk({}), ctx())).status).toBe(202);
    expect(repo.settle).not.toHaveBeenCalled();
  });

  it('a row that cannot be written releases the reservation', async () => {
    repo.createCheck.mockRejectedValueOnce(new Error('ddb'));
    expect((await checkPOST(mk({}), ctx())).status).toBe(500);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: expect.any(Number), billedUsd: 0 });
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('GET latest check', () => {
  it('returns the newest check, current while the storyboard is unchanged', async () => {
    repo.listChecks.mockResolvedValue([row({ checkId: 'ck_1600000000000_old00000', createdAt: '2026-01-01T00:00:00Z' }), row()]);
    const body = await (await latestGET(getReq(), ctx())).json();
    expect(body.data.check.checkId).toBe(CK);
    expect(body.data.outOfDate).toBe(false);
  });

  it('is out of date once a prompt changes', async () => {
    repo.listChecks.mockResolvedValue([row()]);
    repo.loadTree.mockResolvedValue(tree([shot(1, 'changed'), shot(2), shot(3)]));
    expect((await (await latestGET(getReq(), ctx())).json()).data.outOfDate).toBe(true);
  });

  it('null when the story has none; 404 for an unknown story', async () => {
    expect((await (await latestGET(getReq(), ctx())).json()).data).toEqual({ check: null, outOfDate: false });
    repo.loadTree.mockResolvedValueOnce(null);
    expect((await latestGET(getReq(), ctx())).status).toBe(404);
  });
});

describe('GET poll', () => {
  it("speaks pollJob's shape", async () => {
    repo.getCheck.mockResolvedValueOnce(row());
    expect(await (await pollGET(getReq(), pctx())).json()).toMatchObject({ status: 'done', result: { checkId: CK } });
    repo.getCheck.mockResolvedValueOnce(row({ status: 'failed', code: 'upstream', error: 'down' }));
    expect(await (await pollGET(getReq(), pctx())).json()).toMatchObject({ status: 'error', error: { code: 'upstream', message: 'down' } });
    repo.getCheck.mockResolvedValueOnce(row({ status: 'running' }));
    expect(await (await pollGET(getReq(), pctx())).json()).toMatchObject({ status: 'running', result: null });
  });

  it('404 for a bad or missing id', async () => {
    expect((await pollGET(getReq(), pctx('dj_1700000000000_abcdef12'))).status).toBe(404);
    repo.getCheck.mockResolvedValueOnce(null);
    expect((await pollGET(getReq(), pctx())).status).toBe(404);
  });
});
