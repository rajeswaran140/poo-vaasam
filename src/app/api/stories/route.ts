/**
 * Share Your Story API
 *
 * POST /api/stories — public endpoint for a Tamil fan to share a memory tied to
 * a song theme. Stored in DynamoDB under PK=STORY#<id>, SK=METADATA for the
 * admin inbox. If the visitor leaves an email, we ALSO capture them as a
 * newsletter lead (best-effort — a lead failure must never fail the story save).
 */

import { NextRequest, NextResponse } from 'next/server';
import { DynamoDBOperations, handleDynamoDBError } from '@/infrastructure/database/dynamodb-client';
import { RateLimiter, checkRateLimit, rateLimitedResponse } from '@/lib/rate-limit';
import { createStorySchema, DEFAULT_STORY_STATUS } from '@/types/story';

export const dynamic = 'force-dynamic';

// Story submissions are low-frequency for a real person; cap a single IP so a
// bot that gets past the honeypot can't flood DynamoDB.
const limiter = new RateLimiter({ windowMs: 60_000, max: 5 });

export async function POST(request: NextRequest) {
  try {
    const rl = checkRateLimit(limiter, request);
    if (!rl.allowed) return rateLimitedResponse(rl);

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
    }

    const parsed = createStorySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', errors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    // Honeypot tripped — pretend success, store nothing.
    if (parsed.data.company) {
      return NextResponse.json({ success: true, message: 'Story received' }, { status: 200 });
    }

    const { name, theme, story, email, featureConsent } = parsed.data;
    const id = `story_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date().toISOString();

    await DynamoDBOperations.put({
      PK: `STORY#${id}`,
      SK: 'METADATA',
      entityType: 'STORY',
      id,
      name,
      theme,
      story,
      email, // undefined is stripped by removeUndefinedValues
      featureConsent,
      status: DEFAULT_STORY_STATUS,
      source: 'share-page',
      createdAt: now,
    });

    // If they left an email, grow the owned audience too. The story is already
    // persisted, so a lead failure must NOT fail the request — swallow + log.
    if (email) {
      try {
        await DynamoDBOperations.put({
          PK: `SUBSCRIBER#${email}`,
          SK: 'METADATA',
          entityType: 'SUBSCRIBER',
          email,
          source: 'story-campaign',
          status: 'SUBSCRIBED',
          createdAt: now,
        });
      } catch (leadError) {
        console.error('[API:STORIES] subscriber lead failed (story still saved):', leadError);
      }
    }

    return NextResponse.json(
      { success: true, message: 'உங்கள் கதைக்கு நன்றி!' },
      { status: 201 }
    );
  } catch (error) {
    try {
      handleDynamoDBError(error);
    } catch {
      // fall through to generic response
    }
    console.error('[API:STORIES] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to share your story. Please try again later.' },
      { status: 500 }
    );
  }
}
