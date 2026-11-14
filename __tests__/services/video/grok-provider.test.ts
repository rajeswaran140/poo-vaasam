jest.mock('@/services/video/credentials', () => ({ getXaiApiKey: jest.fn() }));

import { getXaiApiKey } from '@/services/video/credentials';
import { GrokProvider, buildGrokVideoBody } from '@/services/video/providers/grok';
import { getVideoProvider } from '@/services/video/providers';
import type { VideoGenRequest } from '@/services/video/providers/types';

const keyMock = getXaiApiKey as jest.Mock;
const fetchMock = jest.fn();

function res(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
}

const base: VideoGenRequest = { prompt: 'A slow pan', mode: 'HERO', durationSec: 6, aspectRatio: '9:16' };

beforeEach(() => {
  jest.resetAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
  keyMock.mockResolvedValue('xai-secret');
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('buildGrokVideoBody', () => {
  it('is exactly the owner format with no images', () => {
    expect(buildGrokVideoBody(base)).toEqual({
      model: 'grok-imagine-video-1.5', prompt: 'A slow pan', duration: 6,
      aspect_ratio: '9:16', resolution: '1080p', generate_audio: false,
    });
  });
  it('adds image for a first frame and keeps 1080p', () => {
    const b = buildGrokVideoBody({ ...base, firstFrameUrl: 'https://s3/f.jpg' });
    expect(b.image).toEqual({ url: 'https://s3/f.jpg' });
    expect(b.resolution).toBe('1080p');
    expect(b.reference_images).toBeUndefined();
  });
  it('adds reference_images at 720p, capped at 14', () => {
    const urls = Array.from({ length: 20 }, (_, i) => `https://s3/r${i}.jpg`);
    const b = buildGrokVideoBody({ ...base, referenceImageUrls: urls });
    expect(b.resolution).toBe('720p');
    expect(b.reference_images).toHaveLength(14);
    expect((b.reference_images as Array<{ url: string }>)[0]).toEqual({ url: 'https://s3/r0.jpg' });
  });
});

describe('GrokProvider', () => {
  const p = new GrokProvider();

  it('identity and cost', () => {
    expect(p.id).toBe('grok');
    expect(p.model).toBe('grok-imagine-video-1.5');
    // 1080p with no images: 5 × $0.25. With a first frame and 2 faces: 720p, 6 × $0.14 + 3 images × $0.01.
    expect(p.estimateCostUsd({ ...base, durationSec: 5 })).toBeCloseTo(1.25, 6);
    expect(p.estimateCostUsd({ ...base, firstFrameUrl: 'f', referenceImageUrls: ['a', 'b'] })).toBeCloseTo(0.87, 6);
  });

  it('isConfigured false for empty or dummy key', async () => {
    keyMock.mockResolvedValue('dummy-key');
    expect(await p.isConfigured()).toBe(false);
    keyMock.mockResolvedValue(null);
    expect(await p.isConfigured()).toBe(false);
    keyMock.mockResolvedValue('xai-real');
    expect(await p.isConfigured()).toBe(true);
  });

  it('submit POSTs the documented request and returns request_id', async () => {
    fetchMock.mockResolvedValue(res(200, { request_id: 'req-1' }));
    const r = await p.submit({ ...base, signal: new AbortController().signal });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.x.ai/v1/videos/generations');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers.Authorization).toBe('Bearer xai-secret');
    expect(JSON.parse(init.body)).toEqual(buildGrokVideoBody(base));
    expect(r).toEqual({ ok: true, providerTaskId: 'req-1', estimatedCostUsd: expect.closeTo(1.5) }); // 6 s at 1080p, no images
  });

  it('never forwards the client signal', async () => {
    fetchMock.mockResolvedValue(res(200, { request_id: 'req-1' }));
    const client = new AbortController();
    await p.submit({ ...base, signal: client.signal });
    const sig = fetchMock.mock.calls[0][1].signal as AbortSignal;
    client.abort();
    expect(sig.aborted).toBe(false);
  });

  it('dummy key -> not_configured with no fetch', async () => {
    keyMock.mockResolvedValue('dummy-key');
    const r = await p.submit(base);
    expect(r).toMatchObject({ ok: false, code: 'not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await p.poll('x')).toMatchObject({ ok: false, code: 'not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submit 200 without request_id -> ambiguous upstream (Grok answered OK: it may have accepted)', async () => {
    fetchMock.mockResolvedValue(res(200, {}));
    expect(await p.submit(base)).toMatchObject({ ok: false, code: 'upstream', ambiguous: true });
  });

  describe('ambiguous submit failures (Ruling V9)', () => {
    const abortErr = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    it.each([
      ['timeout', () => fetchMock.mockRejectedValue(abortErr())],
      ['AbortError', () => fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }))],
      ['network error', () => fetchMock.mockRejectedValue(new Error('ECONNRESET'))],
      ['HTTP 500', () => fetchMock.mockResolvedValue(res(500, 'boom'))],
      ['HTTP 502', () => fetchMock.mockResolvedValue(res(502, 'bad gateway'))],
      ['HTTP 503 mentioning billing', () => fetchMock.mockResolvedValue(res(503, 'billing service down'))],
      ['unreadable 2xx body', () => fetchMock.mockResolvedValue(res(200, '<html>not json'))],
      ['body read throws', () => fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => { throw new Error('reset'); } })],
    ])('%s -> { ok:false, code:upstream, ambiguous:true }', async (_n, arrange) => {
      arrange();
      const r = await p.submit(base);
      expect(r).toMatchObject({ ok: false, code: 'upstream', ambiguous: true });
    });

    it.each([
      [400, 'bad request', 'upstream'],
      [401, 'bad key', 'auth'],
      [403, 'out of credit billing', 'billing'],
      [422, 'invalid', 'upstream'],
      [429, 'slow down', 'rate_limit'],
    ])('a clean HTTP %i refusal is not ambiguous', async (status, text, code) => {
      fetchMock.mockResolvedValue(res(status, text));
      const r = await p.submit(base);
      expect(r).toMatchObject({ ok: false, code });
      expect((r as { ambiguous?: boolean }).ambiguous).toBeUndefined();
    });

    it('poll failures never carry the flag', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNRESET'));
      expect(await p.poll('a')).toEqual({ ok: false, code: 'upstream', error: expect.any(String) });
      fetchMock.mockResolvedValue(res(500, 'boom'));
      expect(await p.poll('a')).toEqual({ ok: false, code: 'upstream', error: expect.any(String) });
    });
  });

  it.each([
    [403, 'out of credit billing', 'billing'],
    [401, 'bad key secret-detail', 'auth'],
    [403, 'forbidden', 'auth'],
    [429, 'slow down', 'rate_limit'],
    [500, 'boom internal', 'upstream'],
  ])('submit HTTP %i (%s) -> %s without raw text', async (status, text, code) => {
    fetchMock.mockResolvedValue(res(status, text));
    const r = await p.submit(base);
    expect(r).toMatchObject({ ok: false, code });
    if (!r.ok) {
      expect(r.error).not.toContain('secret-detail');
      expect(r.error).not.toContain('internal');
      if (code === 'billing') {
        expect(r.error).toBe('The xAI account is out of credit. Add credits in the xAI console, then try again.');
      }
    }
  });

  it('submit network error -> upstream', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    const r = await p.submit(base);
    expect(r).toMatchObject({ ok: false, code: 'upstream' });
    if (!r.ok) expect(r.error).not.toContain('ECONNRESET');
  });

  describe('poll', () => {
    it('GETs the task URL', async () => {
      fetchMock.mockResolvedValue(res(200, { status: 'pending' }));
      await p.poll('req-9');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.x.ai/v1/videos/req-9');
      expect(init.method).toBe('GET');
      expect(init.headers.Authorization).toBe('Bearer xai-secret');
    });
    it('pending / unknown statuses', async () => {
      fetchMock.mockResolvedValue(res(200, { status: 'pending' }));
      expect(await p.poll('a')).toEqual({ ok: true, state: 'pending' });
      fetchMock.mockResolvedValue(res(200, { status: 'processing' }));
      expect(await p.poll('a')).toEqual({ ok: true, state: 'running' });
    });
    it('done -> succeeded with one video asset', async () => {
      fetchMock.mockResolvedValue(res(200, { status: 'done', video: { url: 'https://v/x.mp4' } }));
      expect(await p.poll('a')).toEqual({
        ok: true, state: 'succeeded', actualCostUsd: null,
        assets: [{ kind: 'video', url: 'https://v/x.mp4', contentType: 'video/mp4' }],
      });
    });
    it('done carries xAI\'s own charge from usage.cost_in_usd_ticks', async () => {
      fetchMock.mockResolvedValue(res(200, { status: 'done', video: { url: 'https://v/x.mp4' }, usage: { cost_in_usd_ticks: 37_600_000_000 } }));
      const r = await p.poll('a');
      expect(r).toMatchObject({ ok: true, state: 'succeeded' });
      expect((r as { actualCostUsd: number }).actualCostUsd).toBeCloseTo(3.76, 6);
      fetchMock.mockResolvedValue(res(200, { status: 'done', respect_moderation: false, video: { url: 'u' }, usage: { cost_in_usd_ticks: 1e10 } }));
      expect(await p.poll('a')).toMatchObject({ state: 'failed', billed: true, actualCostUsd: 1 });
    });
    it('done without url -> terminal billed bad_response failure', async () => {
      fetchMock.mockResolvedValue(res(200, { status: 'done' }));
      expect(await p.poll('a')).toMatchObject({ ok: true, state: 'failed', code: 'bad_response', billed: true });
    });
    it('done + respect_moderation false -> billed content_policy', async () => {
      fetchMock.mockResolvedValue(res(200, { status: 'done', respect_moderation: false, video: { url: 'u' } }));
      expect(await p.poll('a')).toMatchObject({ ok: true, state: 'failed', code: 'content_policy', billed: true });
    });
    it.each([
      [{ code: 'invalid_argument', message: 'Blocked by moderation' }, 'content_policy'],
      [{ code: 'invalid_argument', message: 'bad size' }, 'bad_response'],
      [{ code: 'failed_precondition', message: 'x' }, 'bad_response'],
      [{ code: 'permission_denied', message: 'x' }, 'auth'],
      [{ code: 'internal', message: 'x' }, 'upstream'],
    ])('failed %j -> %s, unbilled', async (error, code) => {
      fetchMock.mockResolvedValue(res(200, { status: 'failed', error }));
      const r = await p.poll('a');
      expect(r).toMatchObject({ ok: true, state: 'failed', code, billed: false });
      if (r.ok && r.state === 'failed') expect(r.error).not.toContain('bad size');
    });
    it('expired -> unbilled upstream failure', async () => {
      fetchMock.mockResolvedValue(res(200, { status: 'expired' }));
      expect(await p.poll('a')).toMatchObject({ ok: true, state: 'failed', code: 'upstream', billed: false });
    });
    it('HTTP 401 -> auth, no raw text', async () => {
      fetchMock.mockResolvedValue(res(401, 'secret-detail'));
      const r = await p.poll('a');
      expect(r).toMatchObject({ ok: false, code: 'auth' });
      if (!r.ok) expect(r.error).not.toContain('secret-detail');
    });
  });
});

describe('registry', () => {
  it('returns a GrokProvider for grok', () => {
    expect(getVideoProvider('grok')).toBeInstanceOf(GrokProvider);
  });
});

describe('720p story setting', () => {
  it('asks for 720p with no faces when the request says 720p, and prices it the same way', () => {
    const r = { ...base, firstFrameUrl: 'https://s3/f.jpg', quality: '720p' as const };
    expect(buildGrokVideoBody(r).resolution).toBe('720p');
    expect(new GrokProvider().estimateCostUsd(r)).toBeCloseTo(0.14 * 6 + 0.01, 6);
  });
  it('without it, a picture-only clip stays 1080p', () => {
    expect(buildGrokVideoBody({ ...base, quality: '1080p' }).resolution).toBe('1080p');
  });
});
