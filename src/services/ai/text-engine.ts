/**
 * Engine-agnostic plain-text generation for AUXILIARY AI tasks — the ones that
 * use tolerant JSON parsing (lexicon suggestions, YouTube recommendations)
 * rather than the Composer's forced structured-output port. These are cheap,
 * higher-volume, low-nuance jobs (see docs/AI_ENGINE_EVALUATION.md, Tier A).
 *
 * Anthropic is the default; **Gemini and OpenAI are opt-in via `AUX_AI_ENGINE`**,
 * DECOUPLED from the Composer's `COMPOSER_ENGINE` so the cheap tasks can run on
 * a cheap model while the Composer stays on Claude. Inert until the chosen
 * engine's API key is set — flipping the env without a key changes nothing.
 *
 * Gemini runs with thinking DISABLED (`thinkingBudget: 0`) — these tasks don't
 * need deep reasoning, and it keeps them fast and cheap.
 *
 * ⚠️ WHY OPENAI EXISTS HERE (added 2026-08-17). Measured against production:
 * `ANTHROPIC_API_KEY` is set but the account is OUT OF CREDIT (400
 * "credit balance is too low"), and `GEMINI_API_KEY` is not set anywhere —
 * not in Amplify, not in SSM, not in .env.local. So BOTH existing engines were
 * dead and every auxiliary AI feature with them: lexicon enrich/suggest/
 * alternatives/lyric-context and the lyric critic. `OPENAI_API_KEY` was already
 * present and working (it powers embeddings + poem emotion), so a third adapter
 * restores the whole layer without Raj buying anything.
 */

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';

export type TextEngineId = 'anthropic' | 'gemini' | 'openai';

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
/** Cheap and fast; these are Tier-A tasks, not reasoning ones. */
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

export type TextGenCode = 'not_configured' | 'auth' | 'rate_limit' | 'upstream' | 'bad_response';
export type TextGenResult =
  | { ok: true; text: string; engine: TextEngineId; model: string }
  | { ok: false; code: TextGenCode; error: string };

export interface TextGenRequest {
  system: string;
  prompt: string;
  maxTokens: number;
  temperature?: number;
  signal?: AbortSignal;
  /** Override engine selection; otherwise AUX_AI_ENGINE env → 'anthropic'. */
  engine?: string;
}

/** Resolve which engine handles auxiliary text tasks. Default anthropic. */
export function selectedTextEngine(explicit?: string): TextEngineId {
  const id = (explicit || process.env.AUX_AI_ENGINE || 'anthropic').trim().toLowerCase();
  if (id === 'gemini') return 'gemini';
  if (id === 'openai') return 'openai';
  return 'anthropic';
}

const anthropicKey = () => {
  const k = process.env.ANTHROPIC_API_KEY;
  return k && k !== 'dummy-key-for-build' ? k : undefined;
};
const geminiKey = () => {
  const k = process.env.GEMINI_API_KEY;
  return k && k !== 'dummy-key-for-build' ? k : undefined;
};
const openaiKey = () => {
  const k = process.env.OPENAI_API_KEY;
  return k && k !== 'dummy-key-for-build' ? k : undefined;
};

/** True when the selected engine's credential is present. */
export function isTextEngineConfigured(engine?: string): boolean {
  switch (selectedTextEngine(engine)) {
    case 'gemini': return !!geminiKey();
    case 'openai': return !!openaiKey();
    default: return !!anthropicKey();
  }
}

/** The model id the selected engine will use (for logging). */
export function textEngineModel(engine?: string): string {
  switch (selectedTextEngine(engine)) {
    case 'gemini': return process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    case 'openai': return process.env.AUX_OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
    default: return process.env.AUX_ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
  }
}

/** Generate plain text from any engine, classified failures, no throw. */
export async function generateText(req: TextGenRequest): Promise<TextGenResult> {
  switch (selectedTextEngine(req.engine)) {
    case 'gemini': return geminiText(req);
    case 'openai': return openaiText(req);
    default: return anthropicText(req);
  }
}

