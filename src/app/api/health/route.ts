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

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    message: 'API is working',
    contactNotify: isContactNotifyConfigured(),
  });
}
