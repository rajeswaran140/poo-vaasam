import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { DeliveryRepository } from '@/infrastructure/database/DeliveryRepository';
import { isDeliveryToken } from '@/types/delivery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (e) { return authErrorResponse(e); }

  const { token } = await params;
  if (!isDeliveryToken(token)) {
    return NextResponse.json({ success: false, error: 'Bad token' }, { status: 400 });
  }

  // A revoke that matched nothing is a typo, and saying so beats a silent
  // success — which is what it was, while also creating a junk row.
  const revoked = await new DeliveryRepository().revoke(token);
  if (!revoked) {
    return NextResponse.json({ success: false, error: 'No delivery with that token' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
