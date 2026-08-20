/** @jest-environment node */
/**
 * EventSub signature verification + replay protection.
 *
 * These are the security boundary of the whole integration: the webhook is
 * public and unauthenticated, so the HMAC is the only thing standing between
 * Twitch and anyone who knows the URL.
 */

import crypto from 'crypto';
import {
  REPLAY_WINDOW_MS,
  computeEventSubSignature,
  isTimestampFresh,
  verifyEventSubSignature,
} from '@/lib/twitch/signature';

const SECRET = 'a-test-eventsub-secret-value';
const MESSAGE_ID = 'e76c6bd4-55c9-4987-8304-da1588d8988b';
const TIMESTAMP = '2026-08-20T12:00:00.000000000Z';
const BODY = JSON.stringify({ subscription: { id: 'sub-1' }, event: { a: 1 } });

const sign = (secret = SECRET, id = MESSAGE_ID, ts = TIMESTAMP, body = BODY) =>
  computeEventSubSignature(secret, id, ts, body);

describe('verifyEventSubSignature', () => {
  it('accepts a correctly signed message', () => {
    expect(
      verifyEventSubSignature({
        secret: SECRET,
        messageId: MESSAGE_ID,
        timestamp: TIMESTAMP,
        signature: sign(),
        rawBody: BODY,
      })
    ).toBe(true);
  });

  it('matches the documented construction: HMAC over id + timestamp + raw body', () => {
    const expected =
      'sha256=' +
      crypto
        .createHmac('sha256', SECRET)
        .update(MESSAGE_ID + TIMESTAMP + BODY)
        .digest('hex');
    expect(sign()).toBe(expected);
  });

  it('rejects a tampered body', () => {
    expect(
      verifyEventSubSignature({
        secret: SECRET,
        messageId: MESSAGE_ID,
        timestamp: TIMESTAMP,
        signature: sign(),
        rawBody: BODY.replace('"a":1', '"a":2'),
      })
    ).toBe(false);
  });

  it('rejects a signature made with a different secret', () => {
    expect(
      verifyEventSubSignature({
        secret: SECRET,
        messageId: MESSAGE_ID,
        timestamp: TIMESTAMP,
        signature: sign('someone-elses-secret'),
        rawBody: BODY,
      })
    ).toBe(false);
  });

  it('rejects a signature bound to a different message id (no cross-message replay)', () => {
    expect(
      verifyEventSubSignature({
        secret: SECRET,
        messageId: MESSAGE_ID,
        timestamp: TIMESTAMP,
        signature: sign(SECRET, 'a-different-message-id'),
        rawBody: BODY,
      })
    ).toBe(false);
  });

  it('rejects a signature bound to a different timestamp', () => {
    expect(
      verifyEventSubSignature({
        secret: SECRET,
        messageId: MESSAGE_ID,
        timestamp: TIMESTAMP,
        signature: sign(SECRET, MESSAGE_ID, '2026-08-20T13:00:00Z'),
        rawBody: BODY,
      })
    ).toBe(false);
  });

  it.each([
    ['missing signature', { signature: null }],
    ['missing message id', { messageId: null }],
    ['missing timestamp', { timestamp: null }],
    ['missing secret', { secret: '' }],
  ])('returns false rather than throwing when %s', (_label, override) => {
    expect(() =>
      verifyEventSubSignature({
        secret: SECRET,
        messageId: MESSAGE_ID,
        timestamp: TIMESTAMP,
        signature: sign(),
        rawBody: BODY,
        ...override,
      })
    ).not.toThrow();
    expect(
      verifyEventSubSignature({
        secret: SECRET,
        messageId: MESSAGE_ID,
        timestamp: TIMESTAMP,
        signature: sign(),
        rawBody: BODY,
        ...override,
      })
    ).toBe(false);
  });

  it('rejects a signature of the wrong length without throwing', () => {
    // timingSafeEqual throws on unequal lengths — the guard must catch that.
    expect(
      verifyEventSubSignature({
        secret: SECRET,
        messageId: MESSAGE_ID,
        timestamp: TIMESTAMP,
        signature: 'sha256=short',
        rawBody: BODY,
      })
    ).toBe(false);
  });
});

describe('isTimestampFresh', () => {
  const now = Date.parse('2026-08-20T12:00:00Z');

  it('accepts a message sent just now', () => {
    expect(isTimestampFresh('2026-08-20T12:00:00Z', now)).toBe(true);
  });

  it('accepts a message inside the replay window', () => {
    const recent = new Date(now - REPLAY_WINDOW_MS + 1000).toISOString();
    expect(isTimestampFresh(recent, now)).toBe(true);
  });

  it('rejects a message older than the replay window', () => {
    const old = new Date(now - REPLAY_WINDOW_MS - 1000).toISOString();
    expect(isTimestampFresh(old, now)).toBe(false);
  });

  it('rejects a far-future timestamp (clock-skew abuse)', () => {
    const future = new Date(now + REPLAY_WINDOW_MS + 1000).toISOString();
    expect(isTimestampFresh(future, now)).toBe(false);
  });

  it.each([[null], [undefined], ['not-a-date']])('rejects %p', (value) => {
    expect(isTimestampFresh(value as string | null | undefined, now)).toBe(false);
  });

  it('handles the nanosecond-precision format Twitch actually sends', () => {
    expect(isTimestampFresh('2026-08-20T12:00:00.123456789Z', now)).toBe(true);
  });
});
