/** @jest-environment node */
/**
 * The storyboard draft job (R14) — what the compose worker runs and what the
 * job route's sweep runs. The money rule under test: exactly ONE settle per
 * reservation, by whichever side wins the conditional job transition; billed
 * = token cost whenever a response was received (ok or bad_response), else 0.
 */

import { createHash } from 'crypto';

const repo = {
  listDraftJobs: jest.fn(),
  transitionDraftJob: jest.fn(),
  getDraftJob: jest.fn(),
  putDraft: jest.fn(),
  settle: jest.fn(),
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

import {
  runStoryboardJob,
  sweepStaleDraftJob,
  sweepStaleDraftJobs,
  DRAFT_JOB_STALE_MS,
  WORKER_DRAFT_TIMEOUT_MS,
  STALE_DRAFT_ERROR,
} from '@/services/video/storyboard-job';
import { VisualStoryRepository, NotFoundError } from '@/infrastructure/database/VisualStoryRepository';
import { draftCostUsd } from '@/services/video/cost';

const VS = 'vs_1700000000000_abcdef12';
const JOB = 'dj_1700000000000_abcdef12';
const LYRICS = 'Line one of the test song\nLine two';
const RESERVED = 0.0975;
const event = { kind: 'storyboard' as const, jobId: JOB, vsId: VS, lyrics: LYRICS, windowSec: 45, aspectRatio: '9:16' as const };
const running = { jobId: JOB, status: 'running', createdAt: 't0', updatedAt: 't1', reservedUsd: RESERVED };
const data = {
  characters: [{ name: 'Test girl', description: 'a girl' }],
  scenes: [{ heading: 'Scene 1', summary: 's', shots: [{ durationSec: 45, mode: 'STILL', visualPrompt: 'p', characterNames: [] }] }],
};
const usage = { inputTokens: 2000, outputTokens: 3000 };
const cost = draftCostUsd(2000, 3000);

let logs: jest.SpyInstance[];
beforeEach(() => {
  jest.resetAllMocks();
  (VisualStoryRepository as unknown as jest.Mock).mockImplementation(() => repo);
  logs = [jest.spyOn(console, 'error').mockImplementation(() => {}), jest.spyOn(console, 'info').mockImplementation(() => {})];
  repo.transitionDraftJob.mockImplementation(async (_vs, _job, _from, to, fields) => ({ ...running, status: to, ...fields }));
  repo.putDraft.mockResolvedValue(undefined);
  repo.settle.mockResolvedValue(undefined);
  mockGenerate.mockResolvedValue({ ok: true, data, usage });
});
afterEach(() => logs.forEach((s) => s.mockRestore()));

const allLogs = () => JSON.stringify(logs.map((s) => s.mock.calls));
const finalTransition = () => repo.transitionDraftJob.mock.calls.at(-1)!;

describe('runStoryboardJob', () => {
  it('ok: queued → running, 150 s timeout, putDraft (hash only), done with draftId, ONE billed settle', async () => {
    await runStoryboardJob(event);

    expect(repo.transitionDraftJob.mock.calls[0]).toEqual([VS, JOB, ['queued'], 'running']);
    expect(mockGenerate).toHaveBeenCalledWith(
      { lyrics: LYRICS, windowSec: 45, aspectRatio: '9:16' },
      { timeoutMs: WORKER_DRAFT_TIMEOUT_MS }
    );
    expect(WORKER_DRAFT_TIMEOUT_MS).toBe(150_000);

    const [vsArg, draft] = repo.putDraft.mock.calls[0];
    expect(vsArg).toBe(VS);
    expect(draft.lyricsHash).toBe(createHash('sha256').update(LYRICS).digest('hex'));
    expect(JSON.stringify(draft)).not.toContain('Line one');
    expect(draft).toMatchObject({ inputTokens: 2000, outputTokens: 3000, costUsd: cost, characters: data.characters, scenes: data.scenes });
    expect(draft.draftId).toMatch(/^dr_\d{13}_[a-z0-9]{8}$/);

    expect(finalTransition()).toEqual([VS, JOB, ['running'], 'done', { draftId: draft.draftId }]);
    expect(repo.settle).toHaveBeenCalledTimes(1);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: RESERVED, billedUsd: cost });
    expect(repo.putDraft.mock.invocationCallOrder[0]).toBeLessThan(repo.settle.mock.invocationCallOrder[0]);
    expect(allLogs()).not.toContain('Line one');
  });

  it('bad_response WITH usage: failed with the safe message, billed at token cost', async () => {
    mockGenerate.mockResolvedValueOnce({ ok: false, code: 'bad_response', error: 'The AI returned an incomplete storyboard. Please try again.', usage });
    await runStoryboardJob(event);
    expect(repo.putDraft).not.toHaveBeenCalled();
    expect(finalTransition()).toEqual([
      VS, JOB, ['running'], 'failed',
      { code: 'bad_response', error: 'The AI returned an incomplete storyboard. Please try again.' },
    ]);
    expect(repo.settle).toHaveBeenCalledTimes(1);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: RESERVED, billedUsd: cost });
  });

  it.each(['upstream', 'not_configured', 'auth', 'billing', 'rate_limit'])('%s without usage: failed, released unbilled', async (code) => {
    mockGenerate.mockResolvedValueOnce({ ok: false, code, error: 'safe copy' });
    await runStoryboardJob(event);
    expect(finalTransition()).toEqual([VS, JOB, ['running'], 'failed', { code, error: 'safe copy' }]);
    expect(repo.settle).toHaveBeenCalledTimes(1);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: RESERVED, billedUsd: 0 });
  });

  it('generateStoryboard THROWS: failed upstream, released unbilled, error name only in logs', async () => {
    mockGenerate.mockRejectedValueOnce(new Error(`boom ${LYRICS}`));
    await runStoryboardJob(event);
    expect(finalTransition()[3]).toBe('failed');
    expect(finalTransition()[4]).toMatchObject({ code: 'upstream' });
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: RESERVED, billedUsd: 0 });
    expect(allLogs()).not.toContain('Line one');
  });

  it('putDraft fails after a billed call: failed, still settled as billed', async () => {
    repo.putDraft.mockRejectedValueOnce(new Error('ddb'));
    await runStoryboardJob(event);
    expect(finalTransition()[3]).toBe('failed');
    expect(repo.settle).toHaveBeenCalledTimes(1);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: RESERVED, billedUsd: cost });
  });

  it('skips when the job is not queued (duplicate delivery, or the sweep failed it): no call, no settle', async () => {
    repo.transitionDraftJob.mockResolvedValueOnce(null);
    const out = await runStoryboardJob(event);
    expect(out).toMatchObject({ status: 'skipped' });
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(repo.settle).not.toHaveBeenCalled();
  });

  it('does not settle when the final running → done transition loses (the sweep already released)', async () => {
    repo.transitionDraftJob
      .mockResolvedValueOnce({ ...running }) // queued → running
      .mockResolvedValueOnce(null); // running → done: no longer running
    await runStoryboardJob(event);
    expect(repo.settle).not.toHaveBeenCalled();
  });

  it('retries a final transition that THROWS once, then settles', async () => {
    repo.transitionDraftJob
      .mockResolvedValueOnce({ ...running })
      .mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'DynamoDBError' }))
      .mockResolvedValueOnce({ ...running, status: 'done' });
    await runStoryboardJob(event);
    expect(repo.settle).toHaveBeenCalledTimes(1);
  });

  it('never throws: claim failure leaves the job queued for the sweep', async () => {
    repo.transitionDraftJob.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'DynamoDBError' }));
    await expect(runStoryboardJob(event)).resolves.toMatchObject({ ok: false });
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(repo.settle).not.toHaveBeenCalled();
  });

  it('settle failing (story deleted mid-call) is logged and swallowed', async () => {
    repo.settle.mockRejectedValueOnce(new NotFoundError('gone'));
    await expect(runStoryboardJob(event)).resolves.toMatchObject({ ok: true, status: 'done' });
  });

  it('malformed ids: nothing is touched', async () => {
    await runStoryboardJob({ ...event, vsId: '../x' });
    await runStoryboardJob({ ...event, jobId: 'nope' });
    expect(repo.transitionDraftJob).not.toHaveBeenCalled();
    expect(repo.settle).not.toHaveBeenCalled();
  });

  it('a bad payload with valid ids: claimed, failed and released, provider never called', async () => {
    await runStoryboardJob({ ...event, windowSec: 7 });
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(finalTransition()[3]).toBe('failed');
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: RESERVED, billedUsd: 0 });
  });
});

