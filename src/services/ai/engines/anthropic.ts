/**
 * Anthropic composer engine — Claude via the official SDK.
 *
 * Reliability model (unchanged from the original inline implementation):
 *  - Claude **tool use** with a forced `tool_choice` means the model can only
 *    answer by calling the brief tool with arguments that match the JSON Schema
 *    — no markdown fences, prose preambles, or most malformed-JSON failures.
 *  - The raw tool args are returned to composer.ts, which validates them with
 *    the Zod schema (the single source of truth) and grounds the palettes.
 *  - The call is cancellable (`signal`) and hard-capped (`timeout`) so an
 *    abandoned or hung request stops billing / can't pin the worker.
 *
 * Default model is Sonnet 4.6 (current-gen, 1M context; `temperature` is still a
 * valid request parameter on Sonnet 4.6). A per-call override is honored for the
 * faster Haiku fallback / benchmarking.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { BriefRequest, ComposerEngine, EngineResult } from './types';

export const ANTHROPIC_ENGINE_ID = 'anthropic';
/** Current-gen Sonnet (was the legacy claude-sonnet-4-5). */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key === 'dummy-key-for-build') return null;
  return new Anthropic({ apiKey: key });
}

export class AnthropicComposerEngine implements ComposerEngine {
  readonly id = ANTHROPIC_ENGINE_ID;
  readonly model: string;

  constructor(modelOverride?: string) {
    this.model = modelOverride || DEFAULT_ANTHROPIC_MODEL;
  }

  isConfigured(): boolean {
    const key = process.env.ANTHROPIC_API_KEY;
    return !!key && key !== 'dummy-key-for-build';
  }

  async generateBrief(req: BriefRequest): Promise<EngineResult> {
    const client = getClient();
    if (!client) {
      return { ok: false, code: 'not_configured', error: 'AI is not configured (ANTHROPIC_API_KEY missing).' };
    }

    const startedAt = Date.now();
    let res: Anthropic.Messages.Message;
    try {
      res = await client.messages.create(
        {
          model: this.model,
          max_tokens: req.maxOutputTokens,
          temperature: req.temperature,
          system: req.system,
          tools: [
            {
              name: req.toolName,
              description: 'Submit the complete production brief for the given Tamil lyrics.',
              input_schema: req.jsonSchema as Anthropic.Messages.Tool.InputSchema,
            },
          ],
          // Force the model to answer via the tool — guarantees structured args.
          tool_choice: { type: 'tool', name: req.toolName },
          messages: [{ role: 'user', content: req.lyrics }],
        },
        { signal: req.signal, timeout: req.timeoutMs }
      );
    } catch (err) {
      // Log full upstream detail server-side; return a clean, user-safe code.
      const status = (err as { status?: number })?.status;
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[ai/engine:anthropic] call failed (status=${status ?? 'n/a'}, ms=${Date.now() - startedAt}):`, detail);

      if (status === 401 || status === 403) {
        return { ok: false, code: 'auth', error: 'The Claude API key is invalid, expired, or lacks access. Update ANTHROPIC_API_KEY.' };
      }
      if (status === 429) {
        return { ok: false, code: 'rate_limit', error: 'The AI service is rate-limited right now. Please retry in a moment.' };
      }
      return { ok: false, code: 'upstream', error: 'The AI service failed to respond. Please try again.' };
    }

    const outputTokens = res.usage?.output_tokens ?? 0;

    // A max_tokens stop means the tool arguments were cut off mid-JSON.
    if (res.stop_reason === 'max_tokens') {
      console.error(`[ai/engine:anthropic] response truncated at max_tokens (${outputTokens}/${req.maxOutputTokens})`);
      return { ok: false, code: 'bad_response', error: 'The AI response was too long and got cut off. Please try again.' };
    }

    const toolUse = res.content.find(
      (block): block is Anthropic.Messages.ToolUseBlock => block.type === 'tool_use' && block.name === req.toolName
    );
    if (!toolUse) {
      console.error('[ai/engine:anthropic] no tool_use block in response; stop_reason:', res.stop_reason);
      return { ok: false, code: 'bad_response', error: 'The AI returned an unexpected format. Please try again.' };
    }

    return {
      ok: true,
      raw: toolUse.input,
      usage: { inputTokens: res.usage?.input_tokens ?? 0, outputTokens },
      stopReason: res.stop_reason ?? null,
    };
  }
}
