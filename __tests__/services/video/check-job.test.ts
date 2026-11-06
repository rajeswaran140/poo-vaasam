/** @jest-environment node */
/**
 * The storyboard check job — what the compose worker runs and what the check
 * routes' sweep runs. The money rule: exactly ONE settle per reservation, by
 * whichever side wins the conditional transition; billed = token cost
 * whenever a response arrived. Lyrics never reach a stored field or a log.
 */

const repo = {
  listChecks: jest.fn(),
  transitionCheck: jest.fn(),
  getCheck: jest.fn(),
  settle: jest.fn(),
};
jest.mock('@/infrastructure/database/VisualStoryRepository', () => ({
  ...jest.requireActual('@/infrastructure/database/VisualStoryRepository'),
  VisualStoryRepository: jest.fn().mockImplementation(() => repo),
}));

const mockCheck = jest.fn();
jest.mock('@/services/ai/storyboard-checker', () => ({
  ...jest.requireActual('@/services/ai/storyboard-checker'),
  checkStoryboard: (...a: unknown[]) => mockCheck(...a),
}));

import {
  runCheckJob,
  sweepStaleCheck,
  sweepStaleChecks,
  CHECK_STALE_MS,
  WORKER_CHECK_TIMEOUT_MS,
  STALE_CHECK_ERROR,
} from '@/services/video/check-job';
import { VisualStoryRepository } from '@/infrastructure/database/VisualStoryRepository';
import { draftCostUsd } from '@/services/video/cost';
import type { CheckInput } from '@/lib/visual-story-check';

const VS = 'vs_1700000000000_abcdef12';
const CK = 'ck_1700000000000_abcdef12';
const LYRICS = 'Placeholder line one\nPlaceholder line two';
const RESERVED = 0.08;
const input: CheckInput = {
  aspectRatio: '9:16',
  windowSec: 45,
  style: '',
  characters: [{ name: 'Test girl', description: 'a girl' }],
  scenes: [{ order: 1, heading: 'One', summary: 's', shots: [{ shotOrder: 1, startSec: 0, durationSec: 45, mode: 'STILL', visualPrompt: 'p', characters: [] }] }],
};
const event = { kind: 'story-check' as const, checkId: CK, vsId: VS, input, lyrics: LYRICS };
const running = { checkId: CK, status: 'running', createdAt: 't0', updatedAt: 't1', reservedUsd: RESERVED, shotsHash: 'h', withLyrics: true };
const usage = { inputTokens: 3000, outputTokens: 800 };
const issues = [{ kind: 'repeat', sceneOrder: 1, shotOrder: 1, problem: 'p', suggestion: 's' }];

let logs: jest.SpyInstance[];
beforeEach(() => {
  jest.resetAllMocks();
  (VisualStoryRepository as unknown as jest.Mock).mockImplementation(() => repo);
  logs = [jest.spyOn(console, 'error').mockImplementation(() => {}), jest.spyOn(console, 'info').mockImplementation(() => {})];
  repo.transitionCheck.mockImplementation(async (_vs, _ck, _from, to, fields) => ({ ...running, status: to, ...fields }));
  repo.settle.mockResolvedValue(undefined);
  mockCheck.mockResolvedValue({ ok: true, summary: 'Ready.', issues, usage });
});
afterEach(() => logs.forEach((s) => s.mockRestore()));

const finalTransition = () => repo.transitionCheck.mock.calls.at(-1)!;

