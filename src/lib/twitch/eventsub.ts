/**
 * Twitch EventSub — signature verification + subscription management.
 *
 * Signature verification implements Twitch's current webhook spec:
 *   header `Twitch-Eventsub-Message-Signature` = `sha256=<hex>`
 *   HMAC message = messageId + messageTimestamp + rawBody
 *   key         = the secret we passed at subscription-creation time
 * Verified with a timing-safe comparison so a per-byte attacker can't leak
 * the secret via response-time differences.
 *
 * Replay protection: reject events whose `Twitch-Eventsub-Message-Timestamp`
 * is more than REPLAY_WINDOW_SECONDS in the past OR future. Combined with
 * the raw-log's idempotency dedupe, this makes an attacker's replayed
 * captured request useless (signature verifies but timestamp is stale).
 *
 * Subscription management is a thin wrapper over the Helix EventSub API.
 * All subscription writes require the APP access token (see app-access-token.ts).
 */

import crypto from 'crypto';
import { getAppAccessToken } from './app-access-token';

const SUBSCRIPTIONS_URL = 'https://api.twitch.tv/helix/eventsub/subscriptions';

/** How far in the past/future an event timestamp is allowed to be. */
export const REPLAY_WINDOW_SECONDS = 10 * 60; // 10 min

/** Header names — exact case Twitch sends. */
export const H_MESSAGE_ID = 'twitch-eventsub-message-id';
export const H_MESSAGE_TIMESTAMP = 'twitch-eventsub-message-timestamp';
export const H_MESSAGE_TYPE = 'twitch-eventsub-message-type';
export const H_MESSAGE_SIGNATURE = 'twitch-eventsub-message-signature';
export const H_SUBSCRIPTION_TYPE = 'twitch-eventsub-subscription-type';

export type EventSubMessageType =
  | 'webhook_callback_verification'
  | 'notification'
  | 'revocation';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`Twitch EventSub: required env var ${name} is not set`);
  }
  return v;
}

/**
 * Verify a webhook signature. `rawBody` MUST be the exact bytes Twitch
 * POSTed (not a re-serialised JSON). Returns true only on a matching HMAC;
 * false on any tamper / format / secret mismatch.
 */
export function verifyEventSubSignature(params: {
  messageId: string;
  messageTimestamp: string;
  rawBody: string;
  signatureHeader: string;
  secret: string;
}): boolean {
  const { messageId, messageTimestamp, rawBody, signatureHeader, secret } = params;
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const providedHex = signatureHeader.slice('sha256='.length);
  if (providedHex.length !== 64) return false;

  const expectedHex = crypto
    .createHmac('sha256', secret)
    .update(messageId + messageTimestamp + rawBody)
    .digest('hex');

  try {
    const provided = Buffer.from(providedHex, 'hex');
    const expected = Buffer.from(expectedHex, 'hex');
    if (provided.length !== expected.length) return false;
    return crypto.timingSafeEqual(provided, expected);
  } catch {
    return false;
  }
}

/**
 * True when the Twitch timestamp is within the replay window. Twitch always
 * ships a valid ISO 8601 timestamp; a malformed one is rejected as a replay
 * attempt (defense-in-depth).
 */
export function isTimestampFresh(messageTimestamp: string, nowMs: number = Date.now()): boolean {
  const t = Date.parse(messageTimestamp);
  if (Number.isNaN(t)) return false;
  const diff = Math.abs(nowMs - t);
  return diff <= REPLAY_WINDOW_SECONDS * 1000;
}

/**
 * A single EventSub subscription record from Helix (fields we care about).
 * The full response has more; we ignore what we don't need.
 */
export interface HelixSubscription {
  id: string;
  status: string;
  type: string;
  version: string;
  condition: Record<string, string>;
  transport: { method: string; callback?: string };
  created_at: string;
}

/**
 * Create a webhook subscription for one event type. Twitch returns the
 * subscription in `pending_verification` state initially; the webhook's
 * `webhook_callback_verification` message is what flips it to `enabled`.
 */
export async function createSubscription(params: {
  type: string;
  version: '1' | '2';
  condition: Record<string, string>;
  callbackUrl: string;
  secret: string;
}): Promise<HelixSubscription> {
  const token = await getAppAccessToken();
  const res = await fetch(SUBSCRIPTIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Client-Id': requireEnv('TWITCH_CLIENT_ID'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: params.type,
      version: params.version,
      condition: params.condition,
      transport: {
        method: 'webhook',
        callback: params.callbackUrl,
        secret: params.secret,
      },
    }),
  });
  if (!res.ok) {
    // Twitch returns useful error text here; safe to surface because it never
    // echoes our secret (which is in the request body, not the response).
    const text = await res.text().catch(() => '');
    throw new Error(`Twitch subscription create failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data?: HelixSubscription[] };
  const sub = json.data?.[0];
  if (!sub) throw new Error('Twitch subscription create returned no data');
  return sub;
}

/** Delete a subscription at Twitch. Idempotent — 404 on already-gone is OK. */
export async function deleteSubscription(id: string): Promise<void> {
  const token = await getAppAccessToken();
  const url = new URL(SUBSCRIPTIONS_URL);
  url.searchParams.set('id', id);
  const res = await fetch(url.toString(), {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      'Client-Id': requireEnv('TWITCH_CLIENT_ID'),
    },
  });
  if (res.status === 204 || res.status === 404) return;
  const text = await res.text().catch(() => '');
  throw new Error(`Twitch subscription delete failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
}

/**
 * List all subscriptions for our client. Used by a reconcile cron (Phase 2b)
 * to detect drift between what we think is subscribed and what Twitch says.
 */
export async function listSubscriptions(): Promise<HelixSubscription[]> {
  const token = await getAppAccessToken();
  const res = await fetch(SUBSCRIPTIONS_URL, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Client-Id': requireEnv('TWITCH_CLIENT_ID'),
    },
  });
  if (!res.ok) {
    throw new Error(`Twitch subscription list failed (HTTP ${res.status})`);
  }
  const json = (await res.json()) as { data?: HelixSubscription[] };
  return json.data ?? [];
}

/**
 * The webhook callback URL — must EXACTLY match what Twitch expects for the
 * subscription. Config-driven so preview/staging/prod each provide their own.
 * Falls back to a computed origin for dev.
 */
export function resolveEventSubCallbackUrl(fallbackOrigin: string): string {
  const configured = process.env.TWITCH_EVENTSUB_CALLBACK_URL;
  if (configured && configured.length > 0) return configured;
  return `${fallbackOrigin}/api/twitch/eventsub`;
}
