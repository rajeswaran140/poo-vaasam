/**
 * Twitch EventSub — persistence types for the three surfaces PR 2 introduces:
 *
 *   1. TwitchEventRecord      — raw event log (append-only, idempotent by
 *                                the Twitch-Eventsub-Message-Id header).
 *   2. TwitchStreamRecord     — current-stream singleton per tenant
 *                                (LIVE now, or last-seen-offline snapshot).
 *   3. TwitchSubscriptionRecord — one row per EventSub subscription we've
 *                                created at Twitch (type + id + status).
 *
 * All three sit in the shared TamilWebContent DDB table, keyed under the
 * tenant prefix so the multi-tenant future is a query-scope change.
 *
 * The event log retains RAW payloads — Twitch's shape is what it is, and
 * we don't want to lose fields during ingestion. Enrichment / normalisation
 * happens downstream (Phase 3 catalogue joins), reading from the raw log.
 */

/** The EventSub notification types PR 2 handles inline. Others are stored raw + ignored. */
export type SupportedEventType = 'stream.online' | 'stream.offline';

/** The `subscription.type` field on a notification; extended as we add events. */
export type SubscriptionType = SupportedEventType;

/**
 * A single Twitch EventSub notification, as we persist it. `payload` is the
 * raw JSON body Twitch POSTed — we resist parsing beyond what's needed for
 * routing, so a future consumer can read any field Twitch ships.
 */
export interface TwitchEventRecord {
  /** Tenant/creator id. */
  tenantId: string;
  /** The Twitch-Eventsub-Message-Id header. Idempotency key. */
  messageId: string;
  /** The Twitch-Eventsub-Message-Timestamp header (ISO 8601 from Twitch). */
  messageTimestamp: string;
  /**
   * The Twitch-Eventsub-Message-Type header:
   *   - 'notification'                 (an actual event)
   *   - 'webhook_callback_verification' (subscription-verify challenge)
   *   - 'revocation'                   (subscription revoked by Twitch)
   */
  messageType: string;
  /** subscription.type from the payload — e.g. 'stream.online'. */
  subscriptionType: string;
  /** subscription.id from the payload — Twitch's identifier for the sub. */
  subscriptionId: string;
  /** The full raw JSON body Twitch POSTed. Never parsed beyond routing. */
  payload: Record<string, unknown>;
  /** When we received it (server clock). ISO 8601 UTC. */
  receivedAt: string;
  /** When we processed the business logic. Null while pending. */
  processedAt: string | null;
  /** Set if inline processing failed. Null on success. */
  processingError: string | null;
}

/**
 * The tenant's current stream state (singleton — always one row per tenant).
 * Written by the webhook's stream.online / stream.offline inline handlers.
 * A stale-safe UI reads this without hitting Twitch.
 */
export interface TwitchStreamRecord {
  tenantId: string;
  isLive: boolean;
  /** Twitch stream id — null when offline. */
  streamId: string | null;
  /** The broadcaster's channel; kept for cross-checking during migrations. */
  broadcasterUserId: string | null;
  broadcasterUserLogin: string | null;
  /** Stream category id/name when known (arrived via stream.online payload). */
  categoryId: string | null;
  categoryName: string | null;
  /** Stream title as of last update. */
  title: string | null;
  /** When the current stream went live (ISO 8601 UTC), null when offline. */
  startedAt: string | null;
  /** ISO 8601 UTC of the event that produced THIS record. */
  updatedAt: string;
  /** The event message-id that produced THIS record — cheap "which event drove this?" trace. */
  updatedByMessageId: string | null;
}

/** Lifecycle of one EventSub subscription we've created. */
export type SubscriptionStatus =
  | 'enabled' // Twitch confirmed the subscription; events flowing
  | 'pending' // We created it; awaiting webhook_callback_verification
  | 'revoked' // Twitch revoked (user deauth, too many failures, etc.)
  | 'deleted'; // We asked Twitch to delete it

/**
 * One row per subscription we've created at Twitch. Keyed by tenant + type
 * so re-creating a subscription of the same type overwrites the same row.
 */
export interface TwitchSubscriptionRecord {
  tenantId: string;
  /** The subscription.type — e.g. 'stream.online'. */
  type: SubscriptionType;
  /** Twitch's own id for the subscription (returned by POST /helix/eventsub/subscriptions). */
  twitchSubscriptionId: string;
  /** The broadcaster this subscription watches. */
  broadcasterUserId: string;
  /** Current lifecycle state. */
  status: SubscriptionStatus;
  /** ISO 8601 UTC when we first created this subscription. */
  createdAt: string;
  /** ISO 8601 UTC of the last write to this record. */
  updatedAt: string;
  /** Why the subscription is in its current status, when non-obvious. */
  reason: string | null;
}
