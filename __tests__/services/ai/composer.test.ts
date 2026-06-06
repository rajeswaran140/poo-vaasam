/** @jest-environment node */
/**
 * Tests for src/services/ai/composer.ts — env-gate, tool-enforced JSON,
 * schema validation (no silent semantic defaults), bpm clamp, reel default,
 * truncation detection, abort-signal forwarding, and upstream error mapping.
 */

const create = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create },
  })),
}));

import { composeFromLyrics } from '@/services/ai/composer';

const FAKE_KEY = 'sk-ant-test-key';
const originalEnv = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  create.mockReset();
  process.env.ANTHROPIC_API_KEY = FAKE_KEY;
});

afterAll(() => {
  process.env.ANTHROPIC_API_KEY = originalEnv;
});

// A complete, schema-valid brief.
const SAMPLE = {
  emotion: 'காதல்',
  emotion_breakdown: ['காதல்', 'ஏக்கம்'],
  mood: 'Tender and reflective',
  theme: 'Longing',
  suggested_key: 'D Minor',
  suggested_bpm: 72,
  suggested_instruments: ['Veena', 'Flute', 'Tabla', 'Strings'],
  suggested_ragas: ['Keeravani', 'Sahana'],
  recommended_voice: ['Female Adult', 'Male Tenor'],
  song_titles: ['இரவின் அன்பு', 'நிலவின் நிழல்', 'காதல் மழை'],
  suno_prompts: [{ style: 'Tamil film ballad', prompt: 'Slow Tamil ballad in D minor at 72 BPM, lead Veena over warm strings.' }],
  thumbnail_prompt: 'Cinematic moonlit Tamil courtyard at golden hour.',
  youtube_description_tamil: 'ஒரு மென்மையான காதல் பாடல். #tamilagaval',
  youtube_description_english: 'A tender Tamil love song. #tamilagaval',
  reel: { hook: 'நிலவே', caption: 'A love song', hashtags: ['#tamil', '#shorts'] },
};

// A Claude response that answers via the forced `submit_brief` tool.
const toolResponse = (input: unknown, extra: Record<string, unknown> = {}) => ({
  content: [{ type: 'tool_use', name: 'submit_brief', input }],
  stop_reason: 'tool_use',
  usage: { input_tokens: 120, output_tokens: 1200 },
  ...extra,
});

it('returns { ok: false } when ANTHROPIC_API_KEY is missing', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const r = await composeFromLyrics('any');
  expect(r).toMatchObject({ ok: false, code: 'not_configured', error: expect.stringMatching(/not configured|missing/i) });
  expect(create).not.toHaveBeenCalled();
});

it('rejects empty lyrics with { ok: false }', async () => {
  const r = await composeFromLyrics('   ');
  expect(r.ok).toBe(false);
  expect(create).not.toHaveBeenCalled();
});

it('rejects lyrics over the size cap', async () => {
  const r = await composeFromLyrics('x'.repeat(8001));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toMatch(/exceed/);
  expect(create).not.toHaveBeenCalled();
});

it('parses a valid tool_use response into the structured shape', async () => {
  create.mockResolvedValueOnce(toolResponse(SAMPLE));
  const r = await composeFromLyrics('காதல் வரிகள்');
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.data.emotion).toBe('காதல்');
    expect(r.data.suggested_bpm).toBe(72);
    expect(r.data.song_titles).toHaveLength(3);
    expect(r.data.suggested_instruments[0]).toBe('Veena');
    expect(r.data.suno_prompts[0].style).toBe('Tamil film ballad');
    expect(r.data.youtube_description_english).toMatch(/#tamilagaval/);
  }
});

it('grounds instruments & ragas against the catalog (drops off-catalog "Strings")', async () => {
  create.mockResolvedValueOnce(toolResponse(SAMPLE));
  const r = await composeFromLyrics('lyrics');
  expect(r.ok).toBe(true);
  if (r.ok) {
    // 'Strings' is not a catalog instrument → dropped; the rest canonicalised.
    expect(r.data.suggested_instruments).toEqual(['Veena', 'Flute', 'Tabla']);
    expect(r.data.suggested_ragas).toEqual(['Keeravani', 'Sahana']);
  }
});

it('canonicalises misspelled instruments/ragas to their official names', async () => {
  create.mockResolvedValueOnce(
    toolResponse({ ...SAMPLE, suggested_instruments: ['mrudangam', 'bansuri'], suggested_ragas: ['mohana', 'kirwani'] })
  );
  const r = await composeFromLyrics('lyrics');
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.data.suggested_instruments).toEqual(['Mridangam', 'Flute']);
    expect(r.data.suggested_ragas).toEqual(['Mohanam', 'Keeravani']);
  }
});

it('injects the instrument & raga palettes into the system prompt', async () => {
  create.mockResolvedValueOnce(toolResponse(SAMPLE));
  await composeFromLyrics('lyrics');
  const sys = (create.mock.calls[0][0] as { system: string }).system;
  expect(sys).toContain('Mridangam'); // instrument palette
  expect(sys).toContain('Mohanam');   // raga palette
});

it('threads the chosen raga + key/scale into a SUNO prompt that omits it', async () => {
  // SAMPLE's prompt names Veena (an instrument) but no raga → raga + key appended.
  create.mockResolvedValueOnce(toolResponse(SAMPLE));
  const r = await composeFromLyrics('lyrics');
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.data.suno_prompts[0].prompt).toMatch(/raga Keeravani/i);
    expect(r.data.suno_prompts[0].prompt).toMatch(/harmonic minor/i); // raga-derived scale
  }
});

