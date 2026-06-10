/**
 * Gemini composer engine — Google Gemini Flash via @google/genai (AI Studio key).
 *
 * Gemini's equivalent of Claude's forced tool use is **structured output**:
 * `responseMimeType: 'application/json'` + a `responseSchema`. That guarantees a
 * JSON body matching the schema shape — no prose, no fences — which we then hand
 * back to composer.ts for the SAME Zod validation + palette grounding the
 * Anthropic path uses. The brief contract stays engine-independent.
 *
 * Gemini's responseSchema is an OpenAPI subset (no $defs/minItems/…), so the
 * brief's JSON Schema is run through `toGeminiSchema` first.
 *
 * Configured via GEMINI_API_KEY; model via GEMINI_MODEL (default gemini-2.5-flash).
 */

import { GoogleGenAI, FinishReason } from '@google/genai';
import type { Schema } from '@google/genai';
import type { BriefRequest, ComposerEngine, EngineResult } from './types';
import { toGeminiSchema } from './toGeminiSchema';

export const GEMINI_ENGINE_ID = 'gemini';
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

function getApiKey(): string | undefined {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key === 'dummy-key-for-build') return undefined;
  return key;
}

export class GeminiComposerEngine implements ComposerEngine {
  readonly id = GEMINI_ENGINE_ID;
  readonly model: string;

  constructor(modelOverride?: string) {
    this.model = modelOverride || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  }

  isConfigured(): boolean {
    return !!getApiKey();
  }

  async generateBrief(req: BriefRequest): Promise<EngineResult> {
    const apiKey = getApiKey();
    if (!apiKey) {
      return { ok: false, code: 'not_configured', error: 'AI is not configured (GEMINI_API_KEY missing).' };
    }

    const ai = new GoogleGenAI({ apiKey });
    const startedAt = Date.now();

    let res;
    try {
      res = await ai.models.generateContent({
        model: this.model,
        contents: req.lyrics,
        config: {
          systemInstruction: req.system,
          responseMimeType: 'application/json',
          responseSchema: toGeminiSchema(req.jsonSchema) as Schema,
          temperature: req.temperature,
          maxOutputTokens: req.maxOutputTokens,
          abortSignal: req.signal,
        },
      });
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[ai/engine:gemini] call failed (status=${status ?? 'n/a'}, ms=${Date.now() - startedAt}):`, detail);

      // Invalid AI Studio keys come back as 400 API_KEY_INVALID, not 401.
      const keyRejected = status === 401 || status === 403 || /api[\s_-]?key/i.test(detail);
      if (keyRejected) {
        return { ok: false, code: 'auth', error: 'The Gemini API key is invalid, expired, or lacks access. Update GEMINI_API_KEY.' };
      }
      if (status === 429) {
        return { ok: false, code: 'rate_limit', error: 'The AI service is rate-limited right now. Please retry in a moment.' };
      }
      return { ok: false, code: 'upstream', error: 'The AI service failed to respond. Please try again.' };
    }

    const finishReason = res.candidates?.[0]?.finishReason;
    const outputTokens = res.usageMetadata?.candidatesTokenCount ?? 0;

    // Hit the output cap → JSON was cut off mid-structure.
    if (finishReason === FinishReason.MAX_TOKENS) {
      console.error(`[ai/engine:gemini] response truncated at maxOutputTokens (${outputTokens}/${req.maxOutputTokens})`);
      return { ok: false, code: 'bad_response', error: 'The AI response was too long and got cut off. Please try again.' };
    }

    const text = res.text;
    if (!text) {
      console.error('[ai/engine:gemini] empty response text; finishReason:', finishReason ?? 'n/a');
      return { ok: false, code: 'bad_response', error: 'The AI returned an unexpected format. Please try again.' };
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      console.error('[ai/engine:gemini] response was not valid JSON; finishReason:', finishReason ?? 'n/a');
      return { ok: false, code: 'bad_response', error: 'The AI returned an unexpected format. Please try again.' };
    }

    return {
      ok: true,
      raw,
      usage: { inputTokens: res.usageMetadata?.promptTokenCount ?? 0, outputTokens },
      stopReason: finishReason ?? null,
    };
  }
}
