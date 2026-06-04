/** @jest-environment node */
/**
 * Tests for cover-art generation — env gate, success, error classification,
 * and the default prompt builder (which must stay apolitical).
 */

const generate = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ images: { generate } })),
}));

import { generateCoverArt, defaultCoverPrompt } from '@/services/ai/cover-art';

const original = process.env.OPENAI_API_KEY;
beforeEach(() => {
  generate.mockReset();
  process.env.OPENAI_API_KEY = 'sk-test';
});
afterAll(() => {
  process.env.OPENAI_API_KEY = original;
});

it('returns not_configured when OPENAI_API_KEY is missing', async () => {
  delete process.env.OPENAI_API_KEY;
  const r = await generateCoverArt('a cover');
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toMatch(/not configured/i);
  expect(generate).not.toHaveBeenCalled();
});

it('rejects an empty prompt', async () => {
  const r = await generateCoverArt('   ');
  expect(r.ok).toBe(false);
  expect(generate).not.toHaveBeenCalled();
});

it('returns base64 image bytes on success', async () => {
  generate.mockResolvedValueOnce({ data: [{ b64_json: 'QUJD' }] });
  const r = await generateCoverArt('a cinematic Tamil cover');
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.base64).toBe('QUJD');
});

it('classifies a 401 as an auth error without leaking the raw message', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  generate.mockRejectedValueOnce(Object.assign(new Error('401 invalid key SECRET123'), { status: 401 }));
  const r = await generateCoverArt('x');
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error).toMatch(/invalid|access/i);
    expect(r.error).not.toMatch(/SECRET123/);
  }
});

it('defaultCoverPrompt embeds the title and stays apolitical', () => {
  const p = defaultCoverPrompt('அரிதான பெரும் பாசம்', 'அன்னை');
  expect(p).toContain('அரிதான பெரும் பாசம்');
  expect(p).toContain('அன்னை');
  expect(p.toLowerCase()).toContain('apolitical');
});
