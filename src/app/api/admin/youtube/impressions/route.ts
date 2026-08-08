/**
 * Impressions log — the manual, Studio-sourced layer.
 *
 * GET    ?scope=CHANNEL|<videoId>  → readings newest-first, each annotated with
 *                                    change vs the previous one + a plain-word
 *                                    reading of impressions-vs-CTR direction.
 * POST   { scope, impressions, ctr, views?, windowDays?, note? }
 *                                  → record one reading, stamped server-side.
 * DELETE ?scope=&observedAt=       → remove a mistyped reading.
 *
 * Admin-gated. These numbers CANNOT be fetched: `impressions` and
 * `impressionsClickThroughRate` are not in the YouTube Analytics API (HTTP 400
 * "Unknown identifier"), they exist only in Studio. Never back-fill this from
 * an API and never synthesise a value — an invented impressions figure would be
 * indistinguishable from an observed one and would poison every trend built on
 * the log.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { logImpressions, readImpressions, deleteImpressions } from '@/lib/impressions-log-store';
import { withDeltas, interpret, validateEntry, CHANNEL_SCOPE, MAX_CTR_PERCENT } from '@/lib/impressions-log';

export const dynamic = 'force-dynamic';

const scopeSchema = z.union([z.literal(CHANNEL_SCOPE), z.string().regex(/^[A-Za-z0-9_-]{11}$/)]);

const entrySchema = z.object({
  scope: scopeSchema,
  impressions: z.number().int().nonnegative(),
  ctr: z.number().min(0).max(MAX_CTR_PERCENT),
  views: z.number().int().nonnegative().optional(),
  windowDays: z.number().int().positive().max(365).optional().default(28),
  note: z.string().max(400).optional(),
});

function parseScope(request: NextRequest): string | null {
  const raw = request.nextUrl.searchParams.get('scope')?.trim() || CHANNEL_SCOPE;
  return scopeSchema.safeParse(raw).success ? raw : null;
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const scope = parseScope(request);
  if (!scope) {
    return NextResponse.json({ success: false, error: 'scope must be CHANNEL or an 11-char videoId' }, { status: 400 });
  }
  const rows = withDeltas(await readImpressions(scope)).map((d) => ({ ...d, reading: interpret(d) }));
  return NextResponse.json({ success: true, scope, count: rows.length, rows });
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  let input: z.infer<typeof entrySchema>;
  try {
    input = entrySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json(
      { success: false, error: 'Invalid reading', details: err instanceof z.ZodError ? err.issues : undefined },
      { status: 400 }
    );
  }
  // Cross-check beyond the schema: a CTR entered as a fraction passes range
  // validation but implies impossible click counts. Reject rather than store.
  const issues = validateEntry(input);
  if (issues.length) {
    return NextResponse.json({ success: false, error: issues[0].message, issues }, { status: 400 });
  }
  await logImpressions({ ...input, observedAt: new Date().toISOString() });
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  const scope = parseScope(request);
  const observedAt = request.nextUrl.searchParams.get('observedAt')?.trim();
  if (!scope || !observedAt) {
    return NextResponse.json({ success: false, error: 'scope and observedAt are required' }, { status: 400 });
  }
  await deleteImpressions(scope, observedAt);
  return NextResponse.json({ success: true });
}