describe('sweepStaleDraftJob', () => {
  const NOW = Date.parse('2026-11-04T12:00:00.000Z');
  const old = new Date(NOW - DRAFT_JOB_STALE_MS - 1000).toISOString();
  const young = new Date(NOW - 60_000).toISOString();
  const r = () => new VisualStoryRepository();

  it.each(['queued', 'running'])('a %s job older than 10 minutes is failed and released exactly once', async (status) => {
    const job = { jobId: JOB, status, createdAt: old, updatedAt: old, reservedUsd: RESERVED };
    const out = await sweepStaleDraftJob(r(), VS, job as never, NOW);
    expect(repo.transitionDraftJob).toHaveBeenCalledWith(VS, JOB, ['queued', 'running'], 'failed', {
      code: 'timeout',
      error: STALE_DRAFT_ERROR,
    });
    expect(STALE_DRAFT_ERROR).toBe('The draft took too long. Please try again.');
    expect(repo.settle).toHaveBeenCalledTimes(1);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: RESERVED, billedUsd: 0 });
    expect(out.status).toBe('failed');
  });

  it('does nothing when the worker already finished (transition loses): no settle, returns the fresh job', async () => {
    const job = { jobId: JOB, status: 'running', createdAt: old, updatedAt: old, reservedUsd: RESERVED };
    repo.transitionDraftJob.mockResolvedValueOnce(null);
    repo.getDraftJob.mockResolvedValueOnce({ ...job, status: 'done', draftId: 'dr_1' });
    const out = await sweepStaleDraftJob(r(), VS, job as never, NOW);
    expect(repo.settle).not.toHaveBeenCalled();
    expect(out).toMatchObject({ status: 'done', draftId: 'dr_1' });
  });

  it('leaves a young or terminal job alone', async () => {
    await sweepStaleDraftJob(r(), VS, { jobId: JOB, status: 'running', createdAt: young, updatedAt: young, reservedUsd: RESERVED }, NOW);
    await sweepStaleDraftJob(r(), VS, { jobId: JOB, status: 'done', createdAt: old, updatedAt: old, reservedUsd: RESERVED }, NOW);
    await sweepStaleDraftJob(r(), VS, { jobId: JOB, status: 'failed', createdAt: old, updatedAt: old, reservedUsd: RESERVED }, NOW);
    expect(repo.transitionDraftJob).not.toHaveBeenCalled();
    expect(repo.settle).not.toHaveBeenCalled();
  });

  it('two sweeps racing: only the one whose transition wins settles', async () => {
    const job = { jobId: JOB, status: 'running', createdAt: old, updatedAt: old, reservedUsd: RESERVED };
    repo.transitionDraftJob.mockResolvedValueOnce({ ...job, status: 'failed' }).mockResolvedValueOnce(null);
    repo.getDraftJob.mockResolvedValue({ ...job, status: 'failed' });
    await Promise.all([sweepStaleDraftJob(r(), VS, job as never, NOW), sweepStaleDraftJob(r(), VS, job as never, NOW)]);
    expect(repo.settle).toHaveBeenCalledTimes(1);
  });
});

