/** @jest-environment node */
/**
 * POST /api/twitch/eventsub — the public webhook.
 *
 * Covers the whole transport contract: signature rejection, replay rejection,
 * the verification challenge's exact response requirements, duplicate
 * suppression, revocation, and the one case where a 5xx is CORRECT (a storage
 * failure, so Twitch retries).
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/rate-limit', () => ({
  ...jest.requireActual('@/lib/rate-limit'),
  checkRateLimit: jest.fn(),
}));

jest.mock('@/infrastructure/database/TwitchEventRepository', () => ({
  TwitchEventRepository: jest.fn(),
  rawEventExpiry: () => 1_800_000_000,
}));

jest.mock('@/infrastructure/database/TwitchConnectionRepository', () => ({
  TwitchConnectionRepository: jest.fn(),
}));

jest.mock('@/application/use-cases/ProcessTwitchEvent', () => ({
  processTwitchEvent: jest.fn(),
}));

import { POST } from '@/app/api/twitch/eventsub/route';
import { checkRateLimit } from '@/lib/rate-limit';
import { TwitchEventRepository } from '@/infrastructure/database/TwitchEventRepository';
import { TwitchConnectionRepository } from '@/infrastructure/database/TwitchConnectionRepository';
import { processTwitchEvent } from '@/application/use-cases/ProcessTwitchEvent';
import { computeEventSubSignature } from '@/lib/twitch/signature';

const SECRET = 'test-eventsub-secret';
const recordIfNew = jest.fn();
const markSubscriptionStatus = jest.fn();
const setStatus = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  process.env.TWITCH_CLIENT_ID = 'id';
  process.env.TWITCH_CLIENT_SECRET = 'secret';
  process.env.TWITCH_EVENTSUB_SECRET = SECRET;
  process.env.TWITCH_REDIRECT_URI = 'https://tamilagaval.com/api/twitch/callback';
  process.env.TWITCH_EVENTSUB_CALLBACK_URL = 'https://tamilagaval.com/api/twitch/eventsub';

  (checkRateLimit as jest.Mock).mockResolvedValue({ allowed: true });
  recordIfNew.mockResolvedValue(true);
  (TwitchEventRepository as unknown as jest.Mock).mockImplementation(() => ({ recordIfNew }));
  (TwitchConnectionRepository as unknown as jest.Mock).mockImplementation(() => ({
    markSubscriptionStatus,
    setStatus,
  }));
  (processTwitchEvent as jest.Mock).mockResolvedValue('session_opened');
});

const NOTIFICATION_BODY = JSON.stringify({
  subscription: { id: 'sub-1', type: 'stream.online', version: '1', status: 'enabled' },
  event: {
    id: 'stream-9001',
    broadcaster_user_id: '99',
    broadcaster_user_login: 'tamilagaval',
    broadcaster_user_name: 'TamilAgaval',
    type: 'live',
    started_at: '2026-08-20T12:00:00Z',
  },
});

function makeRequest(opts: {
  body: string;
  messageType?: string;
  messageId?: string;
  timestamp?: string;
  signature?: string;
  secret?: string;
}) {
  const messageId = opts.messageId ?? 'msg-1';
  const timestamp = opts.timestamp ?? new Date().toISOString();
  const signature =
    opts.signature ??
    computeEventSubSignature(opts.secret ?? SECRET, messageId, timestamp, opts.body);

  return new NextRequest('https://tamilagaval.com/api/twitch/eventsub', {
    method: 'POST',
    headers: {
      'twitch-eventsub-message-id': messageId,
      'twitch-eventsub-message-timestamp': timestamp,
      'twitch-eventsub-message-signature': signature,
      'twitch-eventsub-message-type': opts.messageType ?? 'notification',
      'content-type': 'application/json',
    },
    body: opts.body,
  });
}

describe('signature enforcement', () => {
  it('rejects a message signed with the wrong secret', async () => {
    const res = await POST(makeRequest({ body: NOTIFICATION_BODY, secret: 'wrong-secret' }));
    expect(res.status).toBe(403);
    expect(recordIfNew).not.toHaveBeenCalled();
    expect(processTwitchEvent).not.toHaveBeenCalled();
  });

  it('rejects a message with no signature header at all', async () => {
    const req = new NextRequest('https://tamilagaval.com/api/twitch/eventsub', {
      method: 'POST',
      headers: { 'twitch-eventsub-message-type': 'notification' },
      body: NOTIFICATION_BODY,
    });
    expect((await POST(req)).status).toBe(403);
    expect(recordIfNew).not.toHaveBeenCalled();
  });

  it('rejects a body altered after signing', async () => {
    const messageId = 'msg-1';
    const timestamp = new Date().toISOString();
    const signature = computeEventSubSignature(SECRET, messageId, timestamp, NOTIFICATION_BODY);
    const res = await POST(
      makeRequest({
        body: NOTIFICATION_BODY.replace('tamilagaval', 'attacker'),
        messageId,
        timestamp,
        signature,
      })
    );
    expect(res.status).toBe(403);
  });

  it('rejects a correctly signed but STALE message (replay)', async () => {
    const old = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const res = await POST(makeRequest({ body: NOTIFICATION_BODY, timestamp: old }));
    expect(res.status).toBe(403);
    expect(recordIfNew).not.toHaveBeenCalled();
  });
});

describe('webhook_callback_verification', () => {
  it('answers 200 with the raw challenge as text/plain', async () => {
    const body = JSON.stringify({
      subscription: {
        id: 'sub-1',
        type: 'stream.online',
        version: '1',
        status: 'webhook_callback_verification_pending',
      },
      challenge: 'pink-fluffy-unicorns',
    });

    const res = await POST(makeRequest({ body, messageType: 'webhook_callback_verification' }));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    // The body must be ONLY the challenge — not JSON-wrapped.
    expect(await res.text()).toBe('pink-fluffy-unicorns');
  });

  it('does not record a challenge as an event', async () => {
    const body = JSON.stringify({
      subscription: { id: 'sub-1', type: 'stream.online', version: '1', status: 'pending' },
      challenge: 'abc',
    });
    await POST(makeRequest({ body, messageType: 'webhook_callback_verification' }));
    expect(recordIfNew).not.toHaveBeenCalled();
  });
});

describe('notifications', () => {
  it('records and processes a first-time stream.online', async () => {
    const res = await POST(makeRequest({ body: NOTIFICATION_BODY }));

    expect(res.status).toBe(200);
    expect(recordIfNew).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'msg-1',
        eventType: 'stream.online',
        broadcasterId: '99',
      })
    );
    expect(processTwitchEvent).toHaveBeenCalledWith(
      'tamilagaval',
      expect.objectContaining({ kind: 'stream.online', streamId: 'stream-9001' })
    );
  });

  it('suppresses a DUPLICATE delivery without reprocessing it', async () => {
    recordIfNew.mockResolvedValue(false);

    const res = await POST(makeRequest({ body: NOTIFICATION_BODY }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ duplicate: true });
    // The whole point: business logic must not run twice.
    expect(processTwitchEvent).not.toHaveBeenCalled();
  });

  it('returns 500 on a storage failure so Twitch retries', async () => {
    recordIfNew.mockRejectedValue(new Error('DynamoDB unavailable'));
    const res = await POST(makeRequest({ body: NOTIFICATION_BODY }));
    expect(res.status).toBe(500);
    expect(processTwitchEvent).not.toHaveBeenCalled();
  });

  it('still returns 2XX when the business logic throws', async () => {
    // The event is already recorded and dedupe is by message id, so a retry
    // would not help — it would just replay a message we have.
    (processTwitchEvent as jest.Mock).mockRejectedValue(new Error('boom'));
    const res = await POST(makeRequest({ body: NOTIFICATION_BODY }));
    expect(res.status).toBe(200);
  });

  it('rejects a malformed envelope with 400, not 500', async () => {
    // 5xx would make Twitch retry a body that can never parse.
    const res = await POST(makeRequest({ body: '{"nope":true}' }));
    expect(res.status).toBe(400);
  });
});

describe('revocation', () => {
  it('records the revocation and flags the connection for re-auth', async () => {
    const body = JSON.stringify({
      subscription: {
        id: 'sub-1',
        type: 'stream.online',
        version: '1',
        status: 'authorization_revoked',
      },
    });

    const res = await POST(makeRequest({ body, messageType: 'revocation' }));

    expect(res.status).toBe(200);
    expect(markSubscriptionStatus).toHaveBeenCalledWith(
      'tamilagaval',
      'sub-1',
      'authorization_revoked'
    );
    expect(setStatus).toHaveBeenCalledWith(
      'tamilagaval',
      'reauth_required',
      expect.any(String)
    );
  });

  it('does not demand re-auth for a delivery-failure revocation', async () => {
    const body = JSON.stringify({
      subscription: {
        id: 'sub-1',
        type: 'stream.online',
        version: '1',
        status: 'notification_failures_exceeded',
      },
    });

    await POST(makeRequest({ body, messageType: 'revocation' }));

    expect(markSubscriptionStatus).toHaveBeenCalled();
    // Nothing is wrong with the authorization — re-subscribing is the fix.
    expect(setStatus).not.toHaveBeenCalled();
  });
});

describe('configuration and limits', () => {
  it('answers 503 when Twitch is not configured', async () => {
    delete process.env.TWITCH_EVENTSUB_SECRET;
    const res = await POST(makeRequest({ body: NOTIFICATION_BODY }));
    expect(res.status).toBe(503);
  });

  it('honours the rate limiter', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue({
      allowed: false,
      limit: 300,
      remaining: 0,
      resetAt: Date.now() + 1000,
      retryAfterSeconds: 1,
    });
    const res = await POST(makeRequest({ body: NOTIFICATION_BODY }));
    expect(res.status).toBe(429);
  });
});
