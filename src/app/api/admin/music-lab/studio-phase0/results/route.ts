/**
 * GET/PUT /api/admin/music-lab/studio-phase0/results — the Composition Studio
 * listening test's ratings, as ONE JSON object at a fixed key
 * (`audio/mastering/studio/phase0/results.json`). The client never names a key.
 * The bucket is versioned, so every save is kept.
 *
 * A PUT is refused (409) when it would lose data already stored: a different
 * session (seed), or fewer ratings for any trial than are stored. That is what
 * a stale second tab would send.
 *
 * Throwaway: removed by the Phase 0 cleanup PR.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { S3Operations } from '@/infrastructure/storage/s3-client';
import { RESULTS_KEY, resultsSchema, type Results } from '@/lib/studio-phase0/model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 256 * 1024;

async function readStored(): Promise<Results | null> {
  try {
    const body = await S3Operations.getFile(RESULTS_KEY);
    const text = await (body as { transformToString: () => Promise<string> }).transformToString();
    // Only a missing file means "no results yet". A file that fails to parse is
    // an error: treating it as missing would start a new seed and the first save
    // would overwrite the stored session.
    const parsed = resultsSchema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new Error('Stored results.json fails the schema.');
    return parsed.data;
  } catch (err) {
    if (err instanceof Error && err.name === 'NoSuchKey') return null;
    throw err;
  }
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }
  try {
    return NextResponse.json({ success: true, results: await readStored() });
  } catch (err) {
    console.error('[api/studio-phase0/results] read failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not read the saved results.' }, { status: 502 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BYTES) {
    return NextResponse.json({ success: false, error: 'Results are too large.' }, { status: 413 });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return NextResponse.json({ success: false, error: 'Results are not valid JSON.' }, { status: 400 });
  }
  const parsed = resultsSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Results are invalid.' }, { status: 400 });
  }
  const next = parsed.data;

  try {
    const stored = await readStored();
    if (stored) {
      const losesRatings = Object.entries(stored.trials).some(
        ([id, rec]) => rec.ratings.length > (next.trials[id]?.ratings.length ?? 0)
      );
      if (stored.seed !== next.seed || losesRatings) {
        return NextResponse.json(
          { success: false, error: 'Newer results are already saved. Reload the page to continue from them.' },
          { status: 409 }
        );
      }
    }
    await S3Operations.uploadFile({ key: RESULTS_KEY, file: JSON.stringify(next), contentType: 'application/json' });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/studio-phase0/results] save failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, error: 'Could not save the results.' }, { status: 502 });
  }
}
