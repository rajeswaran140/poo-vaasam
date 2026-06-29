/** @jest-environment node */
/**
 * Tests for src/services/ai/lyricCritic.ts — env-gate, input validation,
 * tool-enforced JSON, schema validation (no silent fabrication), truncation
 * detection, abort-signal forwarding, the "feedback not rewrite" + apolitical
 * system rules, prompt threading, and upstream error mapping.
 */

const create = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create },
  })),
}));

import { critiqueLyric } from '@/services/ai/lyricCritic';

const FAKE_KEY = 'sk-ant-test-key';
const originalEnv = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  create.mockReset();
  process.env.ANTHROPIC_API_KEY = FAKE_KEY;
});

afterAll(() => {
  process.env.ANTHROPIC_API_KEY = originalEnv;
});

const INPUT = {
  lyrics: 'பல்லவி\nஊருக்குப் போகணும்\nமண்ணை தொடணும்',
  focus: ['meter', 'imagery'] as const,
  notes: 'Does the pallavi carry?',
};

// A complete, schema-valid critique.
const CRITIQUE = {
  overall: 'A tender pallavi; the charanam loses the thread.',
  strengths: ['The மண்வாசம் image is concrete and earned'],
  observations: [{ aspect: 'meter', note: 'Line 3 runs a beat long against lines 1-2' }],
  slackLines: [{ line: 'மண்ணை தொடணும்', issue: 'abstract where the rest of the verse is concrete' }],
  wordIdeas: [{ instead_of: 'அழகு', consider: ['எழில்', 'சாயல்'], why: 'less generic, period-appropriate' }],
  questions: ['Whose voice is the charanam in — the exile or the land?'],
};

// A Claude response that answers via the forced `submit_critique` tool.
const toolResponse = (input: unknown, extra: Record<string, unknown> = {}) => ({
  content: [{ type: 'tool_use', name: 'submit_critique', input }],
  stop_reason: 'tool_use',
  usage: { input_tokens: 120, output_tokens: 300 },
  ...extra,
});

it('returns not_configured when ANTHROPIC_API_KEY is missing', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const r = await critiqueLyric(INPUT);
  expect(r).toMatchObject({ ok: false, code: 'not_configured' });
  expect(create).not.toHaveBeenCalled();
});

it('rejects empty lyrics as invalid_input (no upstream call)', async () => {
  const r = await critiqueLyric({ lyrics: '   ' });
  expect(r).toMatchObject({ ok: false, code: 'invalid_input' });
  expect(create).not.toHaveBeenCalled();
});

it('rejects an oversized draft as invalid_input', async () => {
  const r = await critiqueLyric({ lyrics: 'அ'.repeat(8001) });
  expect(r).toMatchObject({ ok: false, code: 'invalid_input' });
  expect(create).not.toHaveBeenCalled();
});

it('parses a valid tool_use response into the structured critique', async () => {
  create.mockResolvedValueOnce(toolResponse(CRITIQUE));
  const r = await critiqueLyric(INPUT);
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.data.overall).toMatch(/tender pallavi/);
    expect(r.data.strengths).toHaveLength(1);
    expect(r.data.observations[0].aspect).toBe('meter');
    expect(r.data.slackLines[0].line).toBe('மண்ணை தொடணும்'); // verbatim line, not a rewrite
    expect(r.data.wordIdeas[0].consider).toEqual(['எழில்', 'சாயல்']);
    expect(r.data.questions).toHaveLength(1);
  }
});

it('accepts a sparse critique — empty lists are well-formed (only overall required)', async () => {
  create.mockResolvedValueOnce(toolResponse({ overall: 'Solid throughout; nothing to flag.' }));
  const r = await critiqueLyric(INPUT);
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.data.strengths).toEqual([]);
    expect(r.data.slackLines).toEqual([]);
  }
});

it('forces tool use, an analytical temperature, and headroom', async () => {
  create.mockResolvedValueOnce(toolResponse(CRITIQUE));
  await critiqueLyric(INPUT);
  expect(create).toHaveBeenCalledTimes(1);
  const args = create.mock.calls[0][0] as {
    max_tokens: number;
    temperature: number;
    tools: Array<{ name: string; input_schema: unknown }>;
    tool_choice: { type: string; name: string };
  };
  expect(args.max_tokens).toBeGreaterThanOrEqual(2048);
  expect(args.temperature).toBeLessThanOrEqual(0.5); // analytical, not generative
  expect(args.tool_choice).toEqual({ type: 'tool', name: 'submit_critique' });
  expect(args.tools[0].name).toBe('submit_critique');
  expect(args.tools[0].input_schema).toMatchObject({ type: 'object' });
});

