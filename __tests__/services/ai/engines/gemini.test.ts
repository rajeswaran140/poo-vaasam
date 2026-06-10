/** @jest-environment node */
/**
 * Tests for the Gemini composer engine — structured-output call, raw JSON
 * extraction, MAX_TOKENS + empty + unparseable → bad_response, key/quota error
 * classification, abort-signal forwarding, default + override model.
 */

const generateContent = jest.fn();
jest.mock('@google/genai', () => ({
  __esModule: true,
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent },
  })),
  FinishReason: { STOP: 'STOP', MAX_TOKENS: 'MAX_TOKENS' },
}));

import { GoogleGenAI } from '@google/genai';
import { GeminiComposerEngine, DEFAULT_GEMINI_MODEL } from '@/services/ai/engines/gemini';
import type { BriefRequest } from '@/services/ai/engines/types';

const FAKE_KEY = 'gemini-test-key';
const originalKey = process.env.GEMINI_API_KEY;
const originalModel = process.env.GEMINI_MODEL;

beforeEach(() => {
  generateContent.mockReset();
  (GoogleGenAI as jest.Mock).mockClear();
  process.env.GEMINI_API_KEY = FAKE_KEY;
  delete process.env.GEMINI_MODEL;
});

afterAll(() => {
  process.env.GEMINI_API_KEY = originalKey;
  if (originalModel === undefined) delete process.env.GEMINI_MODEL;
  else process.env.GEMINI_MODEL = originalModel;
});

const REQ: BriefRequest = {
  system: 'SYSTEM PROMPT',
  lyrics: 'காதல் வரிகள்',
  jsonSchema: { type: 'object', properties: { emotion: { type: 'string', minLength: 1 } }, required: ['emotion'] },
  toolName: 'submit_brief',
  maxOutputTokens: 6000,
  temperature: 0.4,
  timeoutMs: 60_000,
};

const jsonResponse = (obj: unknown, extra: Record<string, unknown> = {}) => ({
  text: JSON.stringify(obj),
  candidates: [{ finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 900 },
  ...extra,
});

it('reports not_configured (and never calls the SDK) when the key is missing', async () => {
  delete process.env.GEMINI_API_KEY;
  const engine = new GeminiComposerEngine();
  expect(engine.isConfigured()).toBe(false);
  const r = await engine.generateBrief(REQ);
  expect(r).toMatchObject({ ok: false, code: 'not_configured' });
  expect(generateContent).not.toHaveBeenCalled();
});

it('parses a valid JSON response into raw + usage', async () => {
  generateContent.mockResolvedValueOnce(jsonResponse({ emotion: 'காதல்' }));
  const r = await new GeminiComposerEngine().generateBrief(REQ);
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.raw).toEqual({ emotion: 'காதல்' });
    expect(r.usage).toEqual({ inputTokens: 100, outputTokens: 900 });
    expect(r.stopReason).toBe('STOP');
  }
});

it('sends structured-output config with the sanitized (uppercased) schema', async () => {
  generateContent.mockResolvedValueOnce(jsonResponse({ emotion: 'காதல்' }));
  await new GeminiComposerEngine().generateBrief(REQ);
  const arg = generateContent.mock.calls[0][0];
  expect(arg.model).toBe(DEFAULT_GEMINI_MODEL);
  expect(arg.contents).toBe('காதல் வரிகள்');
  expect(arg.config.systemInstruction).toBe('SYSTEM PROMPT');
  expect(arg.config.responseMimeType).toBe('application/json');
  expect(arg.config.temperature).toBe(0.4);
  expect(arg.config.maxOutputTokens).toBe(6000);
  // Schema is sanitized for Gemini (types uppercased, minLength stripped).
  expect(arg.config.responseSchema.type).toBe('OBJECT');
  expect(arg.config.responseSchema.properties.emotion).toEqual({ type: 'STRING' });
});

it('defaults to gemini-2.5-flash, respects GEMINI_MODEL, and honours an override', async () => {
  expect(new GeminiComposerEngine().model).toBe('gemini-2.5-flash');
  process.env.GEMINI_MODEL = 'gemini-2.0-flash';
  expect(new GeminiComposerEngine().model).toBe('gemini-2.0-flash');
  expect(new GeminiComposerEngine('gemini-1.5-flash').model).toBe('gemini-1.5-flash');
});

it('forwards the abort signal to the SDK call', async () => {
  generateContent.mockResolvedValueOnce(jsonResponse({ emotion: 'x' }));
  const ac = new AbortController();
  await new GeminiComposerEngine().generateBrief({ ...REQ, signal: ac.signal });
  expect(generateContent.mock.calls[0][0].config.abortSignal).toBe(ac.signal);
});

it('classifies a MAX_TOKENS finish as bad_response', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  generateContent.mockResolvedValueOnce(jsonResponse({ emotion: 'x' }, { candidates: [{ finishReason: 'MAX_TOKENS' }] }));
  const r = await new GeminiComposerEngine().generateBrief(REQ);
  expect(r).toMatchObject({ ok: false, code: 'bad_response' });
});

it('treats empty text as bad_response', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  generateContent.mockResolvedValueOnce({ text: undefined, candidates: [{ finishReason: 'STOP' }] });
  const r = await new GeminiComposerEngine().generateBrief(REQ);
  expect(r).toMatchObject({ ok: false, code: 'bad_response' });
});

it('treats unparseable JSON as bad_response', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  generateContent.mockResolvedValueOnce({ text: 'not json {', candidates: [{ finishReason: 'STOP' }] });
  const r = await new GeminiComposerEngine().generateBrief(REQ);
  expect(r).toMatchObject({ ok: false, code: 'bad_response' });
});

it('classifies an invalid API key (400 API_KEY_INVALID) as auth', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  generateContent.mockRejectedValueOnce(Object.assign(new Error('API key not valid. Please pass a valid API key.'), { status: 400 }));
  const r = await new GeminiComposerEngine().generateBrief(REQ);
  expect(r).toMatchObject({ ok: false, code: 'auth' });
});

it('classifies a 429 as rate_limit', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  generateContent.mockRejectedValueOnce(Object.assign(new Error('RESOURCE_EXHAUSTED'), { status: 429 }));
  const r = await new GeminiComposerEngine().generateBrief(REQ);
  expect(r).toMatchObject({ ok: false, code: 'rate_limit' });
});

it('maps a generic failure to upstream without leaking raw detail', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  generateContent.mockRejectedValueOnce(new Error('socket hang up: internal-host:443'));
  const r = await new GeminiComposerEngine().generateBrief(REQ);
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.code).toBe('upstream');
    expect(r.error).not.toMatch(/internal-host/);
  }
});
