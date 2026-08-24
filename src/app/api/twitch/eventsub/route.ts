/**
 * POST /api/twitch/eventsub — Twitch EventSub webhook.
 *
 * PUBLIC route (outside /admin — the middleware doesn't guard /api paths).
 * Twitch itself is the only legitimate caller; authenticity is proven by
 * the HMAC signature over messageId + messageTimestamp + rawBody.
 *
 * Response-time budget: Twitch retries on 2xx failure or timeout. We keep
 * every code path under ~1s by doing all work inline (dedupe + persist + a
 * tiny amount of business logic) and letting cold-start eat what it eats.
 * A worker Lambda for out-of-band enrichment is deferred until we add
 * higher-volume events (chat, cheers) in Phase 3.
 *
 * Message-type handling:
 *   webhook_callback_verification → echo the challenge string. This is what
 *     flips a subscription from `pending_verification` to `enabled` at Twitch.
 *   notification → dedupe by Twitch-Eventsub-Message-Id, persist raw, then
 *     process the specific event type inline (stream.online / stream.offline
 *     update the current-stream singleton; unknown types are stored and ignored).
 *   revocation → flip the subscription record's status to 'revoked'. Twitch
 *     will not send more events for it; the admin UI surfaces this state.
 *
 * Anything the signature check rejects returns 403 with no body. Anything
 * the timestamp check rejects returns 403 as well — a stale-timestamp request
 * with a valid signature is a captured-and-replayed attack.
 */

import { NextRequest, NextResponse } from 'next/server';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import {
  H_MESSAGE_ID,
  H_MESSAGE_TIMESTAMP,
  H_MESSAGE_TYPE,
  H_MESSAGE_SIGNATURE,
  isTimestampFresh,
  verifyEventSubSignature,
  type EventSubMessageType,
} from '@/lib/twitch/eventsub';
import { currentTenantId } from '@/lib/twitch/tenant';
import { TwitchEventRepository } from '@/infrastructure/database/TwitchEventRepository';
import { TwitchStreamRepository } from '@/infrastructure/database/TwitchStreamRepository';
import { TwitchSubscriptionRepository } from '@/infrastructure/database/TwitchSubscriptionRepository';
import type {
  SubscriptionType,
  TwitchEventRecord,
  TwitchStreamRecord,
} from '@/types/twitch-eventsub';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const region = process.env.AWS_REGION || 'ca-central-1';
const ssm = new SSMClient({ region });

function ssmPrefix(): string {
  const app = process.env.AWS_APP_ID || 'd3rkmepk4popv0';
  const branch = process.env.AWS_BRANCH || 'master';
  return `/amplify/${app}/${branch}`;
}

async function loadEventSubSecret(): Promise<string> {
  const name = `${ssmPrefix()}/TWITCH_EVENTSUB_SECRET`;
  const r = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
  const v = r.Parameter?.Value;
  if (!v || v.length === 0) {
    throw new Error(`Twitch EventSub secret missing at ${name}`);
  }
  return v;
}

/** 403 with no body — Twitch treats non-2xx as a retryable failure. */
function reject(reason: string): NextResponse {
  console.warn('[api/twitch/eventsub] reject:', reason);
  return new NextResponse(null, { status: 403 });
}

