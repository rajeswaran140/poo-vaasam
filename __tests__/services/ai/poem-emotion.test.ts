/** @jest-environment node */
/**
 * Unit tests for the shared poem-emotion analyzer. The `openai` module is mocked
 * so no network call happens; we assert the model/JSON-mode contract and the
 * throw-on-failure behaviour callers rely on for their `degraded` fallback.
 */
const mockCreate = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: (...a: unknown[]) => mockCreate(...a) } },
  })),
}));

import {
  analyzePoemEmotion,
  isPoemAnalysisConfigured,
  DEFAULT_POEM_ANALYSIS,
} from '@/services/ai/poem-emotion';

const valid = {
  emotion: 'reflective',
  mood: 'gentle',
  themes: ['நினைவு'],
  musicRecommendation: 'peaceful_ambient',
  ttsSpeed: 1,
  ttsPitch: 1,
  summary: 'ச',
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.OPENAI_API_KEY = 'sk-test-key';
});

it('isPoemAnalysisConfigured reflects a usable key', () => {
  expect(isPoemAnalysisConfigured()).toBe(true);
  delete process.env.OPENAI_API_KEY;
  expect(isPoemAnalysisConfigured()).toBe(false);
  process.env.OPENAI_API_KEY = 'your-openai-api-key-here';
  expect(isPoemAnalysisConfigured()).toBe(false);
});

it('returns the parsed analysis using gpt-4o-mini + JSON mode', async () => {
  mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(valid) } }] });
  const out = await analyzePoemEmotion({ title: 'த', body: 'உடல்', author: 'Raj' });
  expect(out).toEqual(valid);
  expect(mockCreate).toHaveBeenCalledWith(
    expect.objectContaining({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
    })
  );
});

it('throws when no key is configured (and never calls the API)', async () => {
  delete process.env.OPENAI_API_KEY;
  await expect(analyzePoemEmotion({ title: 'த', body: 'உடல்' })).rejects.toThrow(/not configured/i);
  expect(mockCreate).not.toHaveBeenCalled();
});

it('throws when the model returns unparseable content', async () => {
  mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: 'not json at all' } }] });
  await expect(analyzePoemEmotion({ title: 'த', body: 'உடல்' })).rejects.toThrow();
});

it('throws when the API errors', async () => {
  mockCreate.mockRejectedValueOnce(new Error('openai down'));
  await expect(analyzePoemEmotion({ title: 'த', body: 'உடல்' })).rejects.toThrow(/openai down/);
});

it('exposes a usable default fallback', () => {
  expect(DEFAULT_POEM_ANALYSIS.emotion).toBeTruthy();
  expect(Array.isArray(DEFAULT_POEM_ANALYSIS.themes)).toBe(true);
  expect(typeof DEFAULT_POEM_ANALYSIS.ttsSpeed).toBe('number');
});
