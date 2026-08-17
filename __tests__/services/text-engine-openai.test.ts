/** @jest-environment node */
/**
 * ⚠️ WHY OPENAI IS HERE. Measured against production 2026-08-17:
 * `ANTHROPIC_API_KEY` is set but the account is OUT OF CREDIT (HTTP 400,
 * "Your credit balance is too low"), and `GEMINI_API_KEY` exists nowhere —
 * not Amplify, not SSM, not .env.local. Both engines were dead, and with them
 * every auxiliary AI feature: lexicon enrich/suggest/alternatives/lyric-context
 * and the lyric critic. `OPENAI_API_KEY` was already present and working.
 *
 * These tests pin the SELECTION and CONFIGURATION logic — the part that decides
 * whether a feature reports "not configured" or actually runs. A wrong answer
 * here is what makes a working key look like a dead one.
 */

import {
  selectedTextEngine,
  isTextEngineConfigured,
  textEngineModel,
} from '@/services/ai/text-engine';

const ENV = process.env;

beforeEach(() => {
  process.env = { ...ENV };
  delete process.env.AUX_AI_ENGINE;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.AUX_OPENAI_MODEL;
});
afterAll(() => { process.env = ENV; });

describe('engine selection', () => {
  it('defaults to anthropic, preserving existing behaviour', () => {
    expect(selectedTextEngine()).toBe('anthropic');
  });

  it('selects openai when asked', () => {
    process.env.AUX_AI_ENGINE = 'openai';
    expect(selectedTextEngine()).toBe('openai');
  });

  it('still selects gemini', () => {
    process.env.AUX_AI_ENGINE = 'gemini';
    expect(selectedTextEngine()).toBe('gemini');
  });

  it('is case- and whitespace-tolerant', () => {
    process.env.AUX_AI_ENGINE = '  OpenAI  ';
    expect(selectedTextEngine()).toBe('openai');
  });

  it('falls back to anthropic for an unknown engine rather than throwing', () => {
    process.env.AUX_AI_ENGINE = 'llama';
    expect(selectedTextEngine()).toBe('anthropic');
  });

  it('lets an explicit argument beat the env', () => {
    process.env.AUX_AI_ENGINE = 'gemini';
    expect(selectedTextEngine('openai')).toBe('openai');
  });
});

describe('configuration is per-engine', () => {
  /** The exact production state that took the AI layer down. */
  it('reports openai configured when only OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'sk-real';
    process.env.AUX_AI_ENGINE = 'openai';
    expect(isTextEngineConfigured()).toBe(true);
  });

  it('does NOT report configured when the key belongs to another engine', () => {
    process.env.OPENAI_API_KEY = 'sk-real';
    process.env.AUX_AI_ENGINE = 'gemini';
    expect(isTextEngineConfigured()).toBe(false);
  });

  it('treats the build placeholder as absent', () => {
    process.env.OPENAI_API_KEY = 'dummy-key-for-build';
    process.env.AUX_AI_ENGINE = 'openai';
    expect(isTextEngineConfigured()).toBe(false);
  });

  it('reports unconfigured with no keys at all', () => {
    expect(isTextEngineConfigured()).toBe(false);
  });
});

describe('model reporting', () => {
  it('names a cheap default for openai', () => {
    process.env.AUX_AI_ENGINE = 'openai';
    expect(textEngineModel()).toBe('gpt-4o-mini');
  });

  it('honours an override', () => {
    process.env.AUX_AI_ENGINE = 'openai';
    process.env.AUX_OPENAI_MODEL = 'gpt-4o';
    expect(textEngineModel()).toBe('gpt-4o');
  });

  it('leaves defaults for the other engines', () => {
    expect(textEngineModel('anthropic')).toBe('claude-sonnet-4-6');
    expect(textEngineModel('gemini')).toBe('gemini-2.5-flash');
  });
});
