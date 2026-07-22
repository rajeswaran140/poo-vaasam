/**
 * Email subscription API
 *
 * POST /api/subscribe — public endpoint to join the mailing list.
 * Stored in DynamoDB under PK=SUBSCRIBER#<email>, SK=METADATA (keyed by email
 * so re-subscribing is idempotent — no duplicates). This is the audience you
 * OWN, independent of any platform's algorithm.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DynamoDBOperations, handleDynamoDBError } from '@/infrastructure/database/dynamodb-client';
import { SharedRateLimiter, checkRateLimit, rateLimitedResponse } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// Public unauthenticated write endpoint — cap per-IP to blunt list-flooding and
// mass lead injection. Matches the limiter pattern used across the API.
const limiter = new SharedRateLimiter({ bucket: 'subscribe', windowMs: 60_000, max: 5 });

const schema = z.object({
  email: z.string().email('A valid email is required').max(200).trim().toLowerCase(),
  source: z.string().max(60).trim().optional(),
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

    // Honeypot tripped — pretend success, store nothing.
    if (parsed.data.company) {
      return NextResponse.json({ success: true, message: 'Subscribed' }, { status: 200 });
    }

    const { email } = parsed.data;
    await DynamoDBOperations.put({
      PK: `SUBSCRIBER#${email}`,
      SK: 'METADATA',
      entityType: 'SUBSCRIBER',
      email,
      source: parsed.data.source || 'site',
      status: 'SUBSCRIBED',
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json(
      { success: true, message: 'நன்றி! புதிய பாடல்கள் உங்கள் மின்னஞ்சலுக்கு வரும்.' },
      { status: 201 }
    );
  } catch (error) {
    try {
      handleDynamoDBError(error);
    } catch {
      /* fall through */
    }
    console.error('[API:SUBSCRIBE] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Subscription failed. Please try again later.' },
      { status: 500 }
    );
  }
}
