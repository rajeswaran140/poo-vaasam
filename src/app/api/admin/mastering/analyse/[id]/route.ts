/**
 * GET /api/admin/mastering/analyse/[id] — poll a pre-master analysis.
 *
 * Returns the stored MEASUREMENTS plus the verdicts derived from them. The
 * derivation happens here rather than in the worker so a threshold or a wording
 * change ships with an Amplify build — in this module that is the difference
 * between a one-line change and a Lambda redeploy.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { MasterAnalysisRepository } from '@/infrastructure/database/MasterAnalysisRepository';
import { fadeVerdictFromDrop, levelVerdict, proposedTrim } from '@/lib/master-analysis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const { id } = await params;
  try {
    const analysis = await new MasterAnalysisRepository().get(id);
    if (!analysis) return NextResponse.json({ success: false, error: 'Analysis not found' }, { status: 404 });

    const ready = analysis.status === 'done';
    return NextResponse.json({
      success: true,
      analysis,
      verdicts: ready
        ? {
            // Part A leads into a seam ONLY when a Part B exists; otherwise its
            // tail is the end of the song and a fade there is correct.
            fade: fadeVerdictFromDrop(analysis.tailDropLu, analysis.partBKey ? 'lead-in' : 'ending'),
            partBFade: analysis.partBKey ? fadeVerdictFromDrop(analysis.partBTailDropLu, 'ending') : null,
            level: analysis.partBKey
              ? levelVerdict(analysis.integratedLufs, analysis.partBIntegratedLufs)
              : null,
            trim: proposedTrim({
              leadingSilenceSec: analysis.leadingSilenceSec ?? 0,
              trailingSilenceSec: analysis.trailingSilenceSec ?? 0,
              durationSec: analysis.durationSec ?? 0,
            }),
          }
        : null,
    });
  } catch (err) {
    console.error('[api/mastering/analyse/:id] failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Failed to read the analysis' }, { status: 502 });
  }
}
