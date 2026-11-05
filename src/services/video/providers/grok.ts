/**
 * GrokProvider — xAI Grok Imagine video (spec 6.2.1), in the owner's request
 * format: POST /v1/videos/generations -> request_id; GET /v1/videos/<id>.
 * Paid calls never receive the client's abort signal. Raw upstream text is
 * logged (name + status only) and never returned.
 */
import { getXaiApiKey } from '@/services/video/credentials';
import { estimateCostUsd } from '@/services/video/cost';
import type {
  PollResult,
  SubmitResult,
  VideoErrorCode,
  VideoGenRequest,
  VideoGenerationProvider,
} from './types';

const SUBMIT_URL = 'https://api.x.ai/v1/videos/generations';
const POLL_URL = 'https://api.x.ai/v1/videos/';
const MODEL = 'grok-imagine-video-1.5';
const TIMEOUT_MS = 20_000;
const MAX_REFERENCES = 14;
const BILLING_MESSAGE = 'The xAI account is out of credit. Add credits in the xAI console, then try again.';

export function buildGrokVideoBody(req: VideoGenRequest): Record<string, unknown> {
  const refs = (req.referenceImageUrls ?? []).slice(0, MAX_REFERENCES);
  const body: Record<string, unknown> = {
    model: MODEL,
    prompt: req.prompt,
    duration: req.durationSec,
    aspect_ratio: req.aspectRatio,
    resolution: refs.length > 0 ? '720p' : '1080p',
    generate_audio: false,
  };
  if (req.firstFrameUrl) body.image = { url: req.firstFrameUrl };
  if (refs.length > 0) body.reference_images = refs.map((url) => ({ url }));
  return body;
}

type Fail = { ok: false; code: VideoErrorCode; error: string };
const fail = (code: VideoErrorCode, error: string): Fail => ({ ok: false, code, error });

async function configuredKey(): Promise<string | null> {
  const key = await getXaiApiKey();
  return key && !key.startsWith('dummy') ? key : null;
}

/** One xAI call: 20 s timeout, no client signal. */
async function call(
  url: string, method: 'GET' | 'POST', key: string, body?: unknown,
): Promise<{ ok: true; json: Record<string, any> } | Fail> {
  let status: number;
  let text: string;
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = res.status;
    text = await res.text();
  } catch (err) {
    console.error('[video/grok] request failed:', err instanceof Error ? err.name : 'error');
    return fail('upstream', 'The video service could not be reached. Please try again.');
  }
  if (status < 200 || status >= 300) {
    console.error(`[video/grok] HTTP ${status}:`, text.slice(0, 500));
    // xAI reports an empty balance as a 4xx (often 403): check the body first.
    if (/credit|billing/i.test(text)) return fail('billing', BILLING_MESSAGE);
    if (status === 401 || status === 403) return fail('auth', 'The xAI key was rejected.');
    if (status === 429) return fail('rate_limit', 'The video service is rate-limited; please retry shortly.');
    return fail('upstream', 'Video generation failed. Please try again.');
  }
  try {
    const json = JSON.parse(text);
    return { ok: true, json: json && typeof json === 'object' ? json : {} };
  } catch {
    return fail('bad_response', 'The video service returned an unreadable response.');
  }
}

export class GrokProvider implements VideoGenerationProvider {
  readonly id = 'grok';
  readonly model = MODEL;

  async isConfigured(): Promise<boolean> {
    return (await configuredKey()) !== null;
  }

  estimateCostUsd(req: VideoGenRequest): number {
    return estimateCostUsd('grok', 'HERO', req.durationSec);
  }

  async submit(req: VideoGenRequest): Promise<SubmitResult> {
    const key = await configuredKey();
    if (!key) return fail('not_configured', 'Grok video generation is not configured.');
    const r = await call(SUBMIT_URL, 'POST', key, buildGrokVideoBody(req));
    if (!r.ok) return r;
    const id = r.json.request_id;
    if (typeof id !== 'string' || !id) return fail('bad_response', 'The video service returned no task id.');
    return { ok: true, providerTaskId: id, estimatedCostUsd: this.estimateCostUsd(req) };
  }

  async poll(providerTaskId: string): Promise<PollResult> {
    const key = await configuredKey();
    if (!key) return fail('not_configured', 'Grok video generation is not configured.');
    const r = await call(`${POLL_URL}${encodeURIComponent(providerTaskId)}`, 'GET', key);
    if (!r.ok) return r;
    const j = r.json;
    switch (j.status) {
      case 'done': {
        if (j.respect_moderation === false || j.video?.respect_moderation === false) {
          return {
            ok: true, state: 'failed', code: 'content_policy', billed: true,
            error: 'The clip was blocked by the provider’s content filter.',
          };
        }
        const url = j.video?.url;
        if (typeof url !== 'string' || !url) return fail('bad_response', 'The video service returned no clip.');
        return {
          ok: true, state: 'succeeded', actualCostUsd: null,
          assets: [{ kind: 'video', url, contentType: 'video/mp4' }],
        };
      }
      case 'failed': {
        const code = typeof j.error?.code === 'string' ? j.error.code : '';
        const message = typeof j.error?.message === 'string' ? j.error.message : '';
        if (message || code) console.error('[video/grok] task failed:', code, message.slice(0, 500));
        if (code === 'invalid_argument') {
          return /moderat/i.test(message)
            ? { ok: true, state: 'failed', code: 'content_policy', billed: false, error: 'The prompt was blocked by the provider’s content filter.' }
            : { ok: true, state: 'failed', code: 'bad_response', billed: false, error: 'The video service rejected the request.' };
        }
        if (code === 'permission_denied') {
          return { ok: true, state: 'failed', code: 'auth', billed: false, error: 'The xAI key was rejected.' };
        }
        return { ok: true, state: 'failed', code: 'upstream', billed: false, error: 'Video generation failed. Please try again.' };
      }
      case 'expired':
        return { ok: true, state: 'failed', code: 'upstream', billed: false, error: 'The video request expired. Please try again.' };
      case 'pending':
        return { ok: true, state: 'pending' };
      default:
        return { ok: true, state: 'running' };
    }
  }
}
