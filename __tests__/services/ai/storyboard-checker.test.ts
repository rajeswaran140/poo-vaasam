/** @jest-environment node */
/**
 * Storyboard check (Claude). The silent failures: an issue pointing at a shot
 * that does not exist (the panel's link goes nowhere), a person in a prompt
 * shown by charId instead of name (Claude cannot match the character list),
 * the lyrics leaking into a log, and a cut-off answer treated as a clean bill.
 */

const create = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ messages: { create } })),
}));

import { checkStoryboard, storyboardHash, CHECK_SYSTEM_PROMPT } from '@/services/ai/storyboard-checker';
import { buildCheckInput, buildCheckMessage, keepKnownIssues, MAX_CHECK_ISSUES } from '@/lib/visual-story-check';
import { CHECK_MAX_OUTPUT_TOKENS, checkReserveUsd, draftCostUsd } from '@/services/video/cost';
import type { Shot } from '@/types/visualStory';

const LYRICS = 'Placeholder line one\nPlaceholder line two';
const shot = (sceneOrder: number, shotOrder: number, over: Partial<Shot> = {}): Shot => ({
  sceneOrder, shotOrder, mode: 'STILL', durationSec: 15, startSec: 0, visualPrompt: `prompt ${sceneOrder}.${shotOrder}`,
  negativePrompt: '', charIds: [], selectedCandidateId: null, ...over,
});
const tree = () => ({
  story: { aspectRatio: '9:16' as const, windowStartSec: 10, windowEndSec: 55, style: ' warm film ' },
  // Out of order on purpose: the check reads them in story order.
  scenes: [
    { order: 2, heading: 'Two', summary: 'second' },
    { order: 1, heading: 'One', summary: 'first' },
  ],
  shots: [shot(2, 1), shot(1, 2, { charIds: ['ch_1700000000000_aaaaaaaa'] }), shot(1, 1)],
  characters: [{ charId: 'ch_1700000000000_aaaaaaaa', name: 'Test girl', description: 'a girl in blue', refImageKeys: [], createdAt: 't' }],
});
const tool = (input: unknown, extra: Record<string, unknown> = {}) => ({
  content: [{ type: 'tool_use', name: 'submit_check', input }],
  stop_reason: 'tool_use',
  usage: { input_tokens: 3000, output_tokens: 800 },
  ...extra,
});

let logs: jest.SpyInstance[];
beforeEach(() => {
  create.mockReset();
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
  logs = [jest.spyOn(console, 'error').mockImplementation(() => {}), jest.spyOn(console, 'info').mockImplementation(() => {})];
});
afterEach(() => logs.forEach((s) => s.mockRestore()));

describe('what is sent', () => {
  it('orders scenes and shots, names characters, trims the style', () => {
    const input = buildCheckInput(tree());
    expect(input.windowSec).toBe(45);
    expect(input.style).toBe('warm film');
    expect(input.scenes.map((s) => s.order)).toEqual([1, 2]);
    expect(input.scenes[0].shots.map((s) => s.shotOrder)).toEqual([1, 2]);
    expect(input.scenes[0].shots[1].characters).toEqual(['Test girl']);
  });

  it('includes the lyrics only when given', () => {
    const input = buildCheckInput(tree());
    expect(buildCheckMessage(input, LYRICS)).toContain(LYRICS);
    expect(buildCheckMessage(input)).toContain('No lyrics were given');
    expect(buildCheckMessage(input, '   ')).toContain('No lyrics were given');
  });

  it('prices the button from the same message, longer with lyrics', () => {
    const input = buildCheckInput(tree());
    expect(checkReserveUsd(buildCheckMessage(input, LYRICS).length)).toBeGreaterThan(checkReserveUsd(buildCheckMessage(input).length));
  });

  it('hashes a changed prompt differently', () => {
    const a = storyboardHash(buildCheckInput(tree()));
    const t = tree();
    t.shots[0] = shot(2, 1, { visualPrompt: 'changed' });
    expect(storyboardHash(buildCheckInput(t))).not.toBe(a);
    expect(storyboardHash(buildCheckInput(tree()))).toBe(a);
  });

  it('tells Claude what the image model cannot see, and to stay off the music', () => {
    expect(CHECK_SYSTEM_PROMPT).toMatch(/sees nothing else/);
    expect(CHECK_SYSTEM_PROMPT).toMatch(/Never comment on music/);
  });
});

