/** @jest-environment node */
/**
 * compose-worker loads the AI keys from SSM at cold start and every job waits
 * for them. This shipped from an unmerged branch on 2026-08-21, so a deploy
 * from master (2026-11-05) silently dropped it and every AI job failed with
 * "ANTHROPIC_API_KEY missing". This test keeps it in master.
 */

const ssmSend = jest.fn(async (cmd: { input: { Name: string } }) => ({
  Parameter: { Value: `value-of-${cmd.input.Name}` },
}));
jest.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: class { send = (c: { input: { Name: string } }) => ssmSend(c); },
  GetParameterCommand: class { constructor(public input: Record<string, unknown>) {} },
}));
jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: class {} }));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: jest.fn().mockResolvedValue({}) }) },
  UpdateCommand: class { constructor(public input: Record<string, unknown>) {} },
}));
jest.mock('@/services/ai/composer', () => ({ composeFromLyrics: jest.fn() }));
jest.mock('@/services/ai/lyricCritic', () => ({ critiqueLyric: jest.fn() }));
jest.mock('@/services/ai/sunoSetup', () => ({ generateSunoSetup: jest.fn() }));
const runStoryboardJob = jest.fn(async () => ({
  ok: true,
  keySeen: process.env.ANTHROPIC_API_KEY,
}));
jest.mock('@/services/video/storyboard-job', () => ({ runStoryboardJob: () => runStoryboardJob() }));

it('reads both AI keys from /tamilagaval/prod in SSM before running any job', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { handler } = require('../../worker/compose-worker') as typeof import('../../worker/compose-worker');
  const out = await handler({ kind: 'storyboard', jobId: 'dj_1', vsId: 'vs_1', lyrics: 'x', windowSec: 30, aspectRatio: '9:16' });
  const names = ssmSend.mock.calls.map((c) => c[0].input.Name).sort();
  expect(names).toEqual(['/tamilagaval/prod/ANTHROPIC_API_KEY', '/tamilagaval/prod/GEMINI_API_KEY']);
  expect(out).toEqual({ ok: true, keySeen: 'value-of-/tamilagaval/prod/ANTHROPIC_API_KEY' });
  expect(process.env.GEMINI_API_KEY).toBe('value-of-/tamilagaval/prod/GEMINI_API_KEY');
});
