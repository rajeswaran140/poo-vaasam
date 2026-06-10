/**
 * Composer engine port — the model-agnostic seam.
 *
 * An engine's ONLY job is to make the structured-output call for a given
 * request and return the model's raw structured object (the tool args / parsed
 * JSON), or a classified failure. It does NOT validate against the brief schema,
 * ground the palettes, or thread SUNO prompts — that domain logic lives in
 * composer.ts so EVERY engine feeds the exact same pipeline and the brief stays
 * the single, engine-independent durable contract (see composerSchema.ts).
 *
 * This keeps adding a new engine (Gemini, etc.) a matter of implementing one
 * small interface, with zero duplication of the grounding/validation rules.
 */

/**
 * Failure taxonomy, shared 1:1 with composer.ts's ComposeErrorCode so an engine
 * error maps straight through to the API/worker response without translation.
 *  - not_configured: key missing / placeholder
 *  - auth:           key present but rejected (invalid / expired / revoked)
 *  - rate_limit:     provider returned 429 / quota exhausted
 *  - upstream:       any other API / network failure (incl. abort/timeout)
 *  - bad_response:   call succeeded but produced no usable structured output
 *                    (truncated at the token cap, no tool/JSON block, unparseable)
 */
export type EngineErrorCode =
  | 'not_configured'
  | 'auth'
  | 'rate_limit'
  | 'upstream'
  | 'bad_response';

/**
 * Everything an engine needs to produce a brief. The system prompt, JSON Schema,
 * and tuning knobs are assembled once by composer.ts and handed to whichever
 * engine is selected, so the grounding/validation rules can never diverge by
 * engine.
 */
export interface BriefRequest {
  /** Fully-assembled system prompt (palettes already injected). */
  system: string;
  /** The user's Tamil lyrics (already trimmed + length-checked). */
  lyrics: string;
  /** JSON Schema of the brief — composerAnalysisJsonSchema. */
  jsonSchema: Record<string, unknown>;
  /** Name of the structured-output tool/function (e.g. 'submit_brief'). */
  toolName: string;
  /** Max output tokens for the call. */
  maxOutputTokens: number;
  /** Sampling temperature (structured extraction → low). */
  temperature: number;
  /** Hard server-side ceiling so a hung upstream can't pin the worker. */
  timeoutMs: number;
  /** Abort signal — cancels the upstream call on disconnect / supersede. */
  signal?: AbortSignal;
}

/**
 * `raw` is the model's structured object exactly as returned (tool args /
 * parsed JSON), still un-validated. composer.ts runs the Zod safeParse.
 */
export type EngineResult =
  | {
      ok: true;
      raw: unknown;
      usage: { inputTokens: number; outputTokens: number };
      stopReason: string | null;
    }
  | { ok: false; code: EngineErrorCode; error: string };

/** A pluggable composer engine (Anthropic, Gemini, …). */
export interface ComposerEngine {
  /** Stable identifier for selection + logging, e.g. 'anthropic' | 'gemini'. */
  readonly id: string;
  /** Resolved model id, surfaced in logs and the benchmark. */
  readonly model: string;
  /** True when the engine's credential is present (not missing/placeholder). */
  isConfigured(): boolean;
  /** Produce a brief's raw structured output, or a classified failure. */
  generateBrief(req: BriefRequest): Promise<EngineResult>;
}
