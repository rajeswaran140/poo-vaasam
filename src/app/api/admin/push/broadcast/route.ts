/**
 * POST /api/admin/push/broadcast — send one new-song notification to every
 * stored push subscription. Admin-gated, MANUAL (human-in-the-loop) — never
 * auto-fired. Body: { title, body, url? }. Returns the send tally + prunes any
 * dead subscriptions.
 *
 * GET — returns the current subscriber count (for the compose UI).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { broadcastPush, isVapidConfigured } from '@/lib/push-broadcast';
import { countPushSubscriptions } from '@/lib/push-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(300),
  url: z.string().trim().max(300).optional(),
});

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  if (!isVapidConfigured()) {
    return NextResponse.json({ success: false, error: 'Web push not configured (VAPID_* env)' }, { status: 503 });
  }
  try {
    return NextResponse.json({ success: true, subscribers: await countPushSubscriptions() });
  } catch (err) {
    console.error('[api/admin/push/broadcast] count failed:', err);
    return NextResponse.json({ success: false, error: 'Failed to count subscribers' }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  if (!isVapidConfigured()) {
    return NextResponse.json({ success: false, error: 'Web push not configured (VAPID_* env)' }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'title and body are required' }, { status: 400 });
  }

  try {
    const result = await broadcastPush(parsed.data);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('[api/admin/push/broadcast] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Broadcast failed' }, { status: 500 });
  }
}
