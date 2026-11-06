/** @jest-environment node */
/**
 * Tests for src/services/ai/storyboarder.ts — tool-forced call, tiling repair,
 * system-prompt rules, error mapping, truncation, usage.
 */

const create = jest.fn();
const ctor = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation((opts: unknown) => {
    ctor(opts);
    return { messages: { create } };
  }),
}));

import { generateStoryboard, SYSTEM_PROMPT } from '@/services/ai/storyboarder';
import type { StoryboardDraft } from '@/types/visualStory';

const originalEnv = process.env.ANTHROPIC_API_KEY;
beforeEach(() => {
  create.mockReset();
  ctor.mockReset();
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
});
afterAll(() => {
  process.env.ANTHROPIC_API_KEY = originalEnv;
});

const LYRICS = 'Line one of a placeholder song\nLine two of a placeholder song';
const shot = (durationSec: number, extra: Record<string, unknown> = {}) => ({
  durationSec,
  mode: 'STILL',
  visualPrompt: 'A test visual',
  characterNames: ['Test Person'],
  ...extra,
});
const board = (scene1: number[], scene2: number[]) => ({
  characters: [{ name: 'Test Person', description: 'A test description' }],
  scenes: [
    { heading: 'Scene 1', summary: 'First.', shots: scene1.map((d) => shot(d)) },
    { heading: 'Scene 2', summary: 'Second.', shots: scene2.map((d) => shot(d)) },
  ],
});
const toolResponse = (input: unknown, extra: Record<string, unknown> = {}) => ({
  content: [{ type: 'tool_use', name: 'submit_storyboard', input }],
  stop_reason: 'tool_use',
  usage: { input_tokens: 120, output_tokens: 900 },
  ...extra,
});
const req = { lyrics: LYRICS, windowSec: 30, aspectRatio: '9:16' as const };
const durations = (r: { ok: true; data: { scenes: { shots: { durationSec: number }[] }[] } }) =>
  r.data.scenes.flatMap((s) => s.shots.map((x) => x.durationSec));

it('returns not_configured without a key', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  expect(await generateStoryboard(req)).toMatchObject({ ok: false, code: 'not_configured' });
  expect(create).not.toHaveBeenCalled();
});

it('happy path: durations already sum to the window; usage returned', async () => {
  create.mockResolvedValue(toolResponse(board([10, 5], [15])));
  const r = await generateStoryboard(req);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(durations(r).reduce((a, b) => a + b, 0)).toBe(30);
  expect(r.usage).toEqual({ inputTokens: 120, outputTokens: 900 });
  // assignable to the client-safe draft shape (R2)
  const pick: Pick<StoryboardDraft, 'characters' | 'scenes'> = r.data;
  expect(pick.scenes).toHaveLength(2);
});

it('sum short by 4 is repaired on the last shot', async () => {
  create.mockResolvedValue(toolResponse(board([10, 5], [11])));
  const r = await generateStoryboard(req);
  expect(r.ok && durations(r)).toEqual([10, 5, 15]);
});

it('repair caps at 15 and spills into the previous shot', async () => {
  create.mockResolvedValue(toolResponse(board([10, 3], [13])));
  const r = await generateStoryboard(req); // sum 26, diff +4
  expect(r.ok && durations(r)).toEqual([10, 5, 15]);
});

it('repair shortens from the end when over, never below 1', async () => {
  create.mockResolvedValue(toolResponse(board([10, 10], [3, 1, 1, 8]))); // sum 33, diff -3
  const r = await generateStoryboard(req);
  expect(r.ok && durations(r)).toEqual([10, 10, 3, 1, 1, 5]);
  // every shot already at its floor: cannot shorten further -> refused
  create.mockResolvedValue(toolResponse(board([1, 1], [1, 1])));
  const r2 = await generateStoryboard({ ...req, windowSec: 3 });
  expect(r2).toMatchObject({ ok: false, code: 'bad_response' });
});

it('sum off by 40 is bad_response with the draft-again copy', async () => {
  create.mockResolvedValue(toolResponse(board([15, 15], [15, 15])));
  const r = await generateStoryboard({ ...req, windowSec: 100 }); // sum 60, diff 40
  expect(r).toEqual({
    ok: false,
    code: 'bad_response',
    error: "The draft's shots did not fit the chosen length. Please draft again.",
    usage: { inputTokens: 120, outputTokens: 900 },
  });
});

it('a whole song drafted for a short window is scaled to fit, not refused', async () => {
  // Whole-song lyrics on a 60 s window: Claude paces the shots for the song (sum 135).
  create.mockResolvedValue(toolResponse(board([15, 15, 15, 15], [15, 15, 15, 15, 15])));
  const r = await generateStoryboard({ ...req, windowSec: 60 });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  const d = durations(r);
  expect(d).toHaveLength(9);
  expect(d.reduce((a, b) => a + b, 0)).toBe(60);
  expect(d.every((x) => x >= 6 && x <= 7)).toBe(true);
});

it('scales up too, keeping each shot within 1-15 s', async () => {
  create.mockResolvedValue(toolResponse(board([2, 4], [6, 8])));
  const r = await generateStoryboard({ ...req, windowSec: 50 }); // sum 20
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  const d = durations(r);
  expect(d.reduce((a, b) => a + b, 0)).toBe(50);
  expect(d.every((x) => x >= 1 && x <= 15)).toBe(true);
  expect(d).toEqual([...d].sort((a, b) => a - b)); // the longer shots stay longer
});

it('tells Claude the lyrics may run past the window', async () => {
  create.mockResolvedValue(toolResponse(board([15], [15])));
  await generateStoryboard(req);
  expect(create.mock.calls[0][0].messages[0].content).toMatch(/lyrics may cover more than the window/i);
});

