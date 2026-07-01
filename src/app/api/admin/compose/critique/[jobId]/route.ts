/**
 * GET /api/admin/compose/critique/[jobId] — poll an async critic job. Admin-gated.
 *
 * Returns { status: 'processing' } until the worker finishes, then
 * { status: 'done', result } or { status: 'error', error: { code, message } }.
 * 404 if the job id is unknown/expired. Mirrors GET /api/admin/compose/[jobId].
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { CriticJobRepository } from '@/infrastructure/database/CriticJobRepository';
import { isStalledJob, JOB_TIMEOUT_ERROR } from '@/lib/job-timeout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const { jobId } = await params;
  if (!/^critic_\d+_[a-z0-9]+$/.test(jobId)) {
    return NextResponse.json({ success: false, error: 'Invalid job id' }, { status: 400 });
  }
  try {
    const job = await new CriticJobRepository().get(jobId);
    if (!job) {
      return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
    }
    // A `processing` row past the worker budget means the worker died without
    // writing a result — report an authoritative timeout.
    if (isStalledJob(job)) {
      return NextResponse.json({ success: true, status: 'error', result: null, error: JOB_TIMEOUT_ERROR });
    }
    return NextResponse.json({
      success: true,
      status: job.status,
      result: job.result,
      error: job.error,
    });
  } catch (err) {
    console.error('[api/admin/compose/critique/:jobId] fetch failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Failed to fetch the job.' }, { status: 502 });
  }
}
