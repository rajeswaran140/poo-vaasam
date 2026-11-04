/** @jest-environment node */
/** Storyboard draft (paid, under the cap) and apply. */

import { NextRequest } from 'next/server';
import { createHash } from 'crypto';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const repo = {
  loadTree: jest.fn(),
  reserve: jest.fn(),
  settle: jest.fn(),
  putDraft: jest.fn(),
  applyDraft: jest.fn(),
  patch: jest.fn(),
};
jest.mock('@/infrastructure/database/VisualStoryRepository', () => ({
  ...jest.requireActual('@/infrastructure/database/VisualStoryRepository'),
  VisualStoryRepository: jest.fn().mockImplementation(() => repo),
}));

const mockGenerate = jest.fn();
jest.mock('@/services/ai/storyboarder', () => ({
  ...jest.requireActual('@/services/ai/storyboarder'),
  generateStoryboard: (...a: unknown[]) => mockGenerate(...a),
}));

import { POST as draftPOST } from '@/app/api/admin/visual-story/[vsId]/draft/route';
import { POST as applyPOST } from '@/app/api/admin/visual-story/[vsId]/draft/[draftId]/apply/route';
import * as auth from '@/lib/auth-helper';
import {
  VisualStoryRepository,
  DraftTooLargeError,
  NotFoundError,
} from '@/infrastructure/database/VisualStoryRepository';
import { __resetVisualStoryRateLimitForTests } from '@/lib/visual-story-rate-limit';
import { DRAFT_ESTIMATE_USD, draftCostUsd } from '@/services/video/cost';

const requireAdmin = auth.requireAdmin as jest.Mock;
const VS = 'vs_1700000000000_abcdef12';
const DR = 'dr_1700000000000_abcdef12';
const bearer = { Authorization: 'Bearer t' };
const LYRICS = 'Line one of the test song\nLine two';

const mk = (body?: unknown, withBearer = true) =>
  new NextRequest('https://tamilagaval.com/api/admin/visual-story/x', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: withBearer ? bearer : undefined,
  });
const ctx = (vsId = VS) => ({ params: Promise.resolve({ vsId }) });
const actx = (draftId = DR, vsId = VS) => ({ params: Promise.resolve({ vsId, draftId }) });

const story = {
  vsId: VS,
  aspectRatio: '9:16',
  windowStartSec: 10,
  windowEndSec: 55,
  budgetUsdCap: 40,
  spentUsd: 39.95,
  reservedUsd: 0,
  committedUsd: 39.95,
  status: 'DRAFT',
};
const data = {
  characters: [{ name: 'Test girl', description: 'a girl' }],
  scenes: [{ heading: 'Scene 1', summary: 's', shots: [{ durationSec: 5, mode: 'STILL', visualPrompt: 'p', characterNames: [] }] }],
};
const okResult = { ok: true, data, usage: { inputTokens: 2000, outputTokens: 3000 } };
const cost = draftCostUsd(2000, 3000);

beforeEach(() => {
  jest.resetAllMocks();
  (VisualStoryRepository as unknown as jest.Mock).mockImplementation(() => repo);
  __resetVisualStoryRateLimitForTests();
  requireAdmin.mockResolvedValue({ userId: 'admin-1', email: 'a@x.com' });
  repo.loadTree.mockResolvedValue({ story, scenes: [], shots: [], characters: [], candidates: [], drafts: [] });
  repo.reserve.mockResolvedValue(true);
  repo.settle.mockResolvedValue(undefined);
  repo.putDraft.mockResolvedValue(undefined);
  repo.applyDraft.mockResolvedValue(undefined);
  repo.patch.mockResolvedValue(undefined);
  mockGenerate.mockResolvedValue(okResult);
});

