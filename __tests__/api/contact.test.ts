/** @jest-environment node */
/**
 * INTEGRATION TESTS — POST /api/contact (public, anonymous path).
 * Covers validation, the honeypot silent-discard, storage shape, bad JSON,
 * and the per-IP rate limit.
 */
import { NextRequest } from 'next/server';

const mockPut = jest.fn();
jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: { put: (...args: unknown[]) => mockPut(...args) },
  handleDynamoDBError: jest.fn(),
}));

import { POST } from '@/app/api/contact/route';

const post = (body: unknown, ip = '9.9.9.9') =>
  POST(
    new NextRequest('https://tamilagaval.com/api/contact', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  );

const valid = { name: 'Raj', email: 'a@b.com', message: 'Hello there' };

beforeEach(() => {
  jest.clearAllMocks();
  mockPut.mockResolvedValue({});
});

it('stores a valid submission (201) with the CONTACT# key + NEW status', async () => {
  const res = await post(valid, '10.0.0.1');
  const body = await res.json();
  expect(res.status).toBe(201);
  expect(body.success).toBe(true);
  expect(mockPut).toHaveBeenCalledTimes(1);
  const item = mockPut.mock.calls[0][0];
  expect(item.PK).toMatch(/^CONTACT#/);
  expect(item.status).toBe('NEW');
  expect(item.email).toBe('a@b.com');
});

it('rejects missing required fields (400) and stores nothing', async () => {
  const res = await post({ name: 'Raj', email: 'a@b.com' }, '10.0.0.2'); // no message
  expect(res.status).toBe(400);
  expect(mockPut).not.toHaveBeenCalled();
});

it('rejects an invalid email (400)', async () => {
  const res = await post({ ...valid, email: 'not-an-email' }, '10.0.0.3');
  expect(res.status).toBe(400);
  expect(mockPut).not.toHaveBeenCalled();
});

it('silently discards a honeypot hit (200) without storing', async () => {
  const res = await post({ ...valid, company: 'bot-filled-this' }, '10.0.0.4');
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.success).toBe(true); // looks like success to the bot
  expect(mockPut).not.toHaveBeenCalled();
});

it('rejects a malformed JSON body (400)', async () => {
  const res = await post('{ not valid json', '10.0.0.5');
  expect(res.status).toBe(400);
});

it('rate-limits a flooding IP (429 after 5/min)', async () => {
  const ip = '203.0.113.7';
  for (let i = 0; i < 5; i++) {
    expect((await post(valid, ip)).status).toBe(201);
  }
  const sixth = await post(valid, ip);
  expect(sixth.status).toBe(429);
});
