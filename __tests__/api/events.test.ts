/** @jest-environment node */
/**
 * POST /api/events — the first-party analytics beacon. Validates against the
 * Zod enum, rate-limits per IP, records via the store, and never lets a write
 * failure surface to the visitor.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/analytics-store', () => {
  const recordEvent = jest.fn();
  return { recordEvent, __recordEvent: recordEvent };
});

import { POST } from '@/app/api/events/route';

const storeMock = jest.requireMock('@/lib/analytics-store') as Record<string, jest.Mock>;
const recordEvent = storeMock.__recordEvent;

// Distinct IP per test so the module-level limiter doesn't bleed across tests.
function post(body: unknown, ip = `10.1.0.${Math.floor(Math.random() * 250) + 1}`, raw?: string) {
  return POST(
    new NextRequest(new Request('http://localhost/api/events', {
      method: 'POST',
      headers: { 'x-forwarded-for': ip, 'content-type': 'application/json' },
      body: raw ?? JSON.stringify(body),
    }))
  );
}

beforeEach(() => recordEvent.mockReset());

it('records a valid event and returns 202', async () => {
  recordEvent.mockResolvedValueOnce(undefined);
  const res = await post({ type: 'share', target: 'whatsapp' });
  expect(res.status).toBe(202);
  expect(await res.json()).toEqual({ success: true });
  expect(recordEvent).toHaveBeenCalledWith('share', 'whatsapp');
});

it('accepts an event with no target', async () => {
  recordEvent.mockResolvedValueOnce(undefined);
  const res = await post({ type: 'install' });
  expect(res.status).toBe(202);
  expect(recordEvent).toHaveBeenCalledWith('install', undefined);
});

it('rejects an unknown event type with 400 and never records', async () => {
  const res = await post({ type: 'exfiltrate', target: 'x' });
  expect(res.status).toBe(400);
  expect(recordEvent).not.toHaveBeenCalled();
});

it('rejects malformed JSON with 400', async () => {
  const res = await post(undefined, undefined, '{not json');
  expect(res.status).toBe(400);
  expect(recordEvent).not.toHaveBeenCalled();
});

it('never breaks the page on a store error (500, no throw)', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  recordEvent.mockRejectedValueOnce(new Error('ProvisionedThroughputExceeded'));
  const res = await post({ type: 'play', target: 'song:a' });
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ success: false });
});

it('rate-limits a single IP hammering the beacon (429 after the cap)', async () => {
  recordEvent.mockResolvedValue(undefined);
  const ip = '203.0.113.42';
  let last = 202;
  // Limit is 120/min; the 121st from the same IP must be throttled.
  for (let i = 0; i < 121; i++) {
    last = (await post({ type: 'play', target: 'song:x' }, ip)).status;
  }
  expect(last).toBe(429);
});
