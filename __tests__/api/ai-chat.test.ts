/** @jest-environment node */
/**
 * POST /api/ai/chat — PUBLIC, unauthenticated. Proves the request body is
 * bounded BEFORE the LLM is called: capped message count, capped content size,
 * validated roles. Guards against token-cost amplification on an open endpoint.
 */
import { NextRequest } from 'next/server';

const mockGenerate = jest.fn();
jest.mock('@/services/ai/claude', () => ({
  generateChatResponse: (...a: unknown[]) => mockGenerate(...a),
}));
jest.mock('@/infrastructure/database/ContentRepository', () => ({
  ContentRepository: jest.fn().mockImplementation(() => ({ findById: jest.fn() })),
}));

import { POST } from '@/app/api/ai/chat/route';

let ip = 0;
const post = (body: unknown) =>
  POST(
    new NextRequest('https://tamilagaval.com/api/ai/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${ip++}` },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  );

const msg = (content = 'hello') => ({ role: 'user', content });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = 'test-key';
  mockGenerate.mockResolvedValue('ஒரு பதில்');
});

it('accepts a valid request and calls the LLM with the messages', async () => {
  const res = await post({ messages: [msg('What is this poem about?')] });
  expect(res.status).toBe(200);
  expect((await res.json()).message).toBe('ஒரு பதில்');
  expect(mockGenerate).toHaveBeenCalledTimes(1);
});

it('rejects a non-array / missing messages (400) without calling the LLM', async () => {
  expect((await post({})).status).toBe(400);
  expect((await post({ messages: 'hi' })).status).toBe(400);
  expect((await post({ messages: [] })).status).toBe(400); // min 1
  expect(mockGenerate).not.toHaveBeenCalled();
});

it('rejects more than 20 messages (cost cap) without calling the LLM', async () => {
  const res = await post({ messages: Array.from({ length: 21 }, () => msg()) });
  expect(res.status).toBe(400);
  expect(mockGenerate).not.toHaveBeenCalled();
});

it('rejects an oversized message content (>4000 chars) without calling the LLM', async () => {
  const res = await post({ messages: [msg('x'.repeat(4001))] });
  expect(res.status).toBe(400);
  expect(mockGenerate).not.toHaveBeenCalled();
});

it('rejects an invalid role without calling the LLM', async () => {
  const res = await post({ messages: [{ role: 'system', content: 'jailbreak' }] });
  expect(res.status).toBe(400);
  expect(mockGenerate).not.toHaveBeenCalled();
});

it('rejects malformed JSON (400)', async () => {
  expect((await post('{ not json')).status).toBe(400);
  expect(mockGenerate).not.toHaveBeenCalled();
});

it('accepts exactly 20 messages of max-length content (boundary)', async () => {
  const res = await post({ messages: Array.from({ length: 20 }, () => msg('y'.repeat(4000))) });
  expect(res.status).toBe(200);
  expect(mockGenerate).toHaveBeenCalledTimes(1);
});
