/** @jest-environment node */
/**
 * POST /api/ai/analyze-poem — the `degraded` flag: when the LLM path fails, the
 * route still returns a usable default analysis but marks it `degraded: true`
 * so a real outage is distinguishable from a genuine "sad" classification.
 */
import { NextRequest } from 'next/server';

const mockCreate = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: (...a: unknown[]) => mockCreate(...a) } },
  })),
}));

import { POST } from '@/app/api/ai/analyze-poem/route';

let ip = 0;
const post = (body: unknown) =>
  POST(
    new NextRequest('https://tamilagaval.com/api/ai/analyze-poem', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.2.0.${ip++}` },
      body: JSON.stringify(body),
    })
  );

const poem = { title: 'ஒரு கவிதை', body: 'சில வரிகள்' };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  process.env.OPENAI_API_KEY = 'sk-real-looking-key';
});

it('400s when title/body are missing', async () => {
  expect((await post({ title: 'x' })).status).toBe(400);
});

it('flags degraded:true when the LLM call throws (still 200 + usable analysis)', async () => {
  mockCreate.mockRejectedValueOnce(new Error('openai down'));
  const res = await post(poem);
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.success).toBe(true);
  expect(json.degraded).toBe(true);
  expect(json.analysis.emotion).toBeDefined();
});

it('flags degraded:true when the model returns unparseable content', async () => {
  mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: 'not json at all' } }] });
  const json = await (await post(poem)).json();
  expect(json.success).toBe(true);
  expect(json.degraded).toBe(true);
});

it('uses the cheap gpt-4o-mini model with JSON mode (guards against a gpt-4 regression)', async () => {
  mockCreate.mockResolvedValueOnce({
    choices: [{ message: { content: JSON.stringify({ emotion: 'reflective', mood: 'gentle' }) } }],
  });
  await post(poem);
  expect(mockCreate).toHaveBeenCalledWith(
    expect.objectContaining({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
    })
  );
});
