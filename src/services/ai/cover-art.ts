/**
 * Cover-art generation — turn a (thumbnail) prompt into a song cover image via
 * OpenAI's image model. Returns raw PNG bytes (base64) so the caller can upload
 * to S3. Errors are classified + user-safe (no raw upstream leakage), mirroring
 * the composer's contract.
 */

import OpenAI from 'openai';

const MODEL = 'gpt-image-1';

export type CoverResult =
  | { ok: true; base64: string }
  | { ok: false; error: string };

function getClient(): OpenAI | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key === 'dummy-key-for-build') return null;
  return new OpenAI({ apiKey: key });
}

/** Build a default, on-brand, apolitical cover prompt from a song's title + theme. */
export function defaultCoverPrompt(title: string, themeLabel?: string): string {
  const mood = themeLabel ? ` Mood/theme: ${themeLabel}.` : '';
  return (
    `A cinematic, emotionally evocative 16:9 cover image for a Tamil song titled "${title}".${mood} ` +
    `Warm, painterly, culturally Tamil aesthetic with soft natural light. No text or lettering. ` +
    `Strictly apolitical — no flags, political symbols, parties, or partisan references.`
  );
}

export async function generateCoverArt(prompt: string): Promise<CoverResult> {
  const p = String(prompt ?? '').trim();
  if (!p) return { ok: false, error: 'A prompt is required' };

  const client = getClient();
  if (!client) return { ok: false, error: 'AI image generation is not configured (OPENAI_API_KEY missing).' };

  try {
    const res = await client.images.generate({
      model: MODEL,
      prompt: p.slice(0, 4000),
      size: '1536x1024', // landscape cover
      n: 1,
    });
    const base64 = res.data?.[0]?.b64_json;
    if (!base64) return { ok: false, error: 'The image service returned no image.' };
    return { ok: true, base64 };
  } catch (err) {
    const status = (err as { status?: number })?.status;
    console.error(`[ai/cover-art] image gen failed (status=${status ?? 'n/a'}):`, err instanceof Error ? err.message : String(err));
    if (status === 401 || status === 403) return { ok: false, error: 'The OpenAI key is invalid or lacks image access.' };
    if (status === 429) return { ok: false, error: 'Image service is rate-limited; please retry shortly.' };
    return { ok: false, error: 'Image generation failed. Please try again.' };
  }
}