async function openaiText(req: TextGenRequest): Promise<TextGenResult> {
  const key = openaiKey();
  if (!key) return { ok: false, code: 'not_configured', error: 'AI is not configured (OPENAI_API_KEY missing).' };
  const model = process.env.AUX_OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  try {
    const client = new OpenAI({ apiKey: key });
    const res = await client.chat.completions.create(
      {
        model,
        max_completion_tokens: req.maxTokens,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.prompt },
        ],
        ...(req.temperature != null ? { temperature: req.temperature } : {}),
      },
      req.signal ? { signal: req.signal } : {}
    );
    const text = (res.choices?.[0]?.message?.content ?? '').trim();
    if (!text) return { ok: false, code: 'bad_response', error: 'The AI returned an empty response. Please try again.' };
    return { ok: true, text, engine: 'openai', model };
  } catch (err) {
    const status = (err as { status?: number })?.status;
    console.error('[ai/text-engine:openai] failed', status ?? '', err instanceof Error ? err.message : String(err));
    if (status === 401 || status === 403) return { ok: false, code: 'auth', error: 'The OpenAI API key is invalid, expired, or lacks access.' };
    if (status === 429) return { ok: false, code: 'rate_limit', error: 'The AI service is rate-limited right now. Please retry in a moment.' };
    return { ok: false, code: 'upstream', error: 'The AI service failed to respond. Please try again.' };
  }
}

async function anthropicText(req: TextGenRequest): Promise<TextGenResult> {
  const key = anthropicKey();
  if (!key) return { ok: false, code: 'not_configured', error: 'AI is not configured (ANTHROPIC_API_KEY missing).' };
  const model = process.env.AUX_ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
  try {
    const client = new Anthropic({ apiKey: key });
    const res = await client.messages.create(
      {
        model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: 'user', content: req.prompt }],
        ...(req.temperature != null ? { temperature: req.temperature } : {}),
      },
      req.signal ? { signal: req.signal } : {}
    );
    const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
    if (!text) return { ok: false, code: 'bad_response', error: 'The AI returned an empty response. Please try again.' };
    return { ok: true, text, engine: 'anthropic', model };
  } catch (err) {
    const status = (err as { status?: number })?.status;
    console.error('[ai/text-engine:anthropic] failed', status ?? '', err instanceof Error ? err.message : String(err));
    if (status === 401 || status === 403) return { ok: false, code: 'auth', error: 'The Claude API key is invalid, expired, or lacks access.' };
    if (status === 429) return { ok: false, code: 'rate_limit', error: 'The AI service is rate-limited right now. Please retry in a moment.' };
    return { ok: false, code: 'upstream', error: 'The AI service failed to respond. Please try again.' };
  }
}

async function geminiText(req: TextGenRequest): Promise<TextGenResult> {
  const key = geminiKey();
  if (!key) return { ok: false, code: 'not_configured', error: 'AI is not configured (GEMINI_API_KEY missing).' };
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const res = await ai.models.generateContent({
      model,
      contents: req.prompt,
      config: {
        systemInstruction: req.system,
        maxOutputTokens: req.maxTokens,
        thinkingConfig: { thinkingBudget: 0 }, // aux tasks don't need reasoning → cheap + fast
        ...(req.temperature != null ? { temperature: req.temperature } : {}),
        ...(req.signal ? { abortSignal: req.signal } : {}),
      },
    });
    const text = (res.text ?? '').trim();
    if (!text) return { ok: false, code: 'bad_response', error: 'The AI returned an empty response. Please try again.' };
    return { ok: true, text, engine: 'gemini', model };
  } catch (err) {
    const status = (err as { status?: number })?.status;
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[ai/text-engine:gemini] failed', status ?? '', detail);
    if (status === 401 || status === 403 || /api[\s_-]?key/i.test(detail)) {
      return { ok: false, code: 'auth', error: 'The Gemini API key is invalid, expired, or lacks access.' };
    }
    if (status === 429) return { ok: false, code: 'rate_limit', error: 'The AI service is rate-limited right now. Please retry in a moment.' };
    return { ok: false, code: 'upstream', error: 'The AI service failed to respond. Please try again.' };
  }
}
