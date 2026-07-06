/** @jest-environment node */
/**
 * INTEGRATION TESTS — POST /api/stories (public "Share Your Story", anon path).
 * Covers validation, the too-short guard, honeypot silent-discard, the STORY#
 * storage shape, the optional subscriber lead, and best-effort lead failure.
 */
import { NextRequest } from 'next/server';

const mockPut = jest.fn();
jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: { put: (...args: unknown[]) => mockPut(...args) },
  handleDynamoDBError: jest.fn(),
}));

import { POST } from '@/app/api/stories/route';

const post = (body: unknown, ip = '9.9.9.9') =>
  POST(
    new NextRequest('https://tamilagaval.com/api/stories', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  );

const valid = { name: 'Raj', theme: 'mother', story: 'Amma sang this to me every night.' };

beforeEach(() => {
  jest.clearAllMocks();
  mockPut.mockResolvedValue({});
});

it('stores a valid story (201) with the STORY# key + NEW status + share-page source', async () => {
  const res = await post(valid, '10.0.0.1');
  const body = await res.json();
  expect(res.status).toBe(201);
  expect(body.success).toBe(true);
  expect(mockPut).toHaveBeenCalledTimes(1); // no email → no subscriber lead
  const item = mockPut.mock.calls[0][0];
  expect(item.PK).toMatch(/^STORY#story_/);
  expect(item.SK).toBe('METADATA');
  expect(item.entityType).toBe('STORY');
  expect(item.status).toBe('NEW');
  expect(item.theme).toBe('mother');
  expect(item.source).toBe('share-page');
  expect(item.featureConsent).toBe(false); // defaulted
  expect(item.createdAt).toBeTruthy();
});

it('also captures a SUBSCRIBER lead when an email is given (source story-campaign)', async () => {
  const res = await post({ ...valid, email: 'Fan@Example.com', featureConsent: true }, '10.0.0.2');
  expect(res.status).toBe(201);
  expect(mockPut).toHaveBeenCalledTimes(2);
  const story = mockPut.mock.calls[0][0];
  const lead = mockPut.mock.calls[1][0];
  expect(story.featureConsent).toBe(true);
  expect(story.email).toBe('Fan@Example.com');
  expect(lead.PK).toBe('SUBSCRIBER#Fan@Example.com');
  expect(lead.entityType).toBe('SUBSCRIBER');
  expect(lead.source).toBe('story-campaign');
  expect(lead.status).toBe('SUBSCRIBED');
});

it('still returns 201 when the subscriber lead fails (story already saved)', async () => {
  mockPut
    .mockResolvedValueOnce({}) // story put succeeds
    .mockRejectedValueOnce(new Error('lead write failed')); // lead put fails
  const res = await post({ ...valid, email: 'fan@example.com' }, '10.0.0.3');
  expect(res.status).toBe(201);
  expect(mockPut).toHaveBeenCalledTimes(2);
});

it('silently discards a honeypot hit (200) without storing', async () => {
  const res = await post({ ...valid, company: 'bot-filled-this' }, '10.0.0.4');
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.success).toBe(true); // looks like success to the bot
  expect(mockPut).not.toHaveBeenCalled();
});

it('rejects missing required fields (400) and stores nothing', async () => {
  const res = await post({ name: 'Raj', theme: 'mother' }, '10.0.0.5'); // no story
  expect(res.status).toBe(400);
  expect(mockPut).not.toHaveBeenCalled();
});

it('rejects a too-short story (400)', async () => {
  const res = await post({ ...valid, story: 'hi' }, '10.0.0.6');
  expect(res.status).toBe(400);
  expect(mockPut).not.toHaveBeenCalled();
});

it('rejects an unknown theme (400)', async () => {
  const res = await post({ ...valid, theme: 'politics' }, '10.0.0.7');
  expect(res.status).toBe(400);
  expect(mockPut).not.toHaveBeenCalled();
});

it('rejects an invalid email when one is supplied (400)', async () => {
  const res = await post({ ...valid, email: 'not-an-email' }, '10.0.0.8');
  expect(res.status).toBe(400);
  expect(mockPut).not.toHaveBeenCalled();
});

it('treats an empty email string as absent — no subscriber lead', async () => {
  const res = await post({ ...valid, email: '' }, '10.0.0.9');
  expect(res.status).toBe(201);
  expect(mockPut).toHaveBeenCalledTimes(1);
});

it('rejects a malformed JSON body (400)', async () => {
  const res = await post('{ not valid json', '10.0.0.10');
  expect(res.status).toBe(400);
});

it('rate-limits a flooding IP (429 after 5/min)', async () => {
  const ip = '203.0.113.9';
  for (let i = 0; i < 5; i++) {
    expect((await post(valid, ip)).status).toBe(201);
  }
  const sixth = await post(valid, ip);
  expect(sixth.status).toBe(429);
});
