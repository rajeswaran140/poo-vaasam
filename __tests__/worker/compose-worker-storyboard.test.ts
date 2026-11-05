/** @jest-environment node */
/**
 * compose-worker — the 'storyboard' kind (R14). The worker only dispatches:
 * the job logic (claim, call, save, exactly-one settle) lives in
 * storyboard-job and is tested there. What matters here is that a storyboard
 * event reaches it intact and never falls through to the compose path (which
 * would write a COMPOSEJOB# item and run the composer on the lyrics).
 */

const send = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: class {} }));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: (...a: unknown[]) => send(...a) }) },
  UpdateCommand: class { constructor(public input: Record<string, unknown>) {} },
}));
const composeFromLyrics = jest.fn();
jest.mock('@/services/ai/composer', () => ({ composeFromLyrics: (...a: unknown[]) => composeFromLyrics(...a) }));
jest.mock('@/services/ai/lyricCritic', () => ({ critiqueLyric: jest.fn() }));
jest.mock('@/services/ai/sunoSetup', () => ({ generateSunoSetup: jest.fn() }));
const runStoryboardJob = jest.fn();
jest.mock('@/services/video/storyboard-job', () => ({ runStoryboardJob: (...a: unknown[]) => runStoryboardJob(...a) }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { handler } = require('../../worker/compose-worker') as typeof import('../../worker/compose-worker');

const event = {
  kind: 'storyboard' as const,
  jobId: 'dj_1700000000000_abcdef12',
  vsId: 'vs_1700000000000_abcdef12',
  lyrics: 'Line one of the test song',
  windowSec: 45,
  aspectRatio: '9:16' as const,
};

beforeEach(() => jest.clearAllMocks());

it('dispatches a storyboard event to runStoryboardJob and returns its outcome', async () => {
  runStoryboardJob.mockResolvedValueOnce({ ok: true, status: 'done' });
  await expect(handler(event)).resolves.toEqual({ ok: true, status: 'done' });
  expect(runStoryboardJob).toHaveBeenCalledWith(event);
  expect(composeFromLyrics).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled(); // no COMPOSEJOB#/CRITICJOB# write
});

it('other kinds still take the existing path', async () => {
  composeFromLyrics.mockResolvedValueOnce({ ok: true, data: {} });
  await handler({ jobId: 'compose_1', lyrics: 'x' });
  expect(runStoryboardJob).not.toHaveBeenCalled();
  expect(composeFromLyrics).toHaveBeenCalled();
});
