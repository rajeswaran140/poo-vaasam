/** @jest-environment node */
jest.mock('web-push', () => ({
  __esModule: true,
  default: { setVapidDetails: jest.fn(), sendNotification: jest.fn() },
}));
jest.mock('@/lib/push-store', () => ({
  listPushSubscriptions: jest.fn(),
  deletePushSubscription: jest.fn(),
}));

import { broadcastPush, isExpiredPushError } from '@/lib/push-broadcast';
import webpush from 'web-push';
import * as store from '@/lib/push-store';

/* eslint-disable @typescript-eslint/no-explicit-any */
const sendMock = (webpush as any).sendNotification as jest.Mock;
/* eslint-enable @typescript-eslint/no-explicit-any */
const listMock = store.listPushSubscriptions as jest.Mock;
const delMock = store.deletePushSubscription as jest.Mock;

beforeEach(() => {
  process.env.VAPID_PUBLIC_KEY = 'pub';
  process.env.VAPID_PRIVATE_KEY = 'priv';
  process.env.VAPID_SUBJECT = 'mailto:x@y.z';
  sendMock.mockReset();
  listMock.mockReset();
  delMock.mockReset().mockResolvedValue(undefined);
});

describe('isExpiredPushError', () => {
  it('treats only 404/410 as expired', () => {
    expect(isExpiredPushError(404)).toBe(true);
    expect(isExpiredPushError(410)).toBe(true);
    expect(isExpiredPushError(500)).toBe(false);
    expect(isExpiredPushError(undefined)).toBe(false);
  });
});

describe('broadcastPush', () => {
  const subs = [
    { endpoint: 'https://a', keys: { p256dh: 'p', auth: 'a' } },
    { endpoint: 'https://gone', keys: { p256dh: 'p', auth: 'a' } },
    { endpoint: 'https://err', keys: { p256dh: 'p', auth: 'a' } },
  ];

  it('sends to all, prunes the 410, counts the non-expired failure', async () => {
    listMock.mockResolvedValue(subs);
    sendMock.mockImplementation((sub: { endpoint: string }) => {
      if (sub.endpoint === 'https://gone') return Promise.reject({ statusCode: 410 });
      if (sub.endpoint === 'https://err') return Promise.reject({ statusCode: 500 });
      return Promise.resolve();
    });

    const r = await broadcastPush({ title: 'T', body: 'B' });
    expect(r).toEqual({ total: 3, sent: 1, pruned: 1, failed: 1 });
    expect(delMock).toHaveBeenCalledWith('https://gone');
    expect(delMock).not.toHaveBeenCalledWith('https://err'); // a transient failure is NOT pruned
  });

  it('returns zeros and sends nothing when there are no subscribers', async () => {
    listMock.mockResolvedValue([]);
    const r = await broadcastPush({ title: 'T', body: 'B' });
    expect(r).toEqual({ total: 0, sent: 0, pruned: 0, failed: 0 });
    expect(sendMock).not.toHaveBeenCalled();
  });
});
