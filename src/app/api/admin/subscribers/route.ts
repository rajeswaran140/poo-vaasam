/**
 * Admin Subscribers API — manage the EMAIL newsletter list (the owned audience
 * captured by POST /api/subscribe). NOTE: this is the email list, NOT YouTube
 * subscribers — YouTube does not expose individual subscribers via any API.
 *
 *   GET   /api/admin/subscribers?from=YYYY-MM-DD&to=YYYY-MM-DD&status=all|subscribed|unsubscribed
 *           → filtered list + summary totals + per-day signup/unsubscribe counts
 *   PATCH /api/admin/subscribers  { email, action: 'unsubscribe' | 'resubscribe' }
 *           → flips a subscriber's status (admin-driven; sets/clears unsubscribedAt)
 *
 * Admin-gated, force-dynamic. Low-volume list → a scan over the SUBSCRIBER#
 * key namespace is fine.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import {
  toSubscriber,
  filterByStatus,
  filterByDateRange,
  dailyCounts,
  summarize,
  sortByJoinedDesc,
  type StatusFilter,
} from '@/lib/subscribers';

export const dynamic = 'force-dynamic';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  try {
    const sp = request.nextUrl.searchParams;
    const from = DAY_RE.test(sp.get('from') || '') ? (sp.get('from') as string) : undefined;
    const to = DAY_RE.test(sp.get('to') || '') ? (sp.get('to') as string) : undefined;
    const statusParam = (sp.get('status') || 'all').toLowerCase();
    const status: StatusFilter =
      statusParam === 'subscribed' || statusParam === 'unsubscribed' ? statusParam : 'all';

    const res = await DynamoDBOperations.scan({
      filterExpression: 'begins_with(PK, :p) AND SK = :sk',
      expressionAttributeValues: { ':p': 'SUBSCRIBER#', ':sk': 'METADATA' },
    });

    const all = (res.Items || []).map(toSubscriber);
    const filtered = sortByJoinedDesc(
      filterByStatus(filterByDateRange(all, from, to), status)
    );

    return NextResponse.json({
      success: true,
      data: filtered,
      total: filtered.length,
      summary: summarize(all), // overall totals (unaffected by filters)
      daily: dailyCounts(filtered), // per-day signups/unsubscribes within the view
      range: { from: from ?? null, to: to ?? null, status },
    });
  } catch (error) {
    console.error('[API:ADMIN_SUBSCRIBERS] GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch subscribers' },
      { status: 500 }
    );
  }
}

const patchSchema = z.object({
  email: z.string().email().max(200).trim().toLowerCase(),
  action: z.enum(['unsubscribe', 'resubscribe']),
});

export async function PATCH(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  try {
    const body = await request.json().catch(() => null);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', errors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { email, action } = parsed.data;
    const key = { PK: `SUBSCRIBER#${email}`, SK: 'METADATA' };
    const now = new Date().toISOString();

    try {
      const updated =
        action === 'unsubscribe'
          ? await DynamoDBOperations.update({
              key,
              updateExpression: 'SET #s = :s, unsubscribedAt = :t',
              expressionAttributeNames: { '#s': 'status' }, // `status` is a DynamoDB reserved word
              expressionAttributeValues: { ':s': 'UNSUBSCRIBED', ':t': now },
              conditionExpression: 'attribute_exists(PK)',
            })
          : await DynamoDBOperations.update({
              key,
              updateExpression: 'SET #s = :s REMOVE unsubscribedAt',
              expressionAttributeNames: { '#s': 'status' },
              expressionAttributeValues: { ':s': 'SUBSCRIBED' },
              conditionExpression: 'attribute_exists(PK)',
            });

      return NextResponse.json({ success: true, data: updated ? toSubscriber(updated) : null });
    } catch (e) {
      // ConditionalCheckFailed → no such subscriber.
      if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
        return NextResponse.json(
          { success: false, error: 'Subscriber not found' },
          { status: 404 }
        );
      }
      throw e;
    }
  } catch (error) {
    console.error('[API:ADMIN_SUBSCRIBERS] PATCH error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update subscriber' },
      { status: 500 }
    );
  }
}
