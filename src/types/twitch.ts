/**
 * TwitchConnection — the persistent record of one tenant's Twitch OAuth
 * connection.
 *
 * Storage split (deliberate):
 *   - THIS record (DynamoDB, `TENANT#<tenantId>#TWITCH#CONNECTION` / `METADATA`)
 *     holds only the public-ish metadata the admin UI + API routes need to
 *     display connection state and call Helix without touching SSM on the
 *     hot path.
 *   - The access token AND refresh token live in **SSM SecureString**
 *     (see src/lib/twitch/oauth.ts for the exact param names). Never in DDB,
 *     never in an env var, never in logs. This matches the P2.4 pattern
 *     already used for every other TamilAgaval secret.
 *
 * Multi-tenant readiness: `tenantId` is denormalised into the record because
 * the PK already carries it — a table scan by `tenantId` becomes cheap without
 * needing a GSI on the connections themselves. See src/lib/twitch/tenant.ts
 * for the single-tenant marker that stamps every record today.
 */

export type TwitchConnectionStatus = 'connected' | 'disconnected' | 'revoked';

export interface TwitchConnection {
  /** Tenant/creator identifier (Phase 1: always 'tamilagaval'). */
  tenantId: string;

  /** Twitch `users.id` — the numeric user id assigned by Twitch. */
  twitchUserId: string;

  /** Twitch `users.login` — the URL-slug handle (lowercase, no spaces). */
  twitchLogin: string;

  /** Twitch `users.display_name` — the case-preserving public name. */
  displayName: string;

  /**
   * Twitch `broadcaster_user_id` for EventSub subscriptions. For a personal
   * channel this equals `twitchUserId`; kept as a distinct field so a future
   * "connect as moderator of another broadcaster" flow can differ cleanly.
   */
  broadcasterId: string;

  /** Twitch `users.profile_image_url`. Nullable — Twitch may omit it. */
  profileImageUrl: string | null;

  /** Current lifecycle state of this connection. */
  connectionStatus: TwitchConnectionStatus;

  /**
   * OAuth scopes actually GRANTED by the user during authorization
   * (may differ from what we requested — user can decline scopes).
   */
  scopes: string[];

  /**
   * Pointer to the SSM SecureString param holding the current access token.
   * The value at this path is short-lived (~4h); oauth.ts refreshes it
   * before it expires and overwrites via `ssm put-parameter --overwrite`.
   */
  accessTokenSsmParam: string;

  /** Pointer to the SSM SecureString param holding the refresh token. */
  refreshTokenSsmParam: string;

  /**
   * ISO 8601 UTC timestamp when the currently-cached access token expires.
   * Cheap "is refresh needed?" check for API callers without hitting SSM.
   */
  accessTokenExpiresAt: string;

  /** ISO 8601 UTC of the first successful connect. Preserved across reconnects. */
  connectedAt: string;

  /** ISO 8601 UTC of the last write to this record. */
  updatedAt: string;

  /**
   * ISO 8601 UTC when the user (or Twitch) severed the connection. Non-null
   * when `connectionStatus !== 'connected'`; null on the happy path.
   */
  disconnectedAt: string | null;
}
