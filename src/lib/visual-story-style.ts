/**
 * A visual story's Style — one line ("warm cinematic film, golden-hour light,
 * 35mm") written once and added to every picture and clip request, and given
 * to the storyboard draft, so the look does not drift from shot to shot.
 * Client-safe: shared by the routes, the worker and the studio.
 */
import { z } from 'zod';

export const MAX_STYLE_CHARS = 300;

/** Trimmed; empty means no style. */
export const styleSchema = z.string().trim().max(MAX_STYLE_CHARS, `Keep the style under ${MAX_STYLE_CHARS} characters`);

/** The prompt with the story's style after it — or unchanged when there is none. */
export function withStyle(prompt: string, style: string | null | undefined): string {
  const s = (style ?? '').trim();
  return s ? `${prompt}\n\nVisual style: ${s}` : prompt;
}
