/** @jest-environment node */
/**
 * POST /api/tts/synthesize — input validation + the error-masking fix:
 * internal failure detail must NOT leak to the client (no `details` field).
 */
import { NextRequest } from 'next/server';

const mockGen = jest.fn();
const mockEst = jest.fn((..._a: unknown[]) => 10);
jest.mock('@/services/ai/google-tts', () => ({
  generatePoemAudio: (...a: unknown[]) => mockGen(...a),
  estimateAudioDuration: (...a: unknown[]) => mockEst(...a),
}));

import { POST } from '@/app/api/tts/synthesize/route';

let ip = 0;
const post = (body: unknown) =>
  POST(
    new NextRequest('https://tamilagaval.com/api/tts/synthesize', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.1.0.${ip++}` },
      body: JSON.stringify(body),
    })
  );

beforeEach(() => {
  jest.clearAllMocks();
  process.env.GOOGLE_TTS_CREDENTIALS_BASE64 = 'dGVzdA==';
});

it('400s when text is missing', async () => {
  expect((await post({})).status).toBe(400);
  expect(mockGen).not.toHaveBeenCalled();
});

it('400s when text exceeds 5000 chars', async () => {
  expect((await post({ text: 'a'.repeat(5001) })).status).toBe(400);
  expect(mockGen).not.toHaveBeenCalled();
});

it('masks the internal error detail on failure (500, no leak)', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockGen.mockRejectedValueOnce(new Error('google creds invalid: SUPER_SECRET_DETAIL'));
  const res = await post({ text: 'வணக்கம்' });
  expect(res.status).toBe(500);
  const body = await res.json();
  expect(body.error).toBe('Failed to generate audio');
  expect(body.details).toBeUndefined(); // the old leak is gone
  expect(JSON.stringify(body)).not.toMatch(/SUPER_SECRET_DETAIL/);
});
