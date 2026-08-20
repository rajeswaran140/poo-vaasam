/**
 * POST /api/twitch/eventsub — the Twitch EventSub webhook callback.
 *
 * PUBLIC and unauthenticated by necessity: Twitch calls it, not a logged-in
 * user. Authenticity comes from the HMAC signature, not from a session — which
 * is why the signature check happens before anything else is trusted.
 *
 * Order matters and is deliberate:
 *   1. read the RAW body            — re-serialising JSON breaks the signature
 *   2. verify the HMAC signature    — reject anything unsigned (403)
 *   3. check timestamp freshness    — replay protection
 *   4. parse the envelope           — malformed is 400, NOT 5xx (Twitch retries 5xx)
 *   5. branch on message type
 *   6. record with a conditional put — duplicate delivery is a no-op
 *   7. respond 2XX, then process
 *
 * Twitch requires a response "within a few seconds" and revokes a subscription
 * after repeated timeouts, so the work between receiving and responding is one
 * conditional DynamoDB put. Business logic runs after the outcome is decided.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  SharedRateLimiter,
  checkRateLimit,
  rateLimitedResponse,
} from '@/lib/rate-limit';
import { getTwitchConfig } from '@/lib/twitch/config';
import {
  TWITCH_MESSAGE_ID_HEADER,
  TWITCH_MESSAGE_SIGNATURE_HEADER,
  TWITCH_MESSAGE_TIMESTAMP_HEADER,
  TWITCH_MESSAGE_TYPE_HEADER,
  isTimestampFresh,
  verifyEventSubSignature,
} from '@/lib/twitch/signature';
import { normalizeEvent, parseEventSubEnvelope } from '@/lib/twitch/normalize';
import {
  TwitchEventRepository,
  rawEventExpiry,
} from '@/infrastructure/database/TwitchEventRepository';
import { TwitchConnectionRepository } from '@/infrastructure/database/TwitchConnectionRepository';
import { processTwitchEvent } from '@/application/use-cases/ProcessTwitchEvent';
import { DEFAULT_TENANT_ID, type TwitchSubscriptionStatus } from '@/types/twitch';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('twitch:eventsub');

/**
 * A ceiling, not a throttle. Legitimate EventSub traffic for one channel is a
 * handful of messages per stream; this only stops an unsigned flood from
 * costing us DynamoDB writes. Signature verification is cheap and happens
 * before any storage, so the limit can be generous.
 */
