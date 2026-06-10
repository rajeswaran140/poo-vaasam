/**
 * Composer engine registry — resolves which engine handles a brief.
 *
 * Selection precedence: explicit `id` arg → COMPOSER_ENGINE env → default
 * ('anthropic'). Anthropic stays the production default; Gemini is opt-in
 * (explicit id or env) until the benchmark justifies a switch.
 *
 * `modelOverride` is engine-scoped — it replaces that engine's default model
 * (e.g. a Haiku fallback for Anthropic, or a specific Gemini Flash variant).
 */

import { AnthropicComposerEngine, ANTHROPIC_ENGINE_ID, DEFAULT_ANTHROPIC_MODEL } from './anthropic';
import { GeminiComposerEngine, GEMINI_ENGINE_ID } from './gemini';
import type { ComposerEngine } from './types';

export const DEFAULT_ENGINE_ID = ANTHROPIC_ENGINE_ID;

export function getEngine(id?: string, modelOverride?: string): ComposerEngine {
  const selected = (id || process.env.COMPOSER_ENGINE || DEFAULT_ENGINE_ID).trim().toLowerCase();
  switch (selected) {
    case ANTHROPIC_ENGINE_ID:
      return new AnthropicComposerEngine(modelOverride);
    case GEMINI_ENGINE_ID:
      return new GeminiComposerEngine(modelOverride);
    default:
      throw new Error(`Unknown composer engine: "${selected}"`);
  }
}

export { ANTHROPIC_ENGINE_ID, GEMINI_ENGINE_ID, DEFAULT_ANTHROPIC_MODEL };
export type { ComposerEngine, BriefRequest, EngineResult, EngineErrorCode } from './types';
