/**
 * Lyrics gate unlock API.
 *
 * POST /api/lyrics/unlock — a fan gives their name + email to unlock a song's
 * lyrics. We capture the email as a subscriber lead (same record shape as
 * /api/subscribe, source='lyrics-gate') and set a signed httpOnly cookie so the
 * gated read API (GET /api/lyrics/[id]) will hand back the lyrics. The lyrics
 * are free; this is a soft lead-capture gate, not DRM.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DynamoDBOperations, handleDynamoDBError } from '@/infrastructure/database/dynamodb-client';
import {
  LYRICS_GATE_COOKIE,
  signGateToken,
  gateCookieOptions,
} from '@/lib/lyrics-gate';
import { SharedRateLimiter, checkRateLimit, rateLimitedResponse } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// Public unauthenticated write endpoint (lead capture + gate cookie) — cap
// per-IP to blunt list-flooding and cookie-minting abuse.
const limiter = new SharedRateLimiter({ bucket: 'lyrics-unlock', windowMs: 60_000, max: 5 });

const schema = z.object({
  email: z.string().email('A valid email is required').max(200).trim().toLowerCase(),
  name: z.string().max(120).trim().optional(),
  songId: z.string().max(80).trim().optional(),
  // Honeypot: real users never fill this hidden field; bots often do.
  company: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const rl = await checkRateLimit(limiter, request);
  if (!rl.allowed) return rateLimitedResponse(rl);

  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', errors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    // Honeypot tripped — pretend success, store nothing, set no cookie.
    if (parsed.data.company) {
      return NextResponse.json({ success: true }, { status: 200 });
    }

    const { email, name } = parsed.data;
    await DynamoDBOperations.put({
      PK: `SUBSCRIBER#${email}`,
      SK: 'METADATA',
      entityType: 'SUBSCRIBER',
      email,
      ...(name ? { name } : {}),
      source: 'lyrics-gate',
      status: 'SUBSCRIBED',
      createdAt: new Date().toISOString(),
    });

    // Set the signed gate cookie. The payload carries no PII — it only proves
    // this browser passed the gate.
    const response = NextResponse.json({ success: true }, { status: 200 });
    response.cookies.set(
      LYRICS_GATE_COOKIE,
      signGateToken({ v: 1, at: new Date().toISOString() }),
      gateCookieOptions()
    );
    return response;
  } catch (error) {
    try {
      handleDynamoDBError(error);
    } catch {
      /* fall through */
    }
    console.error('[API:LYRICS_UNLOCK] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Could not unlock lyrics. Please try again later.' },
      { status: 500 }
    );
  }
}
