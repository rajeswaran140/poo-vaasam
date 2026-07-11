/** @jest-environment node */
/**
 * Tests for src/services/ai/lyricist.ts — env-gate, brief validation,
 * tool-enforced JSON, schema validation (no silent fabrication), the
 * anupallavi structure guard, truncation detection, abort-signal forwarding,
 * the apolitical system rule, and upstream error mapping.
 */

const create = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create },
  })),
}));

import { generateLyrics, DEFAULT_MODEL } from '@/services/ai/lyricist';

it('defaults to Sonnet 4.6 — 4.5 mis-serialises the doubly-nested charanams schema', () => {
  // Regression guard: charanams is string[][]; 4.5 wraps nested-array tool args
  // as <parameter> strings that fail Zod validation (same reason critic/composer
  // run on 4.6). Do not downgrade.
  expect(DEFAULT_MODEL).toBe('claude-sonnet-4-6');
});

const FAKE_KEY = 'sk-ant-test-key';
const originalEnv = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  create.mockReset();
  process.env.ANTHROPIC_API_KEY = FAKE_KEY;
});

afterAll(() => {
  process.env.ANTHROPIC_API_KEY = originalEnv;
});

const BRIEF = {
  theme: 'Homeland nostalgia',
  emotions: ['ஏக்கம்', 'நினைவு'],
  register: 'village' as const,
  structure: { anupallavi: true, charanams: 2 },
  seedWords: ['மண்வாசம்'],
};

// A complete, schema-valid lyric.
const LYRICS = {
  title: 'ஊருக்குப் போகணும்',
  pallavi: ['ஊருக்குப் போகணும்', 'மண்ணை தொடணும்'],
  anupallavi: ['காற்றில் கதை கேட்கணும்'],
  charanams: [
    ['வயல் வரப்பினில்', 'நடந்து போகணும்'],
    ['குளத்தங் கரையினில்', 'அமர்ந்திருக்கணும்'],
  ],
  notes: 'pastoral imagery',
};

// A Claude response that answers via the forced `submit_lyrics` tool.
const toolResponse = (input: unknown, extra: Record<string, unknown> = {}) => ({
  content: [{ type: 'tool_use', name: 'submit_lyrics', input }],
  stop_reason: 'tool_use',
  usage: { input_tokens: 80, output_tokens: 400 },
  ...extra,
});

it('returns not_configured when ANTHROPIC_API_KEY is missing', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const r = await generateLyrics(BRIEF);
  expect(r).toMatchObject({ ok: false, code: 'not_configured' });
  expect(create).not.toHaveBeenCalled();
});

it('rejects a brief with no theme as invalid_brief (no upstream call)', async () => {
  const r = await generateLyrics({ theme: '   ', emotions: ['அன்பு'] });
  expect(r).toMatchObject({ ok: false, code: 'invalid_brief' });
  expect(create).not.toHaveBeenCalled();
});

it('rejects a brief with no emotions as invalid_brief', async () => {
  const r = await generateLyrics({ theme: 'Love', emotions: [] });
  expect(r).toMatchObject({ ok: false, code: 'invalid_brief' });
  expect(create).not.toHaveBeenCalled();
});

it('parses a valid tool_use response into the structured lyric', async () => {
  create.mockResolvedValueOnce(toolResponse(LYRICS));
  const r = await generateLyrics(BRIEF);
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.data.title).toBe('ஊருக்குப் போகணும்');
    expect(r.data.pallavi).toHaveLength(2);
    expect(r.data.charanams).toHaveLength(2);
    expect(r.data.charanams[0][0]).toBe('வயல் வரப்பினில்');
    expect(r.data.anupallavi).toEqual(['காற்றில் கதை கேட்கணும்']);
  }
});

it('drops a volunteered anupallavi when the brief did not request one', async () => {
  create.mockResolvedValueOnce(toolResponse(LYRICS)); // model returns an anupallavi…
  const r = await generateLyrics({ ...BRIEF, structure: { anupallavi: false, charanams: 2 } });
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.data.anupallavi).toEqual([]); // …but it's dropped — requested shape wins
});

it('keeps the anupallavi when the brief requested one', async () => {
  create.mockResolvedValueOnce(toolResponse(LYRICS));
  const r = await generateLyrics({ ...BRIEF, structure: { anupallavi: true, charanams: 2 } });
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.data.anupallavi).toHaveLength(1);
});

it('trims charanams beyond the requested count (upper-bound structure guard)', async () => {
  // Brief asks for 2; model over-produces 3 → trimmed to the first 2.
  const threeCharanams = { ...LYRICS, charanams: [['a'], ['b'], ['c']] };
  create.mockResolvedValueOnce(toolResponse(threeCharanams));
  const r = await generateLyrics({ ...BRIEF, structure: { anupallavi: true, charanams: 2 } });
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.data.charanams).toHaveLength(2);
    expect(r.data.charanams).toEqual([['a'], ['b']]);
  }
});

it('does not pad when the model under-produces charanams (no fabrication)', async () => {
  // Brief asks for 3; model returns 2 → accepted as-is (admin reviews), not faked up.
  create.mockResolvedValueOnce(toolResponse({ ...LYRICS, charanams: [['a'], ['b']] }));
  const r = await generateLyrics({ ...BRIEF, structure: { anupallavi: true, charanams: 3 } });
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.data.charanams).toHaveLength(2);
});

it('rejects an oversized emotion string as invalid_brief (per-item length bound)', async () => {
  const r = await generateLyrics({ theme: 'Love', emotions: ['அ'.repeat(61)] });
  expect(r).toMatchObject({ ok: false, code: 'invalid_brief' });
  expect(create).not.toHaveBeenCalled();
});