describe('keepKnownIssues', () => {
  it('drops issues for a scene or shot that does not exist; keeps scene-wide ones', () => {
    const input = buildCheckInput(tree());
    const base = { kind: 'repeat' as const, problem: 'p', suggestion: 's' };
    const kept = keepKnownIssues(input, [
      { ...base, sceneOrder: 1, shotOrder: 2 },
      { ...base, sceneOrder: 1, shotOrder: 9 },
      { ...base, sceneOrder: 7, shotOrder: null },
      { ...base, sceneOrder: 2, shotOrder: null },
    ]);
    expect(kept.map((i) => [i.sceneOrder, i.shotOrder])).toEqual([[1, 2], [2, null]]);
  });
});

describe('checkStoryboard', () => {
  const input = () => buildCheckInput(tree());

  it('forces the tool, caps output, and returns the filtered issues with usage', async () => {
    create.mockResolvedValue(tool({
      summary: 'Nearly ready.',
      issues: [
        { kind: 'character', sceneOrder: 1, shotOrder: 2, problem: 'p', suggestion: 's' },
        { kind: 'text', sceneOrder: 5, shotOrder: 1, problem: 'gone', suggestion: 's' },
      ],
    }));
    const r = await checkStoryboard(input(), { lyrics: LYRICS, timeoutMs: 1234 });
    const [body, opts] = create.mock.calls[0];
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'submit_check' });
    expect(body.max_tokens).toBe(CHECK_MAX_OUTPUT_TOKENS);
    expect(body.messages[0].content).toContain(LYRICS);
    expect(opts).toEqual({ timeout: 1234 });
    expect(r).toEqual({
      ok: true,
      summary: 'Nearly ready.',
      issues: [{ kind: 'character', sceneOrder: 1, shotOrder: 2, problem: 'p', suggestion: 's' }],
      usage: { inputTokens: 3000, outputTokens: 800 },
    });
  });

  it('a cut-off answer is a billed failure, never an empty list', async () => {
    create.mockResolvedValue(tool({ summary: 'x', issues: [] }, { stop_reason: 'max_tokens' }));
    const r = await checkStoryboard(input(), { timeoutMs: 1 });
    expect(r).toMatchObject({ ok: false, code: 'bad_response', usage: { inputTokens: 3000, outputTokens: 800 } });
  });

  it('refuses more than the issue limit or an unknown kind', async () => {
    const many = Array.from({ length: MAX_CHECK_ISSUES + 1 }, () => ({ kind: 'other', sceneOrder: 1, shotOrder: 1, problem: 'p', suggestion: 's' }));
    create.mockResolvedValue(tool({ summary: 'x', issues: many }));
    expect(await checkStoryboard(input(), { timeoutMs: 1 })).toMatchObject({ ok: false, code: 'bad_response' });
    create.mockResolvedValue(tool({ summary: 'x', issues: [{ kind: 'music', sceneOrder: 1, shotOrder: 1, problem: 'p', suggestion: 's' }] }));
    expect(await checkStoryboard(input(), { timeoutMs: 1 })).toMatchObject({ ok: false, code: 'bad_response' });
  });

  it('maps a failed call without logging its message (it may echo the lyrics)', async () => {
    create.mockRejectedValue(Object.assign(new Error(`bad request: ${LYRICS}`), { status: 500 }));
    const r = await checkStoryboard(input(), { lyrics: LYRICS, timeoutMs: 1 });
    expect(r).toEqual({ ok: false, code: 'upstream', error: expect.any(String) });
    expect(JSON.stringify(logs.map((s) => s.mock.calls))).not.toContain('Placeholder line');
  });

  it('is not configured without a key', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(await checkStoryboard(input(), { timeoutMs: 1 })).toMatchObject({ ok: false, code: 'not_configured' });
    expect(create).not.toHaveBeenCalled();
  });

  it('prices usage at the Sonnet rate', () => {
    expect(draftCostUsd(3000, 800)).toBeCloseTo(0.021, 6);
  });
});