const limiter = new SharedRateLimiter({
  bucket: 'twitch-eventsub',
  windowMs: 60_000,
  max: 300,
});

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const rl = await checkRateLimit(limiter, request);
  if (!rl.allowed) return rateLimitedResponse(rl);

  const config = getTwitchConfig();
  if (!config) {
    // Not configured: refuse clearly rather than 500ing into Twitch's retries.
    log.warn('eventsub called while Twitch is not configured', { result: 'not_configured' });
    return NextResponse.json({ error: 'Twitch is not configured' }, { status: 503 });
  }

  // 1. RAW body — must be the exact bytes Twitch signed.
  const rawBody = await request.text();

  const messageId = request.headers.get(TWITCH_MESSAGE_ID_HEADER);
  const timestamp = request.headers.get(TWITCH_MESSAGE_TIMESTAMP_HEADER);
  const signature = request.headers.get(TWITCH_MESSAGE_SIGNATURE_HEADER);
  const messageType = request.headers.get(TWITCH_MESSAGE_TYPE_HEADER);

  // 2. Signature. Nothing below this line trusts the body.
  if (
    !verifyEventSubSignature({
      secret: config.eventSubSecret,
      messageId,
      timestamp,
      signature,
      rawBody,
    })
  ) {
    // Logged WITHOUT the body or the signature — an attacker's payload is not
    // something to write into our logs.
    log.warn('rejected eventsub message with an invalid signature', {
      eventId: messageId ?? undefined,
      result: 'invalid_signature',
    });
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
  }

  // 3. Replay protection.
  if (!isTimestampFresh(timestamp)) {
    log.warn('rejected stale eventsub message', {
      eventId: messageId ?? undefined,
      result: 'stale_timestamp',
    });
    return NextResponse.json({ error: 'Stale message' }, { status: 403 });
  }

  // 4. Envelope. Malformed => 400 so Twitch does not retry forever.
  const parsed = parseEventSubEnvelope(rawBody, messageType);
  if (!parsed) {
    log.warn('rejected malformed eventsub envelope', {
      eventId: messageId ?? undefined,
      result: 'malformed',
    });
    return NextResponse.json({ error: 'Malformed request' }, { status: 400 });
  }

  const tenantId = DEFAULT_TENANT_ID;

  // 5a. Verification handshake. Twitch requires 200 + text/plain + the RAW
  //     challenge string as the entire body.
  if (parsed.messageType === 'webhook_callback_verification') {
    log.info('eventsub callback verification', {
      tenantId,
      subscriptionId: parsed.subscriptionId,
      eventType: parsed.subscriptionType,
      result: 'verified',
      durationMs: Date.now() - startedAt,
    });
    return new NextResponse(parsed.challenge ?? '', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // 5b. Revocation — record why events stopped so the panel can say so.
  if (parsed.messageType === 'revocation') {
    try {
      const connRepo = new TwitchConnectionRepository();
      await connRepo.markSubscriptionStatus(
        tenantId,
        parsed.subscriptionId,
        parsed.subscriptionStatus as TwitchSubscriptionStatus
      );
      if (
        parsed.subscriptionStatus === 'authorization_revoked' ||
        parsed.subscriptionStatus === 'user_removed'
      ) {
        await connRepo.setStatus(tenantId, 'reauth_required', 'Twitch revoked the subscription');
      }
    } catch (error) {
      log.error('failed to record eventsub revocation', error, {
        tenantId,
        subscriptionId: parsed.subscriptionId,
        result: 'failed',
      });
    }
    log.warn('eventsub subscription revoked by Twitch', {
      tenantId,
      subscriptionId: parsed.subscriptionId,
      eventType: parsed.subscriptionType,
      result: parsed.subscriptionStatus,
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // 6. Notification: record first. The conditional put IS the dedupe.
  const normalized = normalizeEvent(parsed.subscriptionType, parsed.event, parsed.subscriptionId);
  const eventRepo = new TwitchEventRepository();

  let isNew: boolean;
  try {
    isNew = await eventRepo.recordIfNew({
      tenantId,
      messageId: messageId as string,
      subscriptionId: parsed.subscriptionId,
      eventType: parsed.subscriptionType,
      broadcasterId: normalized.broadcasterId,
      receivedAt: new Date().toISOString(),
      occurredAt: normalized.startedAt,
      payload: normalized.raw,
      expiresAt: rawEventExpiry(),
    });
  } catch (error) {
    // A storage failure is the one case where we WANT Twitch to retry.
    log.error('failed to persist eventsub notification', error, {
      tenantId,
      eventId: messageId ?? undefined,
      eventType: parsed.subscriptionType,
      result: 'persist_failed',
    });
    return NextResponse.json({ error: 'Storage failure' }, { status: 500 });
  }

  if (!isNew) {
    log.info('duplicate eventsub notification ignored', {
      tenantId,
      eventId: messageId ?? undefined,
      eventType: parsed.subscriptionType,
      result: 'duplicate',
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
  }

  // 7. Business logic. Already recorded and already idempotent, so a failure
  //    here must not turn into a retry that re-runs the whole message.
  let result = 'processed';
  try {
    result = await processTwitchEvent(tenantId, normalized);
  } catch (error) {
    log.error('failed to process eventsub notification', error, {
      tenantId,
      eventId: messageId ?? undefined,
      eventType: parsed.subscriptionType,
      result: 'process_failed',
    });
  }

  log.info('eventsub notification handled', {
    tenantId,
    broadcasterUserId: normalized.broadcasterId,
    subscriptionId: parsed.subscriptionId,
    eventId: messageId ?? undefined,
    eventType: parsed.subscriptionType,
    result,
    durationMs: Date.now() - startedAt,
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
