/**
 * Content-authoring helpers (pure, framework-free) shared by the New + Edit
 * content pages. No AI — deterministic writer tooling only.
 *
 * Field limits MIRROR the server's Zod schema in `/api/admin/content` so the
 * live counters warn the writer BEFORE a submit 400s. Keep these in sync with
 * `createContentSchema`.
 */

/** Max lengths enforced by the create/update content schemas (UTF-16 length). */
export const FIELD_LIMITS = {
  title: 200,
  description: 500,
  body: 50_000,
  author: 100,
  seoTitle: 60,
  seoDescription: 160,
} as const;

export type FieldKey = keyof typeof FIELD_LIMITS;

export type CounterState = 'ok' | 'warn' | 'over';

/**
 * Classify a length against its limit. We measure with `String.length` (UTF-16
 * code units) because that's exactly what Zod's `.max()` checks — so "warn"
 * fires just before the server would reject, never after. Tamil sits in the BMP
 * (U+0B80–U+0BFF), so one code unit per character.
 */
export function counterState(length: number, max: number): CounterState {
  if (length > max) return 'over';
  if (max > 0 && length >= Math.floor(max * 0.9)) return 'warn';
  return 'ok';
}

export interface TextMetrics {
  chars: number;
  words: number;
  lines: number;
}

/**
 * Character / word / line counts for a body of text. Words split on any
 * whitespace (works for Tamil, which space-separates words); lines split on
 * CRLF/CR/LF. Empty/whitespace-only text yields zero words.
 */
export function textMetrics(text: string): TextMetrics {
  const value = text ?? '';
  const trimmed = value.trim();
  return {
    chars: value.length,
    words: trimmed ? trimmed.split(/\s+/).length : 0,
    lines: value === '' ? 0 : value.split(/\r\n|\r|\n/).length,
  };
}
