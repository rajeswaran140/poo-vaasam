/**
 * POST /api/events — first-party analytics beacon.
 *
 * The browser fires this (via navigator.sendBeacon) for interactions we want to
 * own independently of GA4: audio plays, shares, outbound YouTube opens,
 * subscribe clicks, PWA installs. Because it's our own endpoint it survives
 * ad-blockers that drop gtag, so the admin dashboard always has a floor of
 * truth. Aggregated into daily counters in DynamoDB (see analytics-store.ts).
 *
 * Public + unauthenticated (visitors fire it), so:
 *  - validated by a tight Zod enum — only known event types are accepted,
 *  - rate-limited per IP (reuses src/lib/rate-limit, like the view beacon),
 *  - a write failure NEVER surfaces to the visitor (the client ignores the
 *    response). No PII is accepted or stored — just type + a coarse target key.
 */

import { NextRequest, NextResponse } from 'next/server';
import { RateLimiter, checkRateLimit, rateLimitedResponse } from '@/lib/rate-limit';
import { eventBeaconSchema } from '@/lib/event-types';
import { recordEvent } from '@/lib/analytics-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Generous — a single session legitimately fires several events; this only caps
// a scripted client hammering one warm instance.
const limiter = new RateLimiter({ windowMs: 60_000, max: 120 });

export async function POST(request: NextRequest) {
  const rl = checkRateLimit(limiter, request);
  if (!rl.allowed) return rateLimitedResponse(rl);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = eventBeaconSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid event' }, { status: 400 });
  }

  try {
    await recordEvent(parsed.data.type, parsed.data.target);
    return NextResponse.json({ success: true }, { status: 202 });
  } catch (err) {
    console.error('[api/events] record failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