export async function POST(request: NextRequest) {
  // Raw body FIRST — the signature is over the exact bytes Twitch sent.
  // Consuming request.json() before this would re-serialise and break HMAC.
  const rawBody = await request.text();

  const messageId = request.headers.get(H_MESSAGE_ID) ?? '';
  const messageTimestamp = request.headers.get(H_MESSAGE_TIMESTAMP) ?? '';
  const messageType = (request.headers.get(H_MESSAGE_TYPE) ?? '') as EventSubMessageType | '';
  const signatureHeader = request.headers.get(H_MESSAGE_SIGNATURE) ?? '';

  if (!messageId || !messageTimestamp || !messageType || !signatureHeader) {
    return reject('missing required Twitch headers');
  }

  // Replay window BEFORE the (slightly more expensive) HMAC — a fast-fail on
  // a stale-but-signed replay.
  if (!isTimestampFresh(messageTimestamp)) {
    return reject('timestamp outside replay window');
  }

  let secret: string;
  try {
    secret = await loadEventSubSecret();
  } catch (err) {
    // A missing secret is our-side misconfig, not an attacker — 500 rather
    // than 403 so Twitch retries once the secret is put in place.
    console.error('[api/twitch/eventsub] secret load failed:', err instanceof Error ? err.message : String(err));
    return new NextResponse(null, { status: 500 });
  }

  const sigOk = verifyEventSubSignature({
    messageId,
    messageTimestamp,
    rawBody,
    signatureHeader,
    secret,
  });
  if (!sigOk) return reject('signature mismatch');

  // --- past the security gates ---

  // webhook_callback_verification: Twitch waits for a plain-text response
  // containing the challenge string, exactly what's in the body. This is
  // how a subscription transitions from pending to enabled.
  if (messageType === 'webhook_callback_verification') {
    let challenge = '';
    try {
      const body = JSON.parse(rawBody) as { challenge?: unknown };
      challenge = typeof body.challenge === 'string' ? body.challenge : '';
    } catch {
      return reject('challenge body was not valid JSON');
    }
    if (!challenge) return reject('challenge missing');
    // Content-Type must be text — Twitch's parser is strict on this endpoint.
    return new NextResponse(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  // notification | revocation — both have a real payload to persist.
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return reject('body was not valid JSON');
  }
  const subscription = (payload.subscription ?? {}) as Record<string, unknown>;
  const subscriptionType = typeof subscription.type === 'string' ? subscription.type : '';
  const subscriptionId = typeof subscription.id === 'string' ? subscription.id : '';

  const tenantId = currentTenantId();
  const nowIso = new Date().toISOString();

  // Persist the raw event first. `putIfAbsent` returns false on a repeat —
  // Twitch retries a webhook whose response we lost, and this makes the retry
  // a no-op for the business logic below.
  const record: TwitchEventRecord = {
    tenantId,
    messageId,
    messageTimestamp,
    messageType,
    subscriptionType,
    subscriptionId,
    payload,
    receivedAt: nowIso,
    processedAt: null,
    processingError: null,
  };
  const eventRepo = new TwitchEventRepository();
  const isNew = await eventRepo.putIfAbsent(record);
  if (!isNew) {
    // Already handled a previous delivery of this exact event. Ack + done.
    return NextResponse.json({ ok: true, deduped: true });
  }

  try {
    if (messageType === 'revocation') {
      // Twitch tells us WHY under subscription.status (revocation reasons).
      const reason = typeof subscription.status === 'string' ? subscription.status : null;
      if (
        subscriptionType === 'stream.online' ||
        subscriptionType === 'stream.offline'
      ) {
        const subRepo = new TwitchSubscriptionRepository();
        try {
          await subRepo.setStatus(tenantId, subscriptionType, 'revoked', reason, nowIso);
        } catch {
          // No local record means someone deleted the subscription row before
          // Twitch's revocation reached us — still a success from Twitch's POV.
        }
      }
    } else if (messageType === 'notification') {
      await handleNotificationInline({
        subscriptionType,
        payload,
        messageId,
        tenantId,
        nowIso,
      });
    }
    await eventRepo.markProcessed(tenantId, messageId, nowIso, null);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/twitch/eventsub] processing failed:', msg);
    await eventRepo.markProcessed(tenantId, messageId, nowIso, msg).catch(() => {
      // Best-effort — the raw event is already persisted for reprocessing.
    });
    // Still return 200 to Twitch — the raw event is safely stored, so we
    // don't want a retry storm. A cron can re-process failed rows.
  }

  return NextResponse.json({ ok: true });
}

/**
 * Inline processing for the small set of notification types PR 2 handles.
 * Anything not matched is stored (via the raw log above) and skipped here.
 */
async function handleNotificationInline(params: {
  subscriptionType: string;
  payload: Record<string, unknown>;
  messageId: string;
  tenantId: string;
  nowIso: string;
}): Promise<void> {
  const { subscriptionType, payload, messageId, tenantId, nowIso } = params;
  const event = (payload.event ?? {}) as Record<string, unknown>;
  const streamRepo = new TwitchStreamRepository();
  const existing = await streamRepo.get(tenantId);

  if (subscriptionType === 'stream.online') {
    const record: TwitchStreamRecord = {
      tenantId,
      isLive: true,
      streamId: typeof event.id === 'string' ? event.id : null,
      broadcasterUserId:
        typeof event.broadcaster_user_id === 'string' ? event.broadcaster_user_id : null,
      broadcasterUserLogin:
        typeof event.broadcaster_user_login === 'string' ? event.broadcaster_user_login : null,
      // stream.online v1 doesn't ship category/title — those come from a
      // channel.update subscription (added in a later phase). Preserve what
      // was already known so the panel doesn't blank out on go-live.
      categoryId: existing?.categoryId ?? null,
      categoryName: existing?.categoryName ?? null,
      title: existing?.title ?? null,
      startedAt: typeof event.started_at === 'string' ? event.started_at : nowIso,
      updatedAt: nowIso,
      updatedByMessageId: messageId,
    };
    await streamRepo.put(record);
    return;
  }

  if (subscriptionType === 'stream.offline') {
    const record: TwitchStreamRecord = {
      tenantId,
      isLive: false,
      streamId: null,
      broadcasterUserId:
        typeof event.broadcaster_user_id === 'string'
          ? event.broadcaster_user_id
          : existing?.broadcasterUserId ?? null,
      broadcasterUserLogin:
        typeof event.broadcaster_user_login === 'string'
          ? event.broadcaster_user_login
          : existing?.broadcasterUserLogin ?? null,
      // Preserve the last-known category/title so the offline panel can show
      // "last stream was X" without querying anywhere.
      categoryId: existing?.categoryId ?? null,
      categoryName: existing?.categoryName ?? null,
      title: existing?.title ?? null,
      startedAt: null,
      updatedAt: nowIso,
      updatedByMessageId: messageId,
    };
    await streamRepo.put(record);
    return;
  }

  // Unknown subscription type — the raw event is already stored; nothing else
  // to do here. Future phases add handlers for channel.follow, channel.cheer, etc.
}
