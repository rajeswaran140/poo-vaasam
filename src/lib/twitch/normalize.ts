/**
 * Normalisation: raw Twitch EventSub payloads → the internal event shape the
 * rest of the app understands.
 *
 * This is the seam that keeps Twitch's wire format out of the business logic.
 * ProcessTwitchEvent never sees `broadcaster_user_id`; it sees `broadcasterId`.
 * When Twitch changes a payload, or when a second platform is added, this file
 * absorbs it.
 *
 * Pure — no I/O, no clock unless injected — so it is cheap to test exhaustively.
 */

import {
  eventSubEnvelopeSchema,
  streamOfflineEventSchema,
  streamOnlineEventSchema,
  type TwitchMessageType,
} from '@/types/twitch';

/** Every event we can act on. Unknown types are still persisted, never dropped. */
export type NormalizedTwitchEventKind = 'stream.online' | 'stream.offline' | 'unknown';

export interface NormalizedTwitchEvent {
  kind: NormalizedTwitchEventKind;
  /** Twitch's own subscription type string, kept verbatim for the audit row. */
  eventType: string;
  subscriptionId?: string;
  broadcasterId?: string;
  broadcasterLogin?: string;
  broadcasterDisplayName?: string;
  /** stream.online only — Twitch's stream id. */
  streamId?: string;
  /** stream.online only — when the broadcast started, per Twitch. */
  startedAt?: string;
  /** The untouched event object, for the raw audit row. */
  raw: Record<string, unknown>;
}

/** Parsed envelope plus the message type from the header. */
export interface ParsedEventSubMessage {
  messageType: TwitchMessageType;
  subscriptionId: string;
  subscriptionType: string;
  subscriptionStatus: string;
  /** webhook_callback_verification only. */
  challenge?: string;
  /** notification only. */
  event?: Record<string, unknown>;
}

/**
 * Parse the JSON envelope. Returns null on anything malformed so the caller can
 * answer 400 rather than throwing — Twitch retries 5xx, so a malformed body
 * must NOT look like a server error.
 */
export function parseEventSubEnvelope(
  rawBody: string,
  messageType: string | null | undefined
): ParsedEventSubMessage | null {
  if (
    messageType !== 'notification' &&
    messageType !== 'webhook_callback_verification' &&
    messageType !== 'revocation'
  ) {
    return null;
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return null;
  }

  const parsed = eventSubEnvelopeSchema.safeParse(json);
  if (!parsed.success) return null;

  return {
    messageType,
    subscriptionId: parsed.data.subscription.id,
    subscriptionType: parsed.data.subscription.type,
    subscriptionStatus: parsed.data.subscription.status,
    challenge: parsed.data.challenge,
    event: parsed.data.event,
  };
}

/**
 * Project a notification's event object onto the internal shape.
 *
 * An unrecognised type yields kind 'unknown' rather than an error: we still
 * want the raw row persisted so that adding support for an event later can be
 * done with history already captured.
 */
export function normalizeEvent(
  subscriptionType: string,
  event: Record<string, unknown> | undefined,
  subscriptionId?: string
): NormalizedTwitchEvent {
  const raw = event ?? {};
  const base = { eventType: subscriptionType, subscriptionId, raw };

  if (subscriptionType === 'stream.online') {
    const parsed = streamOnlineEventSchema.safeParse(raw);
    if (!parsed.success) return { ...base, kind: 'unknown' };
    return {
      ...base,
      kind: 'stream.online',
      broadcasterId: parsed.data.broadcaster_user_id,
      broadcasterLogin: parsed.data.broadcaster_user_login,
      broadcasterDisplayName: parsed.data.broadcaster_user_name,
      streamId: parsed.data.id,
      startedAt: parsed.data.started_at,
    };
  }

  if (subscriptionType === 'stream.offline') {
    const parsed = streamOfflineEventSchema.safeParse(raw);
    if (!parsed.success) return { ...base, kind: 'unknown' };
    return {
      ...base,
      kind: 'stream.offline',
      broadcasterId: parsed.data.broadcaster_user_id,
      broadcasterLogin: parsed.data.broadcaster_user_login,
      broadcasterDisplayName: parsed.data.broadcaster_user_name,
    };
  }

  // Best-effort identity extraction for types we don't model yet.
  const broadcasterId =
    typeof raw.broadcaster_user_id === 'string' ? raw.broadcaster_user_id : undefined;
  return { ...base, kind: 'unknown', broadcasterId };
}
