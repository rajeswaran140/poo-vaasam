/**
 * GET /api/admin/music-lab/master/[jobId] — poll an async mastering job.
 * Admin-gated. Returns the MasterJob (status processing|done|error; masterKey +
 * beforeLufs once done). Each poll is tiny + fast, so the 30s ceiling never
 * applies to a single call.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { MasterJobRepository } from '@/infrastructure/database/MasterJobRepository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const { jobId } = await params;
  if (!jobId) return NextResponse.json({ success: false, error: 'jobId required' }, { status: 400 });

  try {
    const job = await new MasterJobRepository().get(jobId);
    if (!job) return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
    return NextResponse.json({ success: true, ...job });
  } catch (err) {
    console.error('[api/music-lab/master/:jobId] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Failed to read job' }, { status: 502 });
  }
}