it('system prompt carries the no-text and apolitical rules; user message carries lyrics and ratio', async () => {
  create.mockResolvedValue(toolResponse(board([15], [15])));
  await generateStoryboard(req);
  const [body, opts] = create.mock.calls[0];
  expect(body.system).toBe(SYSTEM_PROMPT);
  expect(body.system).toContain('no text');
  expect(body.system).toContain(
    'Keep everything strictly APOLITICAL — no flags, no regions framed politically, no political movements, parties, or partisan references.'
  );
  expect(body.messages[0].content).toContain(LYRICS);
  expect(body.messages[0].content).toContain('9:16');
  expect(body.tool_choice).toEqual({ type: 'tool', name: 'submit_storyboard' });
  expect(body.model).toBe('claude-sonnet-4-6');
  expect(opts.timeout).toBe(25_000);
});

it('maps a credit-balance 400 to billing', async () => {
  create.mockRejectedValue(Object.assign(new Error('Your credit balance is too low to access the API'), { status: 400 }));
  expect(await generateStoryboard(req)).toMatchObject({ ok: false, code: 'billing' });
});

it.each([
  [401, 'auth'],
  [429, 'rate_limit'],
  [500, 'upstream'],
])('maps status %i to %s', async (status, code) => {
  create.mockRejectedValue(Object.assign(new Error('x'), { status }));
  expect(await generateStoryboard(req)).toMatchObject({ ok: false, code });
});

it('max_tokens stop is bad_response', async () => {
  create.mockResolvedValue(toolResponse(board([15], [15]), { stop_reason: 'max_tokens' }));
  expect(await generateStoryboard(req)).toMatchObject({ ok: false, code: 'bad_response' });
});

it('schema-invalid output is bad_response', async () => {
  create.mockResolvedValue(toolResponse({ characters: [], scenes: [] }));
  expect(await generateStoryboard(req)).toMatchObject({ ok: false, code: 'bad_response' });
});

describe('usage on failure (a received response was billed)', () => {
  const USAGE = { inputTokens: 120, outputTokens: 900 };
  it('schema-invalid carries usage', async () => {
    create.mockResolvedValue(toolResponse({ characters: [], scenes: [] }));
    expect(await generateStoryboard(req)).toMatchObject({ ok: false, code: 'bad_response', usage: USAGE });
  });
  it('max_tokens carries usage', async () => {
    create.mockResolvedValue(toolResponse(board([15], [15]), { stop_reason: 'max_tokens' }));
    expect(await generateStoryboard(req)).toMatchObject({ ok: false, code: 'bad_response', usage: USAGE });
  });
  it('missing tool_use block carries usage', async () => {
    create.mockResolvedValue({ content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn', usage: { input_tokens: 120, output_tokens: 900 } });
    expect(await generateStoryboard(req)).toMatchObject({ ok: false, code: 'bad_response', usage: USAGE });
  });
  it('tiling refusal carries usage', async () => {
    create.mockResolvedValue(toolResponse(board([15, 15], [15, 15])));
    expect(await generateStoryboard({ ...req, windowSec: 100 })).toMatchObject({ ok: false, code: 'bad_response', usage: USAGE });
  });
  it.each([[401], [429], [500]])('status %i has no usage', async (status) => {
    create.mockRejectedValue(Object.assign(new Error('x'), { status }));
    expect(await generateStoryboard(req)).not.toHaveProperty('usage');
  });
  it('not_configured has no usage', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(await generateStoryboard(req)).not.toHaveProperty('usage');
  });
});

it('the client never retries (maxRetries 0): one paid call per job, inside the worker\'s budget', async () => {
  create.mockResolvedValue(toolResponse(board([15], [15])));
  await generateStoryboard(req);
  expect(ctor).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0 }));
});

it('honours options.timeoutMs (the worker passes 150 s); default stays 25 s', async () => {
  create.mockResolvedValue(toolResponse(board([15], [15])));
  await generateStoryboard(req, { timeoutMs: 150_000 });
  expect(create.mock.calls[0][1].timeout).toBe(150_000);
  await generateStoryboard(req);
  expect(create.mock.calls[1][1].timeout).toBe(25_000);
});

it('asks for as many output tokens as the window needs, and for a shot count that fits them', async () => {
  create.mockResolvedValue(toolResponse(board([15], [15])));
  await generateStoryboard({ ...req, windowSec: 30 });
  expect(create.mock.calls[0][0].max_tokens).toBe(6000);
  create.mockClear();
  create.mockResolvedValue(toolResponse(board([15], [15])));
  await generateStoryboard({ ...req, windowSec: 420 }).catch(() => null);
  expect(create.mock.calls[0][0].max_tokens).toBe(20000);
  expect(create.mock.calls[0][0].messages[0].content).toContain('Aim for about 60 shots.');
  expect(SYSTEM_PROMPT).toContain('Keep each visual prompt under 50 words');
});

it('tells the model the story\'s style, and not to repeat it in every prompt', async () => {
  create.mockResolvedValue(toolResponse(board([15], [15])));
  await generateStoryboard({ ...req, style: 'hand-painted watercolour' });
  const msg = create.mock.calls[0][0].messages[0].content as string;
  expect(msg).toContain('Visual style for every shot: hand-painted watercolour');
  expect(msg).toContain('added to every shot automatically');
  create.mockClear();
  create.mockResolvedValue(toolResponse(board([15], [15])));
  await generateStoryboard(req);
  expect(create.mock.calls[0][0].messages[0].content).not.toContain('Visual style');
});
