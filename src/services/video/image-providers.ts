/**
 * STILL image providers (spec 6.4): Grok Imagine by default, the existing
 * OpenAI cover-art function as a landscape-only fallback. Raw upstream text is
 * logged server-side and never returned.
 */
import { generateCoverArt } from '@/services/ai/cover-art';
import { getXaiApiKey } from '@/services/video/credentials';
import type { VideoErrorCode } from '@/services/video/providers/types';
import type { AspectRatio } from '@/types/visualStory';

export type ImageResult =
  | { ok: true; bytes: Buffer; contentType: 'image/jpeg' | 'image/png'; billed: true }
  | { ok: false; code: VideoErrorCode | 'billing'; error: string; billed: boolean };

export interface StillImageRequest {
  providerId?: 'grok-image' | 'openai-image';
  prompt: string;
  aspectRatio: AspectRatio;
  signal?: AbortSignal;
}

const XAI_URL = 'https://api.x.ai/v1/images/generations';
const XAI_MODEL = 'grok-imagine-image';
const TIMEOUT_MS = 25_000;

const fail = (code: VideoErrorCode | 'billing', error: string, billed = false): ImageResult => ({
  ok: false, code, error, billed,
});

async function grok(req: StillImageRequest): Promise<ImageResult> {
  const key = await getXaiApiKey();
  if (!key) return fail('not_configured', 'Grok image generation is not configured.');

  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;

  let status: number;
  let text: string;
  try {
    const res = await fetch(XAI_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: XAI_MODEL,
        prompt: req.prompt,
        n: 1,
        aspect_ratio: req.aspectRatio,
        response_format: 'b64_json',
      }),
      signal,
    });
    status = res.status;
    text = await res.text();
  } catch (err) {
    console.error('[video/image-providers] grok request failed:', err instanceof Error ? err.message : String(err));
    return fail('upstream', 'The image service could not be reached. Please try again.');
  }

  if (status < 200 || status >= 300) {
    console.error(`[video/image-providers] grok HTTP ${status}:`, text.slice(0, 500));
    // xAI reports an empty balance as a 4xx (often 403), so check the body first.
    if (/credit|billing/i.test(text)) {
      return fail('billing', 'The xAI account is out of credit. Add credits in the xAI console, then try again.');
    }
    if (status === 401 || status === 403) return fail('auth', 'The xAI key was rejected.');
    if (status === 429) return fail('rate_limit', 'The image service is rate-limited; please retry shortly.');
    return fail('upstream', 'Image generation failed. Please try again.');
  }

  let json: { respect_moderation?: boolean; data?: Array<{ b64_json?: string; respect_moderation?: boolean }> };
  try {
    json = JSON.parse(text);
  } catch {
    return fail('bad_response', 'The image service returned an unreadable response.');
  }
  const first = json?.data?.[0];
  if (json?.respect_moderation === false || first?.respect_moderation === false) {
    return fail('content_policy', 'The image was blocked by the provider’s content filter.', true);
  }
  if (!first?.b64_json) return fail('bad_response', 'The image service returned no image.');
  return { ok: true, bytes: Buffer.from(first.b64_json, 'base64'), contentType: 'image/jpeg', billed: true };
}

async function openai(req: StillImageRequest): Promise<ImageResult> {
  if (req.aspectRatio === '9:16') return fail('bad_response', 'OpenAI stills are landscape only');
  const r = await generateCoverArt(req.prompt);
  if (!r.ok) return fail('upstream', r.error);
  return { ok: true, bytes: Buffer.from(r.base64, 'base64'), contentType: 'image/png', billed: true };
}

export async function generateStillImage(req: StillImageRequest): Promise<ImageResult> {
  return req.providerId === 'openai-image' ? openai(req) : grok(req);
}