describe('sweepStaleDraftJobs (every story load and every new draft)', () => {
  const NOW = Date.parse('2026-11-04T12:00:00.000Z');
  const old = new Date(NOW - DRAFT_JOB_STALE_MS - 1000).toISOString();
  const young = new Date(NOW - 60_000).toISOString();
  const j = (jobId: string, status: string, createdAt: string) => ({ jobId, status, createdAt, updatedAt: createdAt, reservedUsd: RESERVED });

  it('fails and releases every stale active job once; leaves young and finished ones alone', async () => {
    repo.listDraftJobs.mockResolvedValueOnce([
      j('dj_1700000000000_aaaaaaaa', 'queued', old),
      j('dj_1700000000000_bbbbbbbb', 'running', young),
      j('dj_1700000000000_cccccccc', 'done', old),
      j('dj_1700000000000_dddddddd', 'running', old),
    ]);
    await sweepStaleDraftJobs(new VisualStoryRepository(), VS, NOW);
    expect(repo.transitionDraftJob.mock.calls.map((c) => c[1])).toEqual(['dj_1700000000000_aaaaaaaa', 'dj_1700000000000_dddddddd']);
    expect(repo.settle).toHaveBeenCalledTimes(2);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: RESERVED, billedUsd: 0 });
  });

  it('never throws: a storage failure is logged by name and the caller carries on', async () => {
    repo.listDraftJobs.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'DynamoDBError' }));
    await expect(sweepStaleDraftJobs(new VisualStoryRepository(), VS, NOW)).resolves.toBeUndefined();
  });
});
