/**
 * Lineage: which saved master a new master was made from.
 *
 * The client CLAIMS a parent; this decides whether the claim is true and how
 * the child came from it. A master recorded against the wrong parent would
 * show the wrong marks forever, so an unverifiable claim is refused rather
 * than stored.
 */
import type { MasterJob, MasterLineage } from '@/types/masterJob';
import type { StemSet, StemMixEntry } from '@/types/stemSet';

type Parent = Pick<MasterJob, 'id' | 'savedAt' | 's3Key'>;

export function resolveLineage(
  parent: Parent | null,
  stemSet: Pick<StemSet, 'remix'> | null,
  s3Key: string
):
  | { ok: true; derivedFrom: MasterLineage }
  | { ok: false; code: 'bad-parent' | 'parent-mismatch'; error: string } {
  if (!parent || !parent.savedAt) {
    return { ok: false, code: 'bad-parent', error: 'The master this came from is not a saved master.' };
  }
  const remix = stemSet?.remix;
  if (remix?.key && remix.key === s3Key) {
    return {
      ok: true,
      derivedFrom: { jobId: parent.id, via: 'stem-remix', ...(remix.mixUsed ? { mixUsed: remix.mixUsed } : {}) },
    };
  }
  if (parent.s3Key === s3Key) return { ok: true, derivedFrom: { jobId: parent.id, via: 're-master' } };
  return {
    ok: false,
    code: 'parent-mismatch',
    error: "This file is neither that master's source nor its stem remix.",
  };
}

function isMix(raw: unknown): raw is Record<string, StemMixEntry> {
  if (!raw || typeof raw !== 'object') return false;
  return Object.values(raw as Record<string, unknown>).every(
    (e) =>
      !!e && typeof e === 'object' &&
      typeof (e as StemMixEntry).gainDb === 'number' && typeof (e as StemMixEntry).muted === 'boolean'
  );
}

export function parseDerivedFrom(raw: unknown): MasterLineage | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.jobId !== 'string' || (r.via !== 're-master' && r.via !== 'stem-remix')) return null;
  return { jobId: r.jobId, via: r.via, ...(isMix(r.mixUsed) ? { mixUsed: r.mixUsed } : {}) };
}

export function lineageLabel(d: MasterLineage, parentTitle: string | null): string {
  return `${d.via === 'stem-remix' ? 'Remix' : 'Re-master'} of ${parentTitle || 'an earlier master'}`;
}