it('enriches suggested_key into a key+scale derived from the lead raga', async () => {
  // SAMPLE: suggested_key "D Minor", lead raga Keeravani (harmonic minor).
  create.mockResolvedValueOnce(toolResponse(SAMPLE));
  const r = await composeFromLyrics('lyrics');
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.data.suggested_key).toBe('D harmonic minor');
});

it('appends both instruments and raga when a SUNO prompt names neither', async () => {
  create.mockResolvedValueOnce(
    toolResponse({ ...SAMPLE, suno_prompts: [{ style: 'Modern', prompt: 'Upbeat modern pop track.' }] })
  );
  const r = await composeFromLyrics('lyrics');
  expect(r.ok).toBe(true);
  if (r.ok) {
    const p = r.data.suno_prompts[0].prompt;
    expect(p).toMatch(/featuring Veena/i);  // grounded lead instruments
    expect(p).toMatch(/raga Keeravani/i);   // grounded lead raga
  }
});

it('leaves a SUNO prompt untouched when it already names instruments, raga, and scale', async () => {
  const prompt = 'Devotional piece on Veena in D harmonic minor, set in raga Keeravani, with gentle tabla.';
  create.mockResolvedValueOnce(
    toolResponse({ ...SAMPLE, suno_prompts: [{ style: 'Devotional', prompt }] })
  );
  const r = await composeFromLyrics('lyrics');
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.data.suno_prompts[0].prompt).toBe(prompt);
});

it('forces tool use, low temperature, and enough max_tokens headroom', async () => {
  create.mockResolvedValueOnce(toolResponse(SAMPLE));
  await composeFromLyrics('காதல் வரிகள்');
  expect(create).toHaveBeenCalledTimes(1);
  const args = create.mock.calls[0][0] as {
    max_tokens: number;
    temperature: number;
    tools: Array<{ name: string; input_schema: unknown }>;
    tool_choice: { type: string; name: string };
  };
  expect(args.max_tokens).toBeGreaterThanOrEqual(4096);
  expect(args.temperature).toBeLessThan(1);
  expect(args.tool_choice).toEqual({ type: 'tool', name: 'submit_brief' });
  expect(args.tools[0].name).toBe('submit_brief');
  expect(args.tools[0].input_schema).toMatchObject({ type: 'object' });
});

it('forwards the abort signal to the Anthropic call (cancellable on disconnect)', async () => {
  create.mockResolvedValueOnce(toolResponse(SAMPLE));
  const ac = new AbortController();
  await composeFromLyrics('lyrics', { signal: ac.signal });
  const opts = create.mock.calls[0][1] as { signal?: AbortSignal };
  expect(opts.signal).toBe(ac.signal);
});

it('honours a model override (e.g. Haiku fallback)', async () => {
  create.mockResolvedValueOnce(toolResponse(SAMPLE));
  await composeFromLyrics('lyrics', { model: 'claude-haiku-4-5-20251001' });
  expect((create.mock.calls[0][0] as { model: string }).model).toBe('claude-haiku-4-5-20251001');
});

it('clamps an out-of-range BPM instead of rejecting the whole brief', async () => {
  create.mockResolvedValueOnce(toolResponse({ ...SAMPLE, suggested_bpm: 5000 }));
  const r = await composeFromLyrics('lyrics');
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.data.suggested_bpm).toBe(90); // .catch(90) fallback
});

it('defaults a missing reel to a well-formed empty idea', async () => {
  const { reel: _omit, ...noReel } = SAMPLE;
  create.mockResolvedValueOnce(toolResponse(noReel));
  const r = await composeFromLyrics('lyrics');
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.data.reel).toEqual({ hook: '', caption: '', hashtags: [] });
});

it('does NOT fabricate semantic fields — an incomplete brief is a bad_response', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  // `theme` (required) is missing → must fail, not silently default.
  const { theme: _omit, ...partial } = SAMPLE;
  create.mockResolvedValueOnce(toolResponse(partial));
  const r = await composeFromLyrics('lyrics');
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.code).toBe('bad_response');
});

it('rejects an empty required array (e.g. no SUNO prompts) as bad_response', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  create.mockResolvedValueOnce(toolResponse({ ...SAMPLE, suno_prompts: [] }));
  const r = await composeFromLyrics('lyrics');
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.code).toBe('bad_response');
});

it('returns bad_response when the model answers with prose instead of the tool', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  create.mockResolvedValueOnce({ content: [{ type: 'text', text: 'here is your brief...' }], stop_reason: 'end_turn', usage: { output_tokens: 50 } });
  const r = await composeFromLyrics('lyrics');
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.code).toBe('bad_response');
});

it('detects a max_tokens truncation as a distinct bad_response', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  create.mockResolvedValueOnce(toolResponse(SAMPLE, { stop_reason: 'max_tokens' }));
  const r = await composeFromLyrics('lyrics');
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.code).toBe('bad_response');
    expect(r.error).toMatch(/cut off|too long/i);
  }
});

it('maps a generic upstream error to a clean message without leaking raw text', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  create.mockRejectedValueOnce(new Error('socket hang up: internal-host:443'));
  const r = await composeFromLyrics('lyrics');
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.code).toBe('upstream');
    expect(r.error).not.toMatch(/internal-host/); // raw upstream detail stays server-side
  }
});

it('classifies a 401 as an auth error and hides the raw x-api-key message', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  create.mockRejectedValueOnce(Object.assign(new Error('401 {"error":"invalid x-api-key"}'), { status: 401 }));
  const r = await composeFromLyrics('lyrics');
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.code).toBe('auth');
    expect(r.error).not.toMatch(/x-api-key/);
  }
});

it('classifies a 429 as a rate-limit error', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  create.mockRejectedValueOnce(Object.assign(new Error('429 too many requests'), { status: 429 }));
  const r = await composeFromLyrics('lyrics');
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.code).toBe('rate_limit');
});