describe('POST draft', () => {
  it('no bearer is 401; nothing reserved or called', async () => {
    expect((await draftPOST(mk({ lyrics: LYRICS }, false), ctx())).status).toBe(401);
    expect(repo.reserve).not.toHaveBeenCalled();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('empty lyrics ⇒ 400, 8001 chars ⇒ 400, before any reserve', async () => {
    expect((await draftPOST(mk({ lyrics: '   ' }), ctx())).status).toBe(400);
    expect((await draftPOST(mk({ lyrics: 'x'.repeat(8001) }), ctx())).status).toBe(400);
    expect((await draftPOST(mk(), ctx())).status).toBe(400);
    expect(repo.reserve).not.toHaveBeenCalled();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('malformed vsId and unknown story are 404', async () => {
    expect((await draftPOST(mk({ lyrics: LYRICS }), ctx('../x'))).status).toBe(404);
    repo.loadTree.mockResolvedValueOnce(null);
    expect((await draftPOST(mk({ lyrics: LYRICS }), ctx())).status).toBe(404);
    expect(repo.reserve).not.toHaveBeenCalled();
  });

  it('happy path: window length, stores hash NOT lyrics, settles actual token cost', async () => {
    const res = await draftPOST(mk({ lyrics: LYRICS }), ctx());
    expect(res.status).toBe(201);
    expect(repo.reserve).toHaveBeenCalledWith(VS, DRAFT_ESTIMATE_USD);

    const arg = mockGenerate.mock.calls[0][0];
    expect(arg).toMatchObject({ lyrics: LYRICS, windowSec: 45, aspectRatio: '9:16' });
    expect(arg.signal).toBeUndefined();

    const [vsArg, item] = repo.putDraft.mock.calls[0];
    expect(vsArg).toBe(VS);
    expect(item.lyricsHash).toBe(createHash('sha256').update(LYRICS).digest('hex'));
    expect(item).not.toHaveProperty('lyrics');
    expect(JSON.stringify(item)).not.toContain('Line one');
    expect(item).toMatchObject({
      inputTokens: 2000,
      outputTokens: 3000,
      costUsd: cost,
      characters: data.characters,
      scenes: data.scenes,
    });
    expect(item.draftId).toMatch(/^dr_\d{13}_[a-z0-9]{8}$/);
    expect(typeof item.model).toBe('string');

    expect(repo.settle).toHaveBeenCalledTimes(1);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: DRAFT_ESTIMATE_USD, billedUsd: cost });
    const body = await res.json();
    expect(body.data.draft.draftId).toBe(item.draftId);
    expect(JSON.stringify(body)).not.toContain('Line one');
  });

  it('reserve false ⇒ 402, provider not called, nothing settled', async () => {
    repo.reserve.mockResolvedValueOnce(false);
    const res = await draftPOST(mk({ lyrics: LYRICS }), ctx());
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("This would go over the story's budget ($39.95 of $40.00).");
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(repo.settle).not.toHaveBeenCalled();
  });

  it('billing ⇒ 503 with the out-of-credit message, released', async () => {
    const msg = 'The Anthropic account is out of credit. Add credits in the Anthropic Console (Plans & Billing), then generate again.';
    mockGenerate.mockResolvedValueOnce({ ok: false, code: 'billing', error: msg });
    const res = await draftPOST(mk({ lyrics: LYRICS }), ctx());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe(msg);
    expect(repo.settle).toHaveBeenCalledTimes(1);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: DRAFT_ESTIMATE_USD, billedUsd: 0 });
    expect(repo.putDraft).not.toHaveBeenCalled();
  });

  it.each([
    ['not_configured', 503],
    ['rate_limit', 429],
    ['auth', 502],
    ['upstream', 502],
    ['bad_response', 502],
  ])('%s ⇒ %i, released', async (code, status) => {
    mockGenerate.mockResolvedValueOnce({ ok: false, code, error: 'x' });
    expect((await draftPOST(mk({ lyrics: LYRICS }), ctx())).status).toBe(status);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: DRAFT_ESTIMATE_USD, billedUsd: 0 });
    expect(repo.settle).toHaveBeenCalledTimes(1);
  });

  it('bad_response WITH usage settles at its token cost and still returns 502', async () => {
    mockGenerate.mockResolvedValueOnce({
      ok: false, code: 'bad_response', error: 'x', usage: { inputTokens: 2000, outputTokens: 3000 },
    });
    const res = await draftPOST(mk({ lyrics: LYRICS }), ctx());
    expect(res.status).toBe(502);
    expect(repo.settle).toHaveBeenCalledTimes(1);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: DRAFT_ESTIMATE_USD, billedUsd: cost });
    expect(repo.putDraft).not.toHaveBeenCalled();
  });

  it('generateStoryboard THROWS ⇒ 502, unbilled, settled once', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGenerate.mockRejectedValueOnce(new Error('boom'));
    const res = await draftPOST(mk({ lyrics: LYRICS }), ctx());
    expect(res.status).toBe(502);
    expect(repo.settle).toHaveBeenCalledTimes(1);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: DRAFT_ESTIMATE_USD, billedUsd: 0 });
    spy.mockRestore();
  });

  it('putDraft fails after a billed call ⇒ 500, still settled as billed', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    repo.putDraft.mockRejectedValueOnce(new Error('ddb'));
    const res = await draftPOST(mk({ lyrics: LYRICS }), ctx());
    expect(res.status).toBe(500);
    expect(repo.settle).toHaveBeenCalledTimes(1);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: DRAFT_ESTIMATE_USD, billedUsd: cost });
    spy.mockRestore();
  });

  it('settle throwing keeps the original response and logs no lyrics', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    repo.settle.mockRejectedValue(new Error('ddb down'));
    expect((await draftPOST(mk({ lyrics: LYRICS }), ctx())).status).toBe(201);
    expect(JSON.stringify(spy.mock.calls)).not.toContain('Line one');
    spy.mockRestore();
  });

  it('the client abort signal is not forwarded', async () => {
    const req = mk({ lyrics: LYRICS });
    await draftPOST(req, ctx());
    expect(mockGenerate.mock.calls[0][0].signal).not.toBe(req.signal);
  });

  it('reserve throws ⇒ 5xx, provider never called', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    repo.reserve.mockRejectedValueOnce(new Error('gone'));
    expect((await draftPOST(mk({ lyrics: LYRICS }), ctx())).status).toBe(500);
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(repo.settle).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('POST apply', () => {
  it('no bearer is 401', async () => {
    expect((await applyPOST(mk(undefined, false), actx())).status).toBe(401);
    expect(repo.applyDraft).not.toHaveBeenCalled();
  });

  it('malformed ids are 404', async () => {
    expect((await applyPOST(mk(), actx('../x'))).status).toBe(404);
    expect((await applyPOST(mk(), actx(DR, '../x'))).status).toBe(404);
    expect(repo.applyDraft).not.toHaveBeenCalled();
  });

  it('applies, sets STORYBOARDING, returns the tree', async () => {
    const tree = { story: { ...story, status: 'STORYBOARDING' }, scenes: [{ order: 1 }], shots: [], characters: [], candidates: [], drafts: [] };
    repo.loadTree.mockResolvedValueOnce(tree);
    const res = await applyPOST(mk(), actx());
    expect(res.status).toBe(200);
    expect(repo.applyDraft).toHaveBeenCalledWith(VS, DR);
    expect(repo.patch).toHaveBeenCalledWith(VS, { status: 'STORYBOARDING' });
    expect(repo.applyDraft.mock.invocationCallOrder[0]).toBeLessThan(repo.patch.mock.invocationCallOrder[0]);
    expect((await res.json()).data).toEqual(tree);
  });

  it('unknown draft ⇒ 404, status untouched', async () => {
    repo.applyDraft.mockRejectedValueOnce(new NotFoundError('nope'));
    expect((await applyPOST(mk(), actx())).status).toBe(404);
    expect(repo.patch).not.toHaveBeenCalled();
  });

  it('DraftTooLargeError ⇒ 400', async () => {
    repo.applyDraft.mockRejectedValueOnce(new DraftTooLargeError(120));
    expect((await applyPOST(mk(), actx())).status).toBe(400);
    expect(repo.patch).not.toHaveBeenCalled();
  });
});
