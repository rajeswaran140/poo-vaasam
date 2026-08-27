/**
 * GET /api/admin/mastering/references — list every WAV under audio/references/
 * as a mastering reference.
 *
 * Backs the reference-picker in the mastering studio (Phase 1C). Read-only,
 * admin-gated (no Bearer since it's a GET — mirrors the mastering/download and
 * music-lab/masters list routes).
 *
 * Returns id/key/sizeBytes/uploadedAt per reference. `id` is the filename
 * without the .wav extension — that's what the caller passes back to
 * /api/admin/music-lab/master as `referenceId` alongside the key. Rich
 * per-reference metadata (genre/mood/BPM/etc, per the Phase 1B plan doc's
 * schema) is deferred to a follow-up PR that reads a sibling references/<id>.json
 * file — LIST is fine on filenames alone until a curated bank exists.
 *
 * NOT feature-flagged behind MASTERING_REFERENCE_MATCHING — reading the bank
 * is safe regardless; the gate is on the write path (the master route).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { S3Operations } from '@/infrastructure/storage/s3-client';
import { REFERENCES_PREFIX, isReferenceKey } from '@/lib/mastering-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ReferenceItem {
  id: string;
  key: string;
  sizeBytes: number;
  uploadedAt: string | null;
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  try {
    const objects = await S3Operations.listFiles(REFERENCES_PREFIX);
    const references: ReferenceItem[] = objects
      .filter((o) => {
        // Only .wav files, and re-validate the key sits inside the references
        // prefix — cheap defence against a list result that somehow leaks a key
        // outside the prefix we asked for (should never happen but the type
        // says Key is optional so guard anyway).
        if (!o.Key || !/\.wav$/i.test(o.Key)) return false;
        return isReferenceKey(o.Key);
      })
      .map((o) => ({
        id: o.Key!.slice(REFERENCES_PREFIX.length).replace(/\.wav$/i, ''),
        key: o.Key!,
        sizeBytes: o.Size ?? 0,
        uploadedAt: o.LastModified ? o.LastModified.toISOString() : null,
      }))
      // Newest first — matches the mastering-workspace convention.
      .sort((a, b) => (b.uploadedAt ?? '').localeCompare(a.uploadedAt ?? ''));
    return NextResponse.json({ success: true, references, count: references.length });
  } catch (err) {
    console.error(
      '[api/admin/mastering/references] list failed:',
      err instanceof Error ? err.message : String(err),
    );
    return NextResponse.json(
      { success: false, error: 'Failed to list references' },
      { status: 502 },
    );
  }
}
