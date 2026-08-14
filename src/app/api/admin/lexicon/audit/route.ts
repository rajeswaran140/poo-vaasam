/**
 * GET /api/admin/lexicon/audit — data-quality report for the whole lexicon.
 *
 * READ-ONLY BY CONSTRUCTION. There is no POST here and no "apply all" — the
 * audit reports and proposes; applying a correction goes through the ordinary
 * per-entry PUT so it is one deliberate act with one confirmation, and nothing
 * is ever deleted automatically.
 *
 * Admin-gated, force-dynamic. No AI: the findings are deterministic rules over
 * the stored rows, so the same lexicon always produces the same report.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { LexiconRepository } from '@/infrastructure/database/LexiconRepository';
import { auditLexicon, sortFindings } from '@/lib/lexicon-audit';

export const dynamic = 'force-dynamic';

/** Cap the payload — the report is for review, not for bulk machine processing. */
const MAX_FINDINGS = 500;

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  try {
    const all = await new LexiconRepository().findAll();
    const report = auditLexicon(all);
    const sorted = sortFindings(report.findings);

    return NextResponse.json({
      success: true,
      total: report.total,
      countsByCode: report.countsByCode,
      countsBySeverity: report.countsBySeverity,
      findings: sorted.slice(0, MAX_FINDINGS),
      // Say so rather than silently truncating: a report that looks complete
      // but is not would let a real problem sit unseen behind the cap.
      truncated: sorted.length > MAX_FINDINGS,
      totalFindings: sorted.length,
    });
  } catch (err) {
    console.error('[GET /api/admin/lexicon/audit] failed', err);
    return NextResponse.json({ success: false, error: 'Failed to audit lexicon' }, { status: 500 });
  }
}
