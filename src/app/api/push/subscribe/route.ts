/**
 * POST /api/push/subscribe — store a browser web-push subscription.
 *
 * Public (visitors opt in), Zod-validated, rate-limited per IP. Idempotent:
 * keyed by sha256(endpoint), so re-subscribing the same browser is a no-op
 * overwrite. A storage failure never surfaces to the visitor beyond a 500 the
 * client ignores.
 */

import { NextRequest, NextResponse } from 'next/server';
import { RateLimiter, checkRateLimit, rateLimitedResponse } from '@/lib/rate-limit';
import { pushSubscriptionSchema, savePushSubscription } from '@/lib/push-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const limiter = new RateLimiter({ windowMs: 60_000, max: 20 });

export async function POST(request: NextRequest) {
  const rl = checkRateLimit(limiter, request);
  if (!rl.allowed) return rateLimitedResponse(rl);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = pushSubscriptionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid subscription' }, { status: 400 });
  }

  try {
    await savePushSubscription(parsed.data, request.headers.get('user-agent') ?? undefined);
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    console.error('[api/push/subscribe] save failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
