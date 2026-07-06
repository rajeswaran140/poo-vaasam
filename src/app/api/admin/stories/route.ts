/**
 * Admin Stories API — manage the "Share Your Story" inbox (submissions from
 * POST /api/stories).
 *
 *   GET    /api/admin/stories          → all stories + counts by status
 *   PATCH  /api/admin/stories { id, status }  → set moderation status
 *   DELETE /api/admin/stories?id=story_…      → remove a story
 *
 * Admin-gated, force-dynamic. Mutations additionally require a Bearer token
 * (defense-in-depth CSRF). Low-volume list → a paged scan over the STORY#
 * namespace is fine.
 */

import { NextRequest, NextResponse } from 'next/server';
import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import {
  updateStoryStatusSchema,
  isStoryId,
  type Story,
  type StoryStatus,
} from '@/types/story';

export const dynamic = 'force-dynamic';

/** Map a raw DynamoDB item to the client Story shape. */
function toStory(item: Record<string, unknown>): Story {
  return {
    id: String(item.id ?? ''),
    name: String(item.name ?? ''),
    theme: item.theme as Story['theme'],
    story: String(item.story ?? ''),
    email: typeof item.email === 'string' ? item.email : undefined,
    featureConsent: item.featureConsent === true,
    status: (item.status as StoryStatus) ?? 'NEW',
    source: String(item.source ?? 'share-page'),
    createdAt: String(item.createdAt ?? ''),
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : undefined,
  };
}

function emptyCounts(): Record<StoryStatus, number> {
  return { NEW: 0, REVIEWED: 0, FEATURED: 0, ARCHIVED: 0 };
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  try {
    const res = await DynamoDBOperations.scanAll({
      filterExpression: 'begins_with(PK, :p) AND SK = :sk',
      expressionAttributeValues: { ':p': 'STORY#', ':sk': 'METADATA' },
    });

    const stories = res.Items.map(toStory).sort((a, b) =>
      (b.createdAt || '').localeCompare(a.createdAt || '')
    );

    const counts = emptyCounts();
    for (const s of stories) {
      if (s.status in counts) counts[s.status] += 1;
    }

    return NextResponse.json({
      success: true,
      data: stories,
      total: stories.length,
      counts,
      truncated: res.truncated,
    });
  } catch (error) {
    console.error('[API:ADMIN_STORIES] GET error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch stories' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireAdmin(request);
    requireBearer(request); // mutation — reject cookie-only auth (CSRF)
  } catch (err) {
    return authErrorResponse(err);
  }

  try {
    const body = await request.json().catch(() => null);
    const parsed = updateStoryStatusSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', errors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { id, status } = parsed.data;
    if (!isStoryId(id)) {
      return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });
    }

    const now = new Date().toISOString();
    try {
      const updated = await DynamoDBOperations.update({
        key: { PK: `STORY#${id}`, SK: 'METADATA' },
        updateExpression: 'SET #s = :s, updatedAt = :t',
        expressionAttributeNames: { '#s': 'status' }, // `status` is a reserved word
        expressionAttributeValues: { ':s': status, ':t': now },
        conditionExpression: 'attribute_exists(PK)',
      });
      return NextResponse.json({ success: true, data: updated ? toStory(updated) : null });
    } catch (e) {
      if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
        return NextResponse.json({ success: false, error: 'Story not found' }, { status: 404 });
      }
      throw e;
    }
  } catch (error) {
    console.error('[API:ADMIN_STORIES] PATCH error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update story' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireAdmin(request);
    requireBearer(request); // destructive mutation — reject cookie-only auth (CSRF)
  } catch (err) {
    return authErrorResponse(err);
  }

  const id = request.nextUrl.searchParams.get('id') || '';
  if (!isStoryId(id)) {
    return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });
  }

  try {
    await DynamoDBOperations.delete({ PK: `STORY#${id}`, SK: 'METADATA' });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API:ADMIN_STORIES] DELETE error:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete story' }, { status: 500 });
  }
}
