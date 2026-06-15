/** @jest-environment node */
import { NextRequest } from 'next/server';

jest.mock('@/lib/push-store', () => ({
  ...jest.requireActual('@/lib/push-store'),
  savePushSubscription: jest.fn(),
}));

import { POST } from '@/app/api/push/subscribe/route';
import * as store from '@/lib/push-store';

const saveMock = store.savePushSubscription as jest.Mock;
const valid = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'p', auth: 'a' } };

function post(body: unknown, ip = `10.5.0.${Math.floor(Math.random() * 250) + 1}`, raw?: string) {
  return POST(
    new NextRequest(new Request('http://localhost/api/push/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, 'user-agent': 'jest' },
      body: raw ?? JSON.stringify(body),
    }))
  );
}

beforeEach(() => saveMock.mockReset());

it('201 stores a valid subscription', async () => {
  saveMock.mockResolvedValueOnce(undefined);
  const res = await post(valid);
  expect(res.status).toBe(201);
  expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({ endpoint: valid.endpoint }), 'jest');
});

it('400 on an invalid subscription', async () => {
  const res = await post({ endpoint: 'http://insecure', keys: { p256dh: 'p', auth: 'a' } });
  expect(res.status).toBe(400);
  expect(saveMock).not.toHaveBeenCalled();
});

it('400 on malformed JSON', async () => {
  const res = await post(undefined, undefined, '{bad');
  expect(res.status).toBe(400);
});

it('rate-limits a single IP (429 after the cap)', async () => {
  saveMock.mockResolvedValue(undefined);
  const ip = '203.0.113.50';
  let last = 201;
  for (let i = 0; i < 21; i++) last = (await post(valid, ip)).status; // cap 20/min
  expect(last).toBe(429);
});
