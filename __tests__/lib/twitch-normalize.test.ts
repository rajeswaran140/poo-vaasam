/** @jest-environment node */
/**
 * Envelope parsing + event normalisation — the seam that keeps Twitch's wire
 * format out of the business logic.
 */

import { normalizeEvent, parseEventSubEnvelope } from '@/lib/twitch/normalize';

const envelope = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    subscription: {
      id: 'sub-123',
      type: 'stream.online',
      version: '1',
      status: 'enabled',
      condition: { broadcaster_user_id: '99' },
    },
    ...over,
  });

describe('parseEventSubEnvelope', () => {
  it('parses a notification', () => {
    const parsed = parseEventSubEnvelope(envelope({ event: { a: 1 } }), 'notification');
    expect(parsed).toMatchObject({
      messageType: 'notification',
      subscriptionId: 'sub-123',
      subscriptionType: 'stream.online',
      subscriptionStatus: 'enabled',
    });
    expect(parsed!.event).toEqual({ a: 1 });
  });

  it('parses a verification challenge', () => {
    const parsed = parseEventSubEnvelope(
      envelope({ challenge: 'pink-fluffy-unicorns' }),
      'webhook_callback_verification'
    );
    expect(parsed!.challenge).toBe('pink-fluffy-unicorns');
  });

  it('parses a revocation and keeps the reason', () => {
    const body = JSON.stringify({
      subscription: {
        id: 'sub-9',
        type: 'stream.online',
        version: '1',
        status: 'authorization_revoked',
      },
    });
    const parsed = parseEventSubEnvelope(body, 'revocation');
    expect(parsed!.subscriptionStatus).toBe('authorization_revoked');
  });

  it('rejects an unknown message type', () => {
    expect(parseEventSubEnvelope(envelope(), 'something-else')).toBeNull();
    expect(parseEventSubEnvelope(envelope(), null)).toBeNull();
  });

  it('rejects malformed JSON rather than throwing', () => {
    expect(() => parseEventSubEnvelope('{not json', 'notification')).not.toThrow();
    expect(parseEventSubEnvelope('{not json', 'notification')).toBeNull();
  });

  it('rejects an envelope missing the subscription', () => {
    expect(parseEventSubEnvelope(JSON.stringify({ event: {} }), 'notification')).toBeNull();
  });
});

describe('normalizeEvent', () => {
  const onlineEvent = {
    id: 'stream-9001',
    broadcaster_user_id: '99',
    broadcaster_user_login: 'tamilagaval',
    broadcaster_user_name: 'TamilAgaval',
    type: 'live',
    started_at: '2026-08-20T12:00:00Z',
  };

  it('maps stream.online onto the internal shape', () => {
    const n = normalizeEvent('stream.online', onlineEvent, 'sub-1');
    expect(n).toMatchObject({
      kind: 'stream.online',
      eventType: 'stream.online',
      subscriptionId: 'sub-1',
      broadcasterId: '99',
      broadcasterLogin: 'tamilagaval',
      streamId: 'stream-9001',
      startedAt: '2026-08-20T12:00:00Z',
    });
  });

  it('maps stream.offline, which carries no stream id', () => {
    const n = normalizeEvent('stream.offline', {
      broadcaster_user_id: '99',
      broadcaster_user_login: 'tamilagaval',
      broadcaster_user_name: 'TamilAgaval',
    });
    expect(n.kind).toBe('stream.offline');
    expect(n.broadcasterId).toBe('99');
    expect(n.streamId).toBeUndefined();
  });

  it('keeps the raw payload for the audit row', () => {
    expect(normalizeEvent('stream.online', onlineEvent).raw).toEqual(onlineEvent);
  });

  it('falls back to unknown when a known type has the wrong shape', () => {
    // A malformed payload must not be mistaken for a real stream.online.
    const n = normalizeEvent('stream.online', { broadcaster_user_id: '99' });
    expect(n.kind).toBe('unknown');
  });

  it('records an unmodelled event type instead of dropping it', () => {
    const n = normalizeEvent('channel.cheer', {
      broadcaster_user_id: '99',
      bits: 100,
    });
    expect(n.kind).toBe('unknown');
    expect(n.eventType).toBe('channel.cheer');
    // Still extracts identity so the row is attributable later.
    expect(n.broadcasterId).toBe('99');
    expect(n.raw).toEqual({ broadcaster_user_id: '99', bits: 100 });
  });

  it('tolerates a missing event object', () => {
    expect(() => normalizeEvent('stream.online', undefined)).not.toThrow();
    expect(normalizeEvent('stream.online', undefined).kind).toBe('unknown');
  });
});