it('forces tool use, a creative temperature, and headroom', async () => {
  create.mockResolvedValueOnce(toolResponse(LYRICS));
  await generateLyrics(BRIEF);
  expect(create).toHaveBeenCalledTimes(1);
  const args = create.mock.calls[0][0] as {
    max_tokens: number;
    temperature: number;
    tools: Array<{ name: string; input_schema: unknown }>;
    tool_choice: { type: string; name: string };
  };
  expect(args.max_tokens).toBeGreaterThanOrEqual(2048);
  expect(args.temperature).toBeGreaterThan(0.6); // creative, not extraction
  expect(args.temperature).toBeLessThanOrEqual(1);
  expect(args.tool_choice).toEqual({ type: 'tool', name: 'submit_lyrics' });
  expect(args.tools[0].name).toBe('submit_lyrics');
  expect(args.tools[0].input_schema).toMatchObject({ type: 'object' });
});

it('threads the brief (theme, emotions, seed words) into the user message', async () => {
  create.mockResolvedValueOnce(toolResponse(LYRICS));
  await generateLyrics(BRIEF);
  const content = (create.mock.calls[0][0] as { messages: Array<{ content: string }> }).messages[0].content;
  expect(content).toContain('Homeland nostalgia');
  expect(content).toContain('ஏக்கம்');
  expect(content).toContain('மண்வாசம்'); // seed word
});

it('keeps the system rule strictly apolitical', async () => {
  create.mockResolvedValueOnce(toolResponse(LYRICS));
  await generateLyrics(BRIEF);
  const sys = (create.mock.calls[0][0] as { system: string }).system;
  expect(sys.toLowerCase()).toContain('apolitical');
});

it('instructs the model to write a SONG (a returning hook, not a narrative) with meter and Tamil sound-play', async () => {
  // Craft guard: the output was reading like a linear story. The prompt must
  // steer song-craft — a recurring hook/refrain, non-sequential charanams,
  // even meter, and எதுகை/மோனை binding — not plot progression.
  create.mockResolvedValueOnce(toolResponse(LYRICS));
  await generateLyrics(BRIEF);
  const sys = (create.mock.calls[0][0] as { system: string }).system.toLowerCase();
  expect(sys).toContain('hook');
  expect(sys).toContain('refrain');
  expect(sys).toContain('not a story');
  expect(sys).toMatch(/எதுகை|மோனை/); // Tamil sound devices (case-fold is a no-op on Tamil)
  expect(sys).toMatch(/meter|சந்தம்/);
});

it('forwards the abort signal to the Anthropic call', async () => {
  create.mockResolvedValueOnce(toolResponse(LYRICS));
  const ac = new AbortController();
  await generateLyrics(BRIEF, { signal: ac.signal });
  const opts = create.mock.calls[0][1] as { signal?: AbortSignal };
  expect(opts.signal).toBe(ac.signal);
});

it('honours a model override', async () => {
  create.mockResolvedValueOnce(toolResponse(LYRICS));
  await generateLyrics(BRIEF, { model: 'claude-haiku-4-5-20251001' });
  expect((create.mock.calls[0][0] as { model: string }).model).toBe('claude-haiku-4-5-20251001');
});

it('returns bad_response when the model answers with prose instead of the tool', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  create.mockResolvedValueOnce({ content: [{ type: 'text', text: 'here are your lyrics…' }], stop_reason: 'end_turn', usage: { output_tokens: 50 } });
  const r = await generateLyrics(BRIEF);
  expect(r).toMatchObject({ ok: false, code: 'bad_response' });
});

it('does NOT fabricate — an empty pallavi is a bad_response', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  create.mockResolvedValueOnce(toolResponse({ ...LYRICS, pallavi: [] }));
  const r = await generateLyrics(BRIEF);
  expect(r).toMatchObject({ ok: false, code: 'bad_response' });
});

it('rejects a lyric with no charanams as bad_response', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  create.mockResolvedValueOnce(toolResponse({ ...LYRICS, charanams: [] }));
  const r = await generateLyrics(BRIEF);
  expect(r).toMatchObject({ ok: false, code: 'bad_response' });
});

it('detects a max_tokens truncation as a distinct bad_response', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  create.mockResolvedValueOnce(toolResponse(LYRICS, { stop_reason: 'max_tokens' }));
  const r = await generateLyrics(BRIEF);
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.code).toBe('bad_response');
    expect(r.error).toMatch(/cut off|too long/i);
  }
});

it('maps a generic upstream error to a clean message without leaking raw text', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  create.mockRejectedValueOnce(new Error('socket hang up: internal-host:443'));
  const r = await generateLyrics(BRIEF);
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.code).toBe('upstream');
    expect(r.error).not.toMatch(/internal-host/);
  }
});

it('classifies a 401 as an auth error and hides the raw x-api-key message', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  create.mockRejectedValueOnce(Object.assign(new Error('401 {"error":"invalid x-api-key"}'), { status: 401 }));
  const r = await generateLyrics(BRIEF);
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.code).toBe('auth');
    expect(r.error).not.toMatch(/x-api-key/);
  }
});

it('classifies a 429 as a rate-limit error', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  create.mockRejectedValueOnce(Object.assign(new Error('429 too many requests'), { status: 429 }));
  const r = await generateLyrics(BRIEF);
  expect(r).toMatchObject({ ok: false, code: 'rate_limit' });
});
