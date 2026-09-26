/**
 * Health Check Endpoint
 *
 * Simple endpoint to verify API is working.
 *
 * ⚠️ IT ALSO ANSWERS ONE DIAGNOSTIC QUESTION, deliberately. Contact and
 * karaoke order notifications have never sent: /api/contact writes to DynamoDB
 * and returns 201, but SES records no sends at all. The permission theory is
 * disproven — the runtime principal is the IAM user `poo-vaasam-app-user`,
 * which holds `ses:SendEmail` on `*` with no conditions. Two candidates were
 * left, and neither is visible from outside:
 *
 *   1. `CONTACT_NOTIFY_FROM` is not present at RUNTIME (Amplify app env vars
 *      are a known build-vs-runtime gotcha). `sendContactNotification` then
 *      hits `if (!from) return false` and no-ops SILENTLY — nothing throws, so
 *      the caller's catch never logs and nothing surfaces anywhere.
 *   2. SES rejects the send and the caller DOES log it — but the Amplify log
 *      group captures no application console output, so the log is invisible.
 *
 * `contactNotify: false` means (1).
 *
 * It calls `isContactNotifyConfigured()` — the same function the sender's own
 * guard uses — so the probe cannot drift from the behaviour it reports on, and
 * it is read per request rather than at module load. A BOOLEAN ONLY: the
 * addresses must never appear here, since this endpoint is public.
 */

import { NextResponse } from 'next/server';
import { isContactNotifyConfigured } from '@/lib/contact-notify';

// Per-request: a cached response would report the BUILD environment, which is
// precisely the thing under investigation.
export const dynamic = 'force-dynamic';

/**
 * Which server-side features actually have their configuration at runtime.
 *
 * ⚠️ CONTACT_NOTIFY_FROM WAS NOT SPECIAL — it was the first one anyone noticed.
 * Every var below is a plain Amplify environment variable read at runtime with
 * no fallback, so each fails exactly the same silent way. NEXT_PUBLIC_* are
 * exempt: Next inlines those into the bundle at build.
 *
 * ⚠️ READ FROM env DIRECTLY, not via each feature's isXConfigured(). Those
 * helpers live in modules that import the BigQuery, GA4 and web-push SDKs, and
 * a health endpoint has no business dragging those in. The duplication is
 * deliberate and is held honest by a test that imports the REAL helpers and
 * asserts this map agrees with every one of them.
 *
 * BOOLEANS ONLY — this endpoint is public, so no value may ever appear here.
 */
function configReadiness(): Record<string, boolean> {
  const env = process.env;
  return {
    contactNotify: isContactNotifyConfigured(),
    ga4: Boolean(env.GA4_PROPERTY_ID && env.GA4_SERVICE_ACCOUNT_KEY),
    // Mirrors isBigQueryConfigured: it needs GA4_PROPERTY_ID too, and accepts
    // either service-account key.
    bigquery: Boolean(
      env.BIGQUERY_PROJECT_ID &&
        env.GA4_PROPERTY_ID &&
        (env.BIGQUERY_SERVICE_ACCOUNT_KEY || env.GA4_SERVICE_ACCOUNT_KEY)
    ),
    webPush: Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT),
    youtubeApi: Boolean(env.YOUTUBE_API_KEY),
    youtubeOAuth: Boolean(env.YOUTUBE_OAUTH_CLIENT_ID && env.YOUTUBE_OAUTH_CLIENT_SECRET),
  };
}

export async function GET() {
  const config = configReadiness();
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    message: 'API is working',
    // Kept at the top level as well: it shipped in #361 and something may
    // already read it.
    contactNotify: config.contactNotify,
    config,
  });
}
