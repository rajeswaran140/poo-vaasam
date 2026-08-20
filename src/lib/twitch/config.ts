/**
 * Twitch integration configuration + the OAuth scope decision.
 *
 * 🔴 Amplify's SSR runtime does NOT expose app environment variables. Every
 * value read here must ALSO be listed in `next.config.ts` `env:` or it will be
 * undefined in production — exactly as documented for the YouTube secrets at
 * next.config.ts. Rotating any of these requires a redeploy to re-inline.
 *
 * Nothing here throws on missing config. A missing Twitch setup must render as
 * "Not configured" in the admin panel, never as a crashed page — the Twitch
 * integration is not allowed to take down unrelated TamilAgaval functionality.
 */

/**
 * OAuth scopes requested at connect time.
 *
 * ⚠️ PHASE 1 REQUESTS NO SCOPES, and that is a verified decision rather than an
 * oversight. Against the current Twitch documentation:
 *   - `Get Users` with a user access token returns the authenticated user's own
 *     id/login/display name/profile image with NO scope,
 *   - `Get Streams` is public data and needs no scope,
 *   - `stream.online` and `stream.offline` EventSub subscriptions require no
 *     scope on their condition.
 * So OAuth here exists purely to PROVE CHANNEL OWNERSHIP. Asking for more would
 * be permission we cannot justify to the person authorising.
 *
 * Future event types add their scope HERE with the reason, and the granted set
 * is recorded on the connection so we can tell what a token can actually do:
 *   channel.follow                  → moderator:read:followers
 *   channel.subscribe / .gift       → channel:read:subscriptions
 *   channel.cheer                   → bits:read
 *   channel.channel_points_...add   → channel:read:redemptions
 *   channel.chat.message            → user:read:chat
 */
export const TWITCH_PHASE1_SCOPES: readonly string[] = [];

/** EventSub subscription types Phase 1 registers. */
export const PHASE1_EVENTSUB_TYPES = [
  { type: 'stream.online', version: '1' },
  { type: 'stream.offline', version: '1' },
] as const;

export const TWITCH_AUTHORIZE_URL = 'https://id.twitch.tv/oauth2/authorize';
export const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
export const TWITCH_REVOKE_URL = 'https://id.twitch.tv/oauth2/revoke';
export const TWITCH_HELIX_URL = 'https://api.twitch.tv/helix';

export interface TwitchConfig {
  clientId: string;
  clientSecret: string;
  /** Shared secret for EventSub HMAC. Twitch requires 10-100 ASCII chars. */
  eventSubSecret: string;
  /** Must exactly match a redirect URI registered in the Twitch dev console. */
  redirectUri: string;
  /** Public HTTPS callback Twitch posts events to. Must be port 443. */
  eventSubCallbackUrl: string;
}

/**
 * Read the Twitch configuration, or null when it is not fully set.
 *
 * Returning null rather than throwing is deliberate: `/admin/twitch` renders a
 * "Not configured" state, and no other route is affected.
 */
export function getTwitchConfig(): TwitchConfig | null {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  const eventSubSecret = process.env.TWITCH_EVENTSUB_SECRET;
  const redirectUri = process.env.TWITCH_REDIRECT_URI;
  const eventSubCallbackUrl = process.env.TWITCH_EVENTSUB_CALLBACK_URL;

  if (!clientId || !clientSecret || !eventSubSecret || !redirectUri || !eventSubCallbackUrl) {
    return null;
  }
  return { clientId, clientSecret, eventSubSecret, redirectUri, eventSubCallbackUrl };
}

/** Which required settings are missing — drives the admin panel's message. */
export function missingTwitchConfigKeys(): string[] {
  return (
    [
      'TWITCH_CLIENT_ID',
      'TWITCH_CLIENT_SECRET',
      'TWITCH_EVENTSUB_SECRET',
      'TWITCH_REDIRECT_URI',
      'TWITCH_EVENTSUB_CALLBACK_URL',
    ] as const
  ).filter((key) => !process.env[key]);
}

/**
 * Secret used to sign the OAuth state token. Reuses the client secret — it is
 * already a high-entropy server-only value, and a separate knob would be one
 * more thing to configure and rotate for no security gain.
 */
export function oauthStateSecret(config: TwitchConfig): string {
  return config.clientSecret;
}
