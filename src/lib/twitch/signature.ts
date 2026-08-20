/**
 * Twitch EventSub webhook signature verification.
 *
 * Verified against https://dev.twitch.tv/docs/eventsub/handling-webhook-events/
 * (not from memory):
 *
 *   HMAC message = Twitch-Eventsub-Message-Id
 *                + Twitch-Eventsub-Message-Timestamp
 *                + raw request body        (concatenated, in that order)
 *
 *   signature    = 'sha256=' + hex(HMAC-SHA256(secret, message))
 *
 * and the comparison must be time-safe. Same crypto primitives as
 * src/lib/lyrics-gate.ts, which is the existing HMAC precedent in this codebase.
 *
 * ⚠️ The body MUST be the raw bytes as received. Re-serialising parsed JSON
 * changes whitespace and key order and the signature will never match — which
 * is why the route reads request.text() BEFORE parsing.
 */

import crypto from 'crypto';

/** Header names Twitch sends. Node/Next lower-cases incoming header names. */
export const TWITCH_MESSAGE_ID_HEADER = 'twitch-eventsub-message-id';
export const TWITCH_MESSAGE_TIMESTAMP_HEADER = 'twitch-eventsub-message-timestamp';
export const TWITCH_MESSAGE_SIGNATURE_HEADER = 'twitch-eventsub-message-signature';
export const TWITCH_MESSAGE_TYPE_HEADER = 'twitch-eventsub-message-type';
export const TWITCH_MESSAGE_RETRY_HEADER = 'twitch-eventsub-message-retry';
export const TWITCH_SUBSCRIPTION_TYPE_HEADER = 'twitch-eventsub-subscription-type';

/**
 * How old an EventSub message may be before we treat it as a replay.
 *
 * ⚠️ Twitch's handling-webhook-events documentation does NOT specify a
 * normative window — this is OUR choice, deliberately conservative. Twitch
 * retries failed deliveries, so it must be comfortably longer than a retry
 * cycle, and short enough that a captured request cannot be replayed later.
 */
export const REPLAY_WINDOW_MS = 10 * 60 * 1000;

/** Compute the expected signature for a message. Exported for tests. */
export function computeEventSubSignature(
  secret: string,
  messageId: string,
  timestamp: string,
  rawBody: string
): string {
  const hmac = crypto
    .createHmac('sha256', secret)
    .update(messageId + timestamp + rawBody)
    .digest('hex');
  return `sha256=${hmac}`;
}

/**
 * Time-safe comparison that does not leak length. `timingSafeEqual` throws when
 * the buffers differ in length, so length is checked first — that check is not
 * itself a secret (the signature format is fixed-width anyway).
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify an EventSub message signature.
 *
 * Returns false — never throws — for any missing input, so a malformed request
 * is simply rejected with a 403 rather than producing a 500 that Twitch would
 * retry forever.
 */
export function verifyEventSubSignature(params: {
  secret: string;
  messageId: string | null | undefined;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
  rawBody: string;
}): boolean {
  const { secret, messageId, timestamp, signature, rawBody } = params;
  if (!secret || !messageId || !timestamp || !signature) return false;
  const expected = computeEventSubSignature(secret, messageId, timestamp, rawBody);
  return safeEqual(expected, signature);
}

/**
 * Replay protection: reject a message whose timestamp is outside the window in
 * EITHER direction. A far-future timestamp is as suspicious as an old one, and
 * accepting it would let an attacker mint a message that stays valid.
 */
export function isTimestampFresh(
  timestamp: string | null | undefined,
  now: number = Date.now(),
  windowMs: number = REPLAY_WINDOW_MS
): boolean {
  if (!timestamp) return false;
  const sent = Date.parse(timestamp);
  if (Number.isNaN(sent)) return false;
  return Math.abs(now - sent) <= windowMs;
}
