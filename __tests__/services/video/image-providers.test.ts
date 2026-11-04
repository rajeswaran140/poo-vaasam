jest.mock('@/services/video/credentials', () => ({ getXaiApiKey: jest.fn() }));
jest.mock('@/services/ai/cover-art', () => ({ generateCoverArt: jest.fn() }));

import { getXaiApiKey } from '@/services/video/credentials';
import { generateCoverArt } from '@/services/ai/cover-art';
import { generateStillImage } from '@/services/video/image-providers';

const keyMock = getXaiApiKey as jest.Mock;
const coverMock = generateCoverArt as jest.Mock;
const fetchMock = jest.fn();
const B64 = Buffer.from('jpeg-bytes').toString('base64');

function res(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
}

beforeEach(() => {
  jest.resetAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
  keyMock.mockResolvedValue('xai-secret');
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('generateStillImage grok-image', () => {
  it('sends the documented request and decodes the image', async () => {
    fetchMock.mockResolvedValue(res(200, { data: [{ b64_json: B64 }] }));
    const r = await generateStillImage({ prompt: 'Scene 1', aspectRatio: '9:16' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.x.ai/v1/images/generations');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer xai-secret');
    expect(JSON.parse(init.body)).toEqual({
      model: 'grok-imagine-image', prompt: 'Scene 1', n: 1, aspect_ratio: '9:16', response_format: 'b64_json',
    });
    expect(init.signal).toBeDefined();
    expect(r).toEqual({ ok: true, bytes: Buffer.from('jpeg-bytes'), contentType: 'image/jpeg', billed: true });
  });

  it('maps respect_moderation=false (top level or on data[0]) to billed content_policy', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { respect_moderation: false, data: [{}] }));
    fetchMock.mockResolvedValueOnce(res(200, { data: [{ respect_moderation: false }] }));
    for (let i = 0; i < 2; i++) {
      const r = await generateStillImage({ prompt: 'p', aspectRatio: '16:9' });
      expect(r).toMatchObject({ ok: false, code: 'content_policy', billed: true });
    }
  });

  it('maps 401 to auth without leaking upstream text', async () => {
    fetchMock.mockResolvedValue(res(401, 'RAW-UPSTREAM-SECRET-TEXT'));
    const r = await generateStillImage({ prompt: 'p', aspectRatio: '16:9' });
    expect(r).toMatchObject({ ok: false, code: 'auth', billed: false });
    expect(JSON.stringify(r)).not.toContain('RAW-UPSTREAM');
  });

  it('maps 403 to auth and 429 to rate_limit', async () => {
    fetchMock.mockResolvedValueOnce(res(403, 'nope'));
    fetchMock.mockResolvedValueOnce(res(429, 'slow'));
    expect(await generateStillImage({ prompt: 'p', aspectRatio: '16:9' })).toMatchObject({ code: 'auth' });
    expect(await generateStillImage({ prompt: 'p', aspectRatio: '16:9' })).toMatchObject({ code: 'rate_limit' });
  });

  it('maps a credits/billing body to billing with fixed copy', async () => {
    fetchMock.mockResolvedValue(res(403, { error: 'Your team has no credits or licenses' }));
    const r = await generateStillImage({ prompt: 'p', aspectRatio: '16:9' });
    expect(r).toEqual({
      ok: false, code: 'billing', billed: false,
      error: 'The xAI account is out of credit. Add credits in the xAI console, then try again.',
    });
  });

  it('maps other HTTP errors and network failures to upstream', async () => {
    fetchMock.mockResolvedValueOnce(res(500, 'boom'));
    fetchMock.mockRejectedValueOnce(new Error('socket hang up'));
    expect(await generateStillImage({ prompt: 'p', aspectRatio: '16:9' })).toMatchObject({ code: 'upstream', billed: false });
    expect(await generateStillImage({ prompt: 'p', aspectRatio: '16:9' })).toMatchObject({ code: 'upstream', billed: false });
  });

  it('maps missing or malformed data to bad_response', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { data: [] }));
    fetchMock.mockResolvedValueOnce(res(200, 'not json'));
    expect(await generateStillImage({ prompt: 'p', aspectRatio: '16:9' })).toMatchObject({ code: 'bad_response' });
    expect(await generateStillImage({ prompt: 'p', aspectRatio: '16:9' })).toMatchObject({ code: 'bad_response' });
  });

  it('returns not_configured without calling fetch when there is no key', async () => {
    keyMock.mockResolvedValue(null);
    const r = await generateStillImage({ prompt: 'p', aspectRatio: '16:9' });
    expect(r).toMatchObject({ ok: false, code: 'not_configured', billed: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('generateStillImage openai-image', () => {
  it('refuses 9:16 without calling generateCoverArt or fetch', async () => {
    const r = await generateStillImage({ providerId: 'openai-image', prompt: 'p', aspectRatio: '9:16' });
    expect(r).toEqual({ ok: false, code: 'bad_response', error: 'OpenAI stills are landscape only', billed: false });
    expect(coverMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('wraps generateCoverArt PNG output for 16:9', async () => {
    coverMock.mockResolvedValue({ ok: true, base64: B64 });
    const r = await generateStillImage({ providerId: 'openai-image', prompt: 'p', aspectRatio: '16:9' });
    expect(coverMock).toHaveBeenCalledWith('p');
    expect(r).toEqual({ ok: true, bytes: Buffer.from('jpeg-bytes'), contentType: 'image/png', billed: true });
  });

  it('maps a generateCoverArt failure to upstream', async () => {
    coverMock.mockResolvedValue({ ok: false, error: 'Image generation failed. Please try again.' });
    const r = await generateStillImage({ providerId: 'openai-image', prompt: 'p', aspectRatio: '16:9' });
    expect(r).toMatchObject({ ok: false, code: 'upstream', billed: false });
  });
});
