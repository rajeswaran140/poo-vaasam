/** @jest-environment node */
/**
 * text-engine — engine selection (Anthropic default, Gemini opt-in via
 * AUX_AI_ENGINE), key-gated config, and both provider paths with error
 * classification. Both SDKs are mocked.
 */

const anthropicCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ messages: { create: anthropicCreate } })),
}));
const geminiGenerate = jest.fn();
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({ models: { generateContent: geminiGenerate } })),
  FinishReason: { MAX_TOKENS: 'MAX_TOKENS' },
}));

import { generateText, selectedTextEngine, isTextEngineConfigured } from '@/services/ai/text-engine';

const ENV = { ...process.env };
beforeEach(() => {
  anthropicCreate.mockReset();
  geminiGenerate.mockReset();
  process.env = { ...ENV };
  delete process.env.AUX_AI_ENGINE;
});
afterAll(() => { process.env = ENV; });

describe('selection & config', () => {
  it('defaults to anthropic; AUX_AI_ENGINE / explicit arg switch to gemini', () => {
    expect(selectedTextEngine()).toBe('anthropic');
    process.env.AUX_AI_ENGINE = 'gemini';
    expect(selectedTextEngine()).toBe('gemini');
    delete process.env.AUX_AI_ENGINE;
    expect(selectedTextEngine('gemini')).toBe('gemini');
  });

  it('gates configuration on the SELECTED engine key (decoupled)', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    delete process.env.GEMINI_API_KEY;
    expect(isTextEngineConfigured()).toBe(true);          // anthropic default + key
    process.env.AUX_AI_ENGINE = 'gemini';
    expect(isTextEngineConfigured()).toBe(false);         // gemini selected, no key
    process.env.GEMINI_API_KEY = 'g';
    expect(isTextEngineConfigured()).toBe(true);
  });
});

describe('anthropic path', () => {
  beforeEach(() => { process.env.ANTHROPIC_API_KEY = 'sk-ant'; });

  it('returns text and passes the prompt as the user message', async () => {
    anthropicCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'hello' }] });
    const r = await generateText({ system: 's', prompt: 'p', maxTokens: 100 });
    expect(r).toMatchObject({ ok: true, text: 'hello', engine: 'anthropic' });
    expect(anthropicCreate.mock.calls[0][0].messages[0].content).toBe('p');
  });

  it('returns not_configured (no API call) when the key is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = await generateText({ system: 's', prompt: 'p', maxTokens: 100 });
    expect(r).toMatchObject({ ok: false, code: 'not_configured' });
    expect(anthropicCreate).not.toHaveBeenCalled();
  });

  it('classifies a 429 as rate_limit', async () => {
    anthropicCreate.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 429 }));
    expect(await generateText({ system: 's', prompt: 'p', maxTokens: 100 })).toMatchObject({ ok: false, code: 'rate_limit' });
  });
});

describe('gemini path', () => {
  beforeEach(() => { process.env.AUX_AI_ENGINE = 'gemini'; process.env.GEMINI_API_KEY = 'g'; });

  it('returns text with thinking disabled and the system instruction set', async () => {
    geminiGenerate.mockResolvedValueOnce({ text: 'gem out' });
    const r = await generateText({ system: 's', prompt: 'p', maxTokens: 100 });
    expect(r).toMatchObject({ ok: true, text: 'gem out', engine: 'gemini' });
    const cfg = geminiGenerate.mock.calls[0][0].config;
    expect(cfg.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(cfg.systemInstruction).toBe('s');
    expect(anthropicCreate).not.toHaveBeenCalled();
  });

  it('classifies an API-key error as auth', async () => {
    geminiGenerate.mockRejectedValueOnce(new Error('API key not valid'));
    expect(await generateText({ system: 's', prompt: 'p', maxTokens: 100 })).toMatchObject({ ok: false, code: 'auth' });
  });
});
