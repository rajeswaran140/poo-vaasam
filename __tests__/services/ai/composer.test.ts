/** @jest-environment node */
/**
 * Tests for src/services/ai/composer.ts — env-gate, happy-path parse,
 * markdown-fence tolerance, partial-response defaults, upstream failure.
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

const SAMPLE = {
  emotion: 'காதல்',
  mood: 'Tender and reflective',
  theme: 'Longing',
  suggested_key: 'D Minor',
  suggested_bpm: 72,
  suggested_instruments: ['Veena', 'Flute', 'Tabla', 'Strings'],
  song_titles: ['இரவின் அன்பு', 'நிலவின் நிழல்', 'காதல் மழை'],
  suno_prompt: 'Slow Tamil ballad in D minor at 72 BPM, lead Veena over warm strings and gentle tabla, intimate and reflective.',
  youtube_description: 'A tender Tamil love song.\n\n#tamilsong #tamilagaval',
};

const claudeResponse = (text: string) => ({
  content: [{ type: 'text', text }],
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

it('parses a clean JSON response into the structured shape', async () => {
  create.mockResolvedValueOnce(claudeResponse(JSON.stringify(SAMPLE)));
  const r = await composeFromLyrics('காதல் வரிகள்');
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.data.emotion).toBe('காதல்');
    expect(r.data.suggested_bpm).toBe(72);
    expect(r.data.song_titles).toHaveLength(3);
    expect(r.data.suggested_instruments[0]).toBe('Veena');
  }
});

it('requests enough max_tokens headroom for the full Brief v2 (avoids mid-JSON truncation)', async () => {
  create.mockResolvedValueOnce(claudeResponse(JSON.stringify(SAMPLE)));
  await composeFromLyrics('காதல் வரிகள்');
  expect(create).toHaveBeenCalledTimes(1);
  const args = create.mock.calls[0][0] as { max_tokens: number };
  expect(args.max_tokens).toBeGreaterThanOrEqual(4096);
});

it('strips a ```json fence when Claude wraps the output', async () => {
  create.mockResolvedValueOnce(claudeResponse('```json\n' + JSON.stringify(SAMPLE) + '\n```'));
  const r = await composeFromLyrics('lyrics');
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.data.theme).toBe('Longing');
});

it('fills sensible defaults when the response is partial', async () => {
  create.mockResolvedValueOnce(claudeResponse(JSON.stringify({
    emotion: 'அன்னை',
    suggested_instruments: ['Flute'],
    // BPM missing → defaults to 90; titles missing → []
  })));
  const r = await composeFromLyrics('lyrics');
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.data.emotion).toBe('அன்னை');
    expect(r.data.suggested_bpm).toBe(90);
    expect(r.data.song_titles).toEqual([]);
    expect(r.data.suggested_instruments).toEqual(['Flute']);
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

it('returns { ok: false } when JSON is unparseable', async () => {
  create.mockResolvedValueOnce(claudeResponse('not json at all'));
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const r = await composeFromLyrics('lyrics');
  expect(r.ok).toBe(false);
});
