/**
 * the generator critic — an LLM pass that predicts SEMANTIC failure modes the
 * deterministic pre-flight linter (src/lib/prompt-preflight.ts) can't catch:
 * style↔lyric mood mismatch, unsingable phrasing, ambiguous prompts,
 * pronunciation/language risk. Run BEFORE spending a the generator credit. Mirrors the
 * composer's Anthropic tool-use pattern (forced structured output). Admin-only
 * call site; never in a render path.
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_TOKENS = 1024;
const TOOL_NAME = 'submit_suno_critique';

export const promptCritiqueSchema = z.object({
  verdict: z.enum(['ready', 'risky', 'not_ready']),
  summary: z.string().min(1).describe('One-sentence overall read.'),
  issues: z
    .array(
      z.object({
        severity: z.enum(['high', 'medium', 'low']),
        title: z.string().min(1),
        detail: z.string().min(1),
        fix: z.string().min(1),
      })
    )
    .max(8)
    .describe('Concrete, generator-specific risks — empty if genuinely clean.'),
});
export type PromptCritique = z.infer<typeof promptCritiqueSchema>;

const jsonSchema = z.toJSONSchema(promptCritiqueSchema) as Record<string, unknown>;

const SYSTEM_PROMPT = `You are an expert at AI music generation, specializing in Tamil songs.
The user gives you a "style of music" prompt and the song lyrics. the generator has NO API and every generation costs a paid credit, so your job is to predict — BEFORE they generate — the SEMANTIC problems a rule-based linter cannot see:
- mismatch between the style prompt's mood/genre and the actual lyric content,
- phrasing that is hard to sing or will be mispronounced (esp. Tamil),
- ambiguous or self-contradictory style direction,
- structure issues (e.g. a chorus that won't land),
- anything likely to produce a wasted/sub-optimal render.
Be concise and concrete; every issue must have an actionable fix. If it's genuinely clean, return verdict "ready" with an empty issues array. Respond ONLY via the tool.`;

export type CritiqueResult =
  | { ok: true; critique: PromptCritique }
  | { ok: false; code: 'not_configured' | 'auth' | 'rate_limit' | 'upstream' | 'bad_response'; error: string };

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key === 'dummy-key-for-build') return null;
  return new Anthropic({ apiKey: key });
}

export async function critiquePrompt(
  input: { style: string; lyrics: string },
  options: { model?: string; signal?: AbortSignal } = {}
): Promise<CritiqueResult> {
  const style = String(input.style ?? '').trim();
  const lyrics = String(input.lyrics ?? '').trim();
  if (!style || !lyrics) {
    return { ok: false, code: 'upstream', error: 'Both a style prompt and lyrics are required.' };
  }

  const client = getClient();
  if (!client) {
    return { ok: false, code: 'not_configured', error: 'AI is not configured (ANTHROPIC_API_KEY missing).' };
  }

  let res: Anthropic.Messages.Message;
  try {
    res = await client.messages.create(
      {
        model: options.model || DEFAULT_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0.3,
        system: SYSTEM_PROMPT,
        tools: [
          {
            name: TOOL_NAME,
            description: 'Submit the prompt pre-flight critique.',
            input_schema: jsonSchema as Anthropic.Messages.Tool.InputSchema,
          },
        ],
        tool_choice: { type: 'tool', name: TOOL_NAME },
        messages: [
          { role: 'user', content: `STYLE PROMPT:\n${style}\n\nLYRICS:\n${lyrics}` },
        ],
      },
      { signal: options.signal, timeout: REQUEST_TIMEOUT_MS }
    );
  } catch (err) {
    const status = (err as { status?: number })?.status;
    console.error('[ai/promptCritic] Anthropic call failed:', err instanceof Error ? err.message : String(err));
    if (status === 401 || status === 403) return { ok: false, code: 'auth', error: 'The Claude API key is invalid or lacks access.' };
    if (status === 429) return { ok: false, code: 'rate_limit', error: 'The AI service is rate-limited; retry shortly.' };
    return { ok: false, code: 'upstream', error: 'The AI service failed to respond. Please try again.' };
  }

  if (res.stop_reason === 'max_tokens') {
    return { ok: false, code: 'bad_response', error: 'The critique was too long and got cut off. Please retry.' };
  }
  const toolUse = res.content.find(
    (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use' && b.name === TOOL_NAME
  );
  if (!toolUse) {
    return { ok: false, code: 'bad_response', error: 'The AI returned an unexpected format. Please retry.' };
  }
  const parsed = promptCritiqueSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    console.error('[ai/promptCritic] schema validation failed:', parsed.error.message);
    return { ok: false, code: 'bad_response', error: 'The AI critique did not match the expected shape. Please retry.' };
  }
  return { ok: true, critique: parsed.data };
}
