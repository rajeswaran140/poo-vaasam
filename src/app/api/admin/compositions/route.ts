/**
 * GET  /api/admin/compositions — list (metadata only).
 * POST /api/admin/compositions — create a notebook entry.
 *
 * Admin-gated, force-dynamic (runtime DynamoDB via APP_AWS_* creds).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { CompositionRepository } from '@/infrastructure/database/CompositionRepository';
import { createCompositionSchema } from '@/types/composition';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  try {
    const data = await new CompositionRepository().list();
    return NextResponse.json({ success: true, data, total: data.length });
  } catch (err) {
    console.error('[GET /api/admin/compositions] failed', err);
    return NextResponse.json({ success: false, error: 'Failed to load compositions' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    // Defense-in-depth CSRF: reject cookie-only auth on this mutation
    // (matches the pattern on the other admin mutation routes).
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const body = await request.json().catch(() => null);
  const parsed = createCompositionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid composition' }, { status: 400 });
  }
  try {
    const created = await new CompositionRepository().create(parsed.data);
    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/admin/compositions] failed', err);
    return NextResponse.json({ success: false, error: 'Failed to create composition' }, { status: 500 });
  }
}
