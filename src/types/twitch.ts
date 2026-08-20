/**
 * Twitch integration types.
 *
 * These describe the INTEGRATION boundary, not the TamilAgaval song model. The
 * only link back into the catalogue is a `songId` that holds a `Content.id`
 * (see src/domain/entities/Content.ts) — there is deliberately no second song
 * store for Twitch.
 *
 * Every row carries a `tenantId`. Today it is always DEFAULT_TENANT_ID, but
 * having the field from the start is what lets this become a multi-tenant
 * Music Creator Engagement service later without unpicking hard-coded
 * assumptions. It is NOT a multi-tenancy implementation — just the seam.
 */

import { z } from 'zod';

/** The single tenant that exists today: TamilAgaval itself. */
export const DEFAULT_TENANT_ID = 'tamilagaval';

/** Lifecycle of a creator's Twitch connection. */
export type TwitchConnectionStatus =
  /** Connected, tokens valid, EventSub verified. */
  | 'connected'
  /** Connected but something is wrong we can recover from (Twitch API failing). */
  | 'degraded'
  /** Token refresh failed or the user revoked us — needs a fresh OAuth run. */
  | 'reauth_required'
  /** Explicitly disconnected by an admin. */
  | 'disconnected';

/** EventSub subscription state, mirroring Twitch's own status strings. */
export type TwitchSubscriptionStatus =
  | 'enabled'
  | 'webhook_callback_verification_pending'
  | 'webhook_callback_verification_failed'
  | 'notification_failures_exceeded'
  | 'authorization_revoked'
  | 'user_removed'
  | 'revoked';

/**
 * The public half of a connection — safe to return from an API and render.
 * Tokens live in a SEPARATE DynamoDB item and are never part of this shape.
 */
export interface TwitchConnection {
  tenantId: string;
  twitchUserId: string;
  twitchLogin: string;
  displayName: string;
  /** For Twitch, the broadcaster id IS the user id; kept explicit for clarity. */
  broadcasterId: string;
  profileImageUrl?: string;
  status: TwitchConnectionStatus;
  /** Scopes actually granted by Twitch (Phase 1 requests none). */
  scopes: string[];
  connectedAt: string;
  updatedAt: string;
  /** Set when the connection last failed, so the panel can explain itself. */
  lastError?: string;
}

/**
 * The secret half. Persisted under SK = 'SECRET' so that reading a connection
 * for display never loads tokens into memory. Never logged, never serialised
 * to any HTTP response.
 */
export interface TwitchConnectionSecrets {
  tenantId: string;
  accessToken: string;
  refreshToken: string;
  /** ISO-8601. Derived from the token response's `expires_in`. */
  accessTokenExpiresAt: string;
  updatedAt: string;
}

/** A registered EventSub subscription, as we track it. */
export interface TwitchEventSubSubscription {
  tenantId: string;
  subscriptionId: string;
  type: string;
  version: string;
  status: TwitchSubscriptionStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * One live broadcast. Phase 2 hangs song-play spans off this same partition,
 * which is why the session is a first-class row rather than a flag on the
 * connection.
 */
export interface TwitchStreamSession {
  tenantId: string;
  /** Twitch's stream id. Absent when a session was opened from stream.online,
   *  which does not carry one — filled in by the Get Streams sync. */
  streamId?: string;
  broadcasterId: string;
  startedAt: string;
  endedAt?: string;
  title?: string;
  categoryId?: string;
  categoryName?: string;
  /** Last observed concurrent viewers. Only ever what the API actually returned. */
  viewerCount?: number;
  updatedAt: string;
}

/** A raw, deduplicated inbound EventSub message. */
export interface TwitchEventRecord {
  tenantId: string;
  /** Twitch-Eventsub-Message-Id — also the partition key, which is what makes
   *  ingest idempotent without a separate dedupe store. */
  messageId: string;
  subscriptionId?: string;
  eventType: string;
  broadcasterId?: string;
  receivedAt: string;
  /** Twitch's own event timestamp where the payload carries one. */
  occurredAt?: string;
  payload: Record<string, unknown>;
  /** Unix seconds; DynamoDB TTL attribute so raw payloads self-expire. */
  expiresAt: number;
}

// ---- Twitch API response schemas ------------------------------------------
// Parsed rather than trusted: a malformed Twitch response must fail as a typed
// error, not propagate `undefined` into the database.

export const twitchTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  token_type: z.string(),
  // Absent on the client-credentials (app access token) flow.
  refresh_token: z.string().optional(),
  scope: z.union([z.array(z.string()), z.string()]).optional(),
});
export type TwitchTokenResponse = z.infer<typeof twitchTokenResponseSchema>;

export const twitchUserSchema = z.object({
  id: z.string().min(1),
  login: z.string().min(1),
  display_name: z.string(),
  profile_image_url: z.string().optional(),
});

export const twitchUsersResponseSchema = z.object({
  data: z.array(twitchUserSchema),
});

export const twitchStreamSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  game_id: z.string().optional(),
  game_name: z.string().optional(),
  title: z.string().optional(),
  viewer_count: z.number().optional(),
  started_at: z.string().optional(),
});

export const twitchStreamsResponseSchema = z.object({
  data: z.array(twitchStreamSchema),
});

export const twitchEventSubCreateResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      type: z.string(),
      version: z.string(),
    })
  ),
});

export const twitchEventSubListResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      type: z.string(),
      version: z.string(),
      condition: z.record(z.string(), z.unknown()).optional(),
    })
  ),
});

// ---- Inbound EventSub message shapes --------------------------------------

/** The three message types Twitch sends to a webhook callback. */
export type TwitchMessageType =
  | 'notification'
  | 'webhook_callback_verification'
  | 'revocation';

export const eventSubSubscriptionSchema = z.object({
  id: z.string(),
  type: z.string(),
  version: z.string(),
  status: z.string(),
  condition: z.record(z.string(), z.unknown()).optional(),
});

export const eventSubEnvelopeSchema = z.object({
  subscription: eventSubSubscriptionSchema,
  /** Present on webhook_callback_verification only. */
  challenge: z.string().optional(),
  /** Present on notification only. */
  event: z.record(z.string(), z.unknown()).optional(),
});

/** stream.online — verified against the EventSub subscription-types reference. */
export const streamOnlineEventSchema = z.object({
  id: z.string(),
  broadcaster_user_id: z.string(),
  broadcaster_user_login: z.string(),
  broadcaster_user_name: z.string(),
  type: z.string(),
  started_at: z.string(),
});

/** stream.offline — carries only broadcaster identity. */
export const streamOfflineEventSchema = z.object({
  broadcaster_user_id: z.string(),
  broadcaster_user_login: z.string(),
  broadcaster_user_name: z.string(),
});