it('threads the draft, focus, and notes into the user message', async () => {
  create.mockResolvedValueOnce(toolResponse(CRITIQUE));
  await critiqueLyric(INPUT);
  const content = (create.mock.calls[0][0] as { messages: Array<{ content: string }> }).messages[0].content;
  expect(content).toContain('ஊருக்குப் போகணும்'); // the draft
  expect(content).toContain('meter'); // focus
  expect(content).toContain('Does the pallavi carry?'); // notes
});

it('injects the personal lexicon and tells the model to prefer it for word ideas', async () => {
  create.mockResolvedValueOnce(toolResponse(CRITIQUE));
  await critiqueLyric(INPUT, { lexicon: ['எழில் — beauty [sangam]', 'நிலா [literary]'] });
  const content = (create.mock.calls[0][0] as { messages: Array<{ content: string }> }).messages[0].content;
  expect(content).toContain('எழில் — beauty [sangam]'); // the poet's own words are in the prompt
  expect(content).toMatch(/prefer words from this lexicon/i);
});

it('omits the lexicon section entirely when none is provided', async () => {
  create.mockResolvedValueOnce(toolResponse(CRITIQUE));
  await critiqueLyric(INPUT);
  const content = (create.mock.calls[0][0] as { messages: Array<{ content: string }> }).messages[0].content;
  expect(content).not.toMatch(/personal lexicon/i);
});

it('instructs feedback-not-rewrite and stays apolitical in the system rule', async () => {
  create.mockResolvedValueOnce(toolResponse(CRITIQUE));
  await critiqueLyric(INPUT);
  const sys = (create.mock.calls[0][0] as { system: string }).system.toLowerCase();
  expect(sys).toContain('apolitical');
  expect(sys).toMatch(/never a rewrite|do not supply replacement|not a ghostwriter/);
});

it('forwards the abort signal to the Anthropic call', async () => {
  create.mockResolvedValueOnce(toolResponse(CRITIQUE));
  const ac = new AbortController();
  await critiqueLyric(INPUT, { signal: ac.signal });
  const opts = create.mock.calls[0][1] as { signal?: AbortSignal };
  expect(opts.signal).toBe(ac.signal);
});

it('honours a model override', async () => {
  create.mockResolvedValueOnce(toolResponse(CRITIQUE));
  await critiqueLyric(INPUT, { model: 'claude-haiku-4-5-20251001' });
  expect((create.mock.calls[0][0] as { model: string }).model).toBe('claude-haiku-4-5-20251001');
});

it('returns bad_response when the model answers with prose instead of the tool', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  create.mockResolvedValueOnce({ content: [{ type: 'text', text: 'here is my feedback…' }], stop_reason: 'end_turn', usage: { output_tokens: 50 } });
  const r = await critiqueLyric(INPUT);
  expect(r).toMatchObject({ ok: false, code: 'bad_response' });
});

it('does NOT fabricate — an empty overall is a bad_response', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  create.mockResolvedValueOnce(toolResponse({ ...CRITIQUE, overall: '' }));
  const r = await critiqueLyric(INPUT);
  expect(r).toMatchObject({ ok: false, code: 'bad_response' });
});

it('detects a max_tokens truncation as a distinct bad_response', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  create.mockResolvedValueOnce(toolResponse(CRITIQUE, { stop_reason: 'max_tokens' }));
  const r = await critiqueLyric(INPUT);
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.code).toBe('bad_response');
    expect(r.error).toMatch(/cut off|too long/i);
  }
});

it('maps a generic upstream error to a clean message without leaking raw text', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  create.mockRejectedValueOnce(new Error('socket hang up: internal-host:443'));
  const r = await critiqueLyric(INPUT);
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.code).toBe('upstream');
    expect(r.error).not.toMatch(/internal-host/);
  }
});

it('classifies a 401 as an auth error and hides the raw x-api-key message', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  create.mockRejectedValueOnce(Object.assign(new Error('401 {"error":"invalid x-api-key"}'), { status: 401 }));
  const r = await critiqueLyric(INPUT);
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.code).toBe('auth');
    expect(r.error).not.toMatch(/x-api-key/);
  }
});

it('classifies a 429 as a rate-limit error', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  create.mockRejectedValueOnce(Object.assign(new Error('429 too many requests'), { status: 429 }));
  const r = await critiqueLyric(INPUT);
  expect(r).toMatchObject({ ok: false, code: 'rate_limit' });
});
