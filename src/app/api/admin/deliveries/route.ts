/**
 * GET  /api/admin/deliveries — list, newest first, with download counts.
 * POST /api/admin/deliveries — mint a link for an object under deliveries/.
 *
 * The response carries the full URL rather than a bare token, so the operator
 * copies one thing and cannot assemble it wrongly.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { DeliveryRepository } from '@/infrastructure/database/DeliveryRepository';
import { createDeliverySchema } from '@/types/delivery';
import { S3Operations } from '@/infrastructure/storage/s3-client';
import { SITE_URL } from '@/lib/seo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try { await requireAdmin(request); } catch (e) { return authErrorResponse(e); }
  const deliveries = await new DeliveryRepository().list();
  return NextResponse.json({ success: true, deliveries });
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (e) { return authErrorResponse(e); }

  const parsed = createDeliverySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
      { status: 400 }
    );
  }

  // Size for the buyer's page, and an existence check in the same call — a link
  // for a missing key would otherwise fail at download time, in front of them.
  const contentLength = await S3Operations.getContentLength(parsed.data.s3Key);
  if (contentLength === null) {
    return NextResponse.json(
      { success: false, error: `No object at ${parsed.data.s3Key}` },
      { status: 404 }
    );
  }

  const delivery = await new DeliveryRepository().create({ ...parsed.data, contentLength });
  return NextResponse.json(
    { success: true, delivery, url: `${SITE_URL}/d/${delivery.token}` },
    { status: 201 }
  );
}
