import crypto from 'crypto';

// eventsub.ts imports app-access-token, which imports @aws-sdk/client-ssm.
// The AWS SDK's dist-cjs ships ESM that jest's transform can't parse in this
// project setup. Our tests don't exercise app-access-token or Twitch calls
// at all — mock the module chain up-front so the test loader stays clean.
jest.mock('@/lib/twitch/app-access-token', () => ({
  getAppAccessToken: jest.fn().mockResolvedValue('mock-app-token'),
  _paths: { token: () => '', expiresAt: () => '' },
}));

import {
  verifyEventSubSignature,
  isTimestampFresh,
  REPLAY_WINDOW_SECONDS,
  resolveEventSubCallbackUrl,
} from '@/lib/twitch/eventsub';

const SECRET = 'twitch-eventsub-test-secret';
const ORIGIN = 'https://tamilagaval.com';

function sign(messageId: string, timestamp: string, body: string, secret = SECRET): string {
  return (
    'sha256=' +
    crypto.createHmac('sha256', secret).update(messageId + timestamp + body).digest('hex')
  );
}

describe('verifyEventSubSignature', () => {
  const messageId = 'msg-abc';
  const timestamp = '2026-08-24T12:00:00.000Z';
  const body = '{"subscription":{"type":"stream.online"},"event":{}}';

  it('accepts a matching signature', () => {
    const sig = sign(messageId, timestamp, body);
    expect(
      verifyEventSubSignature({
        messageId,
        messageTimestamp: timestamp,
        rawBody: body,
        signatureHeader: sig,
        secret: SECRET,
      })
    ).toBe(true);
  });

  it('rejects a body-mutated request (this is the whole point)', () => {
    const sig = sign(messageId, timestamp, body);
    expect(
      verifyEventSubSignature({
        messageId,
        messageTimestamp: timestamp,
        rawBody: body + ' ',
        signatureHeader: sig,
        secret: SECRET,
      })
    ).toBe(false);
  });

  it('rejects with the wrong secret (secret rotation is the recovery)', () => {
    const sig = sign(messageId, timestamp, body, 'other-secret');
    expect(
      verifyEventSubSignature({
        messageId,
        messageTimestamp: timestamp,
        rawBody: body,
        signatureHeader: sig,
        secret: SECRET,
      })
    ).toBe(false);
  });

  it('rejects a signature missing the sha256= prefix', () => {
    const hex = crypto.createHmac('sha256', SECRET).update(messageId + timestamp + body).digest('hex');
    expect(
      verifyEventSubSignature({
        messageId,
        messageTimestamp: timestamp,
        rawBody: body,
        signatureHeader: hex,
        secret: SECRET,
      })
    ).toBe(false);
  });

  it('rejects a truncated or wrong-length hex', () => {
    expect(
      verifyEventSubSignature({
        messageId,
        messageTimestamp: timestamp,
        rawBody: body,
        signatureHeader: 'sha256=deadbeef',
        secret: SECRET,
      })
    ).toBe(false);
  });

  it.each([
    ['empty', ''],
    ['missing whole header', undefined as unknown as string],
    ['non-hex chars', 'sha256=zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'],
  ])('rejects a malformed header (%s)', (_label, header) => {
    expect(
      verifyEventSubSignature({
        messageId,
        messageTimestamp: timestamp,
        rawBody: body,
        signatureHeader: header as string,
        secret: SECRET,
      })
    ).toBe(false);
  });

  it('is order-sensitive on the (id + timestamp + body) concatenation', () => {
    // A signature that swaps id and timestamp order must not verify against
    // our expected order — otherwise a captured request could be replayed
    // against a different subscription.
    const wrongOrderSig =
      'sha256=' + crypto.createHmac('sha256', SECRET).update(timestamp + messageId + body).digest('hex');
    expect(
      verifyEventSubSignature({
        messageId,
        messageTimestamp: timestamp,
        rawBody: body,
        signatureHeader: wrongOrderSig,
        secret: SECRET,
      })
    ).toBe(false);
  });
});

describe('isTimestampFresh', () => {
  const now = Date.parse('2026-08-24T12:00:00.000Z');

  it('accepts a timestamp within the replay window', () => {
    expect(isTimestampFresh('2026-08-24T12:00:00.000Z', now)).toBe(true);
    expect(isTimestampFresh('2026-08-24T11:59:00.000Z', now)).toBe(true);
    expect(isTimestampFresh('2026-08-24T12:09:00.000Z', now)).toBe(true);
  });

  it('rejects a timestamp older than the replay window', () => {
    const oldMs = now - (REPLAY_WINDOW_SECONDS + 1) * 1000;
    expect(isTimestampFresh(new Date(oldMs).toISOString(), now)).toBe(false);
  });

  it('rejects a timestamp too far in the future', () => {
    const futureMs = now + (REPLAY_WINDOW_SECONDS + 1) * 1000;
    expect(isTimestampFresh(new Date(futureMs).toISOString(), now)).toBe(false);
  });

  it('rejects a malformed timestamp (defense-in-depth)', () => {
    expect(isTimestampFresh('not-a-timestamp', now)).toBe(false);
    expect(isTimestampFresh('', now)).toBe(false);
  });
});

describe('resolveEventSubCallbackUrl', () => {
  const originalEnv = process.env.TWITCH_EVENTSUB_CALLBACK_URL;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.TWITCH_EVENTSUB_CALLBACK_URL;
    else process.env.TWITCH_EVENTSUB_CALLBACK_URL = originalEnv;
  });

  it('prefers the explicit env var', () => {
    process.env.TWITCH_EVENTSUB_CALLBACK_URL = 'https://staging.tamilagaval.com/api/twitch/eventsub';
    expect(resolveEventSubCallbackUrl(ORIGIN)).toBe('https://staging.tamilagaval.com/api/twitch/eventsub');
  });

  it('falls back to the origin + path when env var is unset', () => {
    delete process.env.TWITCH_EVENTSUB_CALLBACK_URL;
    expect(resolveEventSubCallbackUrl(ORIGIN)).toBe('https://tamilagaval.com/api/twitch/eventsub');
  });
});
