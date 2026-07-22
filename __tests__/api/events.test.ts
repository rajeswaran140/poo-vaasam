/** @jest-environment node */
/**
 * POST /api/events — the first-party analytics beacon. Validates against the
 * Zod enum, rate-limits per IP, records via the store, and never lets a write
 * failure surface to the visitor.
 */

import { NextRequest } from 'next/server';

/**
 * Rate limiting now goes through DynamoDB (SharedRateLimiter), so the store is
 * mocked with a counting fake. Without this the limiter would fall back to its
 * per-instance tier via an error path — and `.env.local` names the PRODUCTION
 * table, so an unmocked test must never be one SDK change away from writing to it.
 */
jest.mock('@/infrastructure/database/dynamodb-client', () => {
  const rows = new Map<string, number>();
  return {
    DynamoDBOperations: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: jest.fn(async ({ key, expressionAttributeValues }: any) => {
        const id = `${key.PK}|${key.SK}`;
        const count = (rows.get(id) ?? 0) + expressionAttributeValues[':one'];
        rows.set(id, count);
        return { count };
      }),
    },
  };
});

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

/**
 * Per-song attribution (2026-07-14 WhatsApp audit). The channel-keyed counter is
 * preserved exactly as it was — the existing dashboard breakdown depends on it —
 * and the per-song counter is DERIVED server-side, so the client can't write
 * arbitrary event types into the store.
 */
describe('per-song share attribution', () => {
  it('writes BOTH the channel counter and a derived per-song counter', async () => {
    recordEvent.mockResolvedValue(undefined);
    const res = await post({ type: 'share', target: 'whatsapp', songId: 'cnt_9' });
    expect(res.status).toBe(202);
    expect(recordEvent).toHaveBeenCalledWith('share', 'whatsapp'); // unchanged
    expect(recordEvent).toHaveBeenCalledWith('share_song', 'cnt_9'); // new
    expect(recordEvent).toHaveBeenCalledTimes(2);
  });

  it('derives a per-song counter for an inbound landing too', async () => {
    recordEvent.mockResolvedValue(undefined);
    await post({ type: 'inbound', target: 'whatsapp', songId: 'cnt_9' });
    expect(recordEvent).toHaveBeenCalledWith('inbound', 'whatsapp');
    expect(recordEvent).toHaveBeenCalledWith('inbound_song', 'cnt_9');
  });

  it('writes only the channel counter when no songId is supplied', async () => {
    recordEvent.mockResolvedValue(undefined);
    await post({ type: 'share', target: 'whatsapp' });
    expect(recordEvent).toHaveBeenCalledTimes(1);
    expect(recordEvent).toHaveBeenCalledWith('share', 'whatsapp');
  });

  it('ignores a songId on an event type with no per-song meaning', async () => {
    recordEvent.mockResolvedValue(undefined);
    await post({ type: 'install', songId: 'cnt_9' });
    expect(recordEvent).toHaveBeenCalledTimes(1);
    expect(recordEvent).toHaveBeenCalledWith('install', undefined);
  });

  it('refuses a client trying to write a derived counter directly', async () => {
    const res = await post({ type: 'share_song', target: 'cnt_9' });
    expect(res.status).toBe(400);
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it('still 202s when the per-song write fails but the channel write succeeded', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    recordEvent
      .mockResolvedValueOnce(undefined) // channel counter OK
      .mockRejectedValueOnce(new Error('throttled')); // per-song counter fails
    const res = await post({ type: 'share', target: 'whatsapp', songId: 'cnt_9' });
    // Losing the secondary counter must not cost us the primary one, and must
    // never surface to the visitor.
    expect(res.status).toBe(202);
  });
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
