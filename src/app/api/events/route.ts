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
 *  - shape-validated per event type, so a caller can't mint unbounded distinct
 *    counter rows,
 *  - rate-limited per IP ACROSS instances (SharedRateLimiter, like the view
 *    beacon),
 *  - a write failure NEVER surfaces to the visitor (the client ignores the
 *    response). No PII is accepted or stored — just type + a coarse target key.
 */

import { NextRequest, NextResponse } from 'next/server';
import { SharedRateLimiter, checkRateLimit, rateLimitedResponse } from '@/lib/rate-limit';
import { eventBeaconSchema, derivedSongEvent } from '@/lib/event-types';
import { recordEvent } from '@/lib/analytics-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Generous — a single session legitimately fires several events. Shared across
// instances, so spreading the load over cold Lambdas no longer evades the cap;
// that mattered here because these counters ARE the admin dashboard's numbers.
const limiter = new SharedRateLimiter({ bucket: 'events', windowMs: 60_000, max: 120 });

export async function POST(request: NextRequest) {
  const rl = await checkRateLimit(limiter, request);
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
    // Primary, channel-keyed counter — unchanged shape, the dashboard reads it.
    await recordEvent(parsed.data.type, parsed.data.target);
  } catch (err) {
    console.error('[api/events] record failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false }, { status: 500 });
  }

  // Secondary, per-song counter derived server-side from `songId` (the client
  // can't write these types directly). Best-effort: losing the breakdown must
  // never cost us the primary counter we just wrote, nor surface to the visitor.
  const derived = derivedSongEvent(parsed.data);
  if (derived) {
    try {
      await recordEvent(derived.type, derived.target);
    } catch (err) {
      console.error(
        '[api/events] per-song counter failed:',
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  return NextResponse.json({ success: true }, { status: 202 });
}
