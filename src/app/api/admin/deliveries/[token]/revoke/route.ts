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

  await new DeliveryRepository().revoke(token);
  return NextResponse.json({ success: true });
}
