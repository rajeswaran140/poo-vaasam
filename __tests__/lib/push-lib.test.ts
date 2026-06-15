/** @jest-environment node */
import { pushSubscriptionSchema, subscriptionId } from '@/lib/push-store';
import { urlBase64ToUint8Array } from '@/lib/push-client';

describe('pushSubscriptionSchema', () => {
  const valid = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'BPxxx', auth: 'aaa' } };
  it('accepts a valid https subscription', () => {
    expect(pushSubscriptionSchema.safeParse(valid).success).toBe(true);
  });
  it('rejects non-https endpoint, empty keys, missing keys', () => {
    expect(pushSubscriptionSchema.safeParse({ ...valid, endpoint: 'http://x' }).success).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ endpoint: valid.endpoint, keys: { p256dh: '', auth: 'a' } }).success).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ endpoint: valid.endpoint }).success).toBe(false);
  });
});

describe('subscriptionId', () => {
  it('is a stable sha256 hex, distinct per endpoint', () => {
    expect(subscriptionId('https://a')).toBe(subscriptionId('https://a'));
    expect(subscriptionId('https://a')).not.toBe(subscriptionId('https://b'));
    expect(subscriptionId('https://a')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('urlBase64ToUint8Array', () => {
  it('decodes standard base64 to bytes', () => {
    expect(Array.from(urlBase64ToUint8Array('AAAA'))).toEqual([0, 0, 0]);
  });
  it('handles url-safe chars (-, _) and missing padding', () => {
    const out = urlBase64ToUint8Array('-_-_');
    expect(out.length).toBe(3); // 4 b64 chars → 3 bytes
    expect(out).toBeInstanceOf(Uint8Array);
  });
});
