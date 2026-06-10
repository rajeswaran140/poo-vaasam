/** @jest-environment node */
/**
 * Tests for the engine registry — selection precedence (explicit id > env >
 * default), model override pass-through, and unknown-id rejection.
 */

jest.mock('@anthropic-ai/sdk', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@google/genai', () => ({ __esModule: true, GoogleGenAI: jest.fn(), FinishReason: {} }));

import { getEngine, DEFAULT_ENGINE_ID } from '@/services/ai/engines';

const originalEngine = process.env.COMPOSER_ENGINE;

afterEach(() => {
  if (originalEngine === undefined) delete process.env.COMPOSER_ENGINE;
  else process.env.COMPOSER_ENGINE = originalEngine;
});

it('defaults to the Anthropic engine', () => {
  delete process.env.COMPOSER_ENGINE;
  expect(DEFAULT_ENGINE_ID).toBe('anthropic');
  expect(getEngine().id).toBe('anthropic');
});

it('selects by explicit id (case-insensitive, trimmed)', () => {
  expect(getEngine('gemini').id).toBe('gemini');
  expect(getEngine('  Gemini  ').id).toBe('gemini');
  expect(getEngine('anthropic').id).toBe('anthropic');
});

it('falls back to COMPOSER_ENGINE when no explicit id is given', () => {
  process.env.COMPOSER_ENGINE = 'gemini';
  expect(getEngine().id).toBe('gemini');
});

it('an explicit id overrides the env default', () => {
  process.env.COMPOSER_ENGINE = 'gemini';
  expect(getEngine('anthropic').id).toBe('anthropic');
});

it('passes a model override to the selected engine', () => {
  expect(getEngine('anthropic', 'claude-haiku-4-5-20251001').model).toBe('claude-haiku-4-5-20251001');
  expect(getEngine('gemini', 'gemini-2.0-flash').model).toBe('gemini-2.0-flash');
});

it('throws on an unknown engine id', () => {
  expect(() => getEngine('no-such-engine')).toThrow(/Unknown composer engine/);
});