describe('runCheckJob', () => {
  it('ok: claims, checks with the lyrics, stores the result (no lyrics), ONE billed settle', async () => {
    expect(await runCheckJob(event)).toEqual({ ok: true, status: 'done' });
    expect(repo.transitionCheck.mock.calls[0]).toEqual([VS, CK, ['queued'], 'running']);
    expect(mockCheck).toHaveBeenCalledWith(input, { lyrics: LYRICS, timeoutMs: WORKER_CHECK_TIMEOUT_MS });
    const cost = draftCostUsd(3000, 800);
    expect(finalTransition()).toEqual([VS, CK, ['running'], 'done', { summary: 'Ready.', issues, costUsd: cost }]);
    expect(JSON.stringify(repo.transitionCheck.mock.calls)).not.toContain('Placeholder line');
    expect(repo.settle).toHaveBeenCalledTimes(1);
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: RESERVED, billedUsd: cost });
    expect(JSON.stringify(logs.map((s) => s.mock.calls))).not.toContain('Placeholder line');
  });

  it('the timeouts are ordered: worker call < Lambda 720 s < stale sweep', () => {
    expect(WORKER_CHECK_TIMEOUT_MS).toBeLessThan(720_000);
    expect(CHECK_STALE_MS).toBeGreaterThan(720_000);
  });

  it('sends no lyrics key when none were pasted', async () => {
    const { lyrics: _l, ...noLyrics } = event;
    await runCheckJob(noLyrics);
    expect(mockCheck).toHaveBeenCalledWith(input, { timeoutMs: WORKER_CHECK_TIMEOUT_MS });
  });

  it('a billed failure settles its tokens; an unbilled one settles 0', async () => {
    mockCheck.mockResolvedValueOnce({ ok: false, code: 'bad_response', error: 'cut off', usage });
    await runCheckJob(event);
    expect(finalTransition()[3]).toBe('failed');
    expect(repo.settle).toHaveBeenLastCalledWith(VS, { reservedUsd: RESERVED, billedUsd: draftCostUsd(3000, 800) });

    mockCheck.mockResolvedValueOnce({ ok: false, code: 'upstream', error: 'down' });
    await runCheckJob(event);
    expect(repo.settle).toHaveBeenLastCalledWith(VS, { reservedUsd: RESERVED, billedUsd: 0 });
  });

  it('a checker that throws still finishes the check', async () => {
    mockCheck.mockRejectedValueOnce(new Error('boom'));
    expect(await runCheckJob(event)).toEqual({ ok: true, status: 'failed' });
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: RESERVED, billedUsd: 0 });
  });

  it('refuses a malformed storyboard without a paid call', async () => {
    const bad = { ...event, input: { ...input, scenes: [{ ...input.scenes[0], shots: [{ ...input.scenes[0].shots[0], visualPrompt: 'x'.repeat(2001) }] }] } };
    await runCheckJob(bad);
    expect(mockCheck).not.toHaveBeenCalled();
    expect(finalTransition()[3]).toBe('failed');
    expect(finalTransition()[4]).toMatchObject({ code: 'bad_request' });
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: RESERVED, billedUsd: 0 });
  });

  it('skips a check that is not queued, and refuses a bad id, without a call or a settle', async () => {
    repo.transitionCheck.mockResolvedValueOnce(null);
    expect(await runCheckJob(event)).toEqual({ ok: true, status: 'skipped' });
    expect(await runCheckJob({ ...event, checkId: 'dj_1700000000000_abcdef12' })).toEqual({ ok: false, status: 'bad-event' });
    expect(mockCheck).not.toHaveBeenCalled();
    expect(repo.settle).not.toHaveBeenCalled();
  });

  it('does not settle when the sweep won the final transition', async () => {
    repo.transitionCheck.mockResolvedValueOnce(running).mockResolvedValueOnce(null);
    expect(await runCheckJob(event)).toEqual({ ok: true, status: 'lost' });
    expect(repo.settle).not.toHaveBeenCalled();
  });
});

describe('sweep', () => {
  const at = (ageMs: number) => ({ ...running, status: 'queued', createdAt: new Date(1_000_000_000 - ageMs).toISOString() });

  it('leaves a young or finished check alone', async () => {
    expect(await sweepStaleCheck(repo, VS, at(60_000) as never, 1_000_000_000)).toMatchObject({ status: 'queued' });
    expect(await sweepStaleCheck(repo, VS, { ...at(CHECK_STALE_MS * 2), status: 'done' } as never, 1_000_000_000)).toMatchObject({ status: 'done' });
    expect(repo.transitionCheck).not.toHaveBeenCalled();
  });

  it('fails and releases an old one, unbilled', async () => {
    const out = await sweepStaleCheck(repo, VS, at(CHECK_STALE_MS + 1) as never, 1_000_000_000);
    expect(repo.transitionCheck).toHaveBeenCalledWith(VS, CK, ['queued', 'running'], 'failed', { code: 'timeout', error: STALE_CHECK_ERROR });
    expect(out.status).toBe('failed');
    expect(repo.settle).toHaveBeenCalledWith(VS, { reservedUsd: RESERVED, billedUsd: 0 });
  });

  it('returns the current row when the worker won the race', async () => {
    repo.transitionCheck.mockResolvedValueOnce(null);
    repo.getCheck.mockResolvedValueOnce({ ...running, status: 'done' });
    expect(await sweepStaleCheck(repo, VS, at(CHECK_STALE_MS + 1) as never, 1_000_000_000)).toMatchObject({ status: 'done' });
    expect(repo.settle).not.toHaveBeenCalled();
  });

  it('sweeps every check of a story; a failed read throws (guards fail closed)', async () => {
    repo.listChecks.mockResolvedValueOnce([at(CHECK_STALE_MS + 1), { ...running, status: 'done' }]);
    const out = await sweepStaleChecks(repo, VS, 1_000_000_000);
    expect(out.map((c) => c.status)).toEqual(['failed', 'done']);
    repo.listChecks.mockRejectedValueOnce(new Error('ddb'));
    await expect(sweepStaleChecks(repo, VS)).rejects.toThrow('ddb');
  });
});
