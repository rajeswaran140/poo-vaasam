/**
 * A raw STEMSET item (as DynamoDB returns it) → a typed StemSet, dropping
 * anything malformed. Pure — no DynamoDB client, no AWS config — so the
 * master worker can hydrate the set it reads without its bundle pulling in
 * the web app's database layer (StemSetRepository re-imports it from here).
 */
import type { StemSet, StemEntry, StemMixEntry, StemRemix } from '@/types/stemSet';

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function stemSetFromItem(i: Record<string, unknown>): StemSet {
  const rawStems = (i.stems ?? {}) as Record<string, Record<string, unknown>>;
  const stems: Record<string, StemEntry> = {};
  for (const [id, s] of Object.entries(rawStems)) {
    if (!s || typeof s.key !== 'string') continue;
    stems[id] = {
      key: s.key,
      name: typeof s.name === 'string' ? s.name : 'Stem',
      previewKey: typeof s.previewKey === 'string' ? s.previewKey : null,
      previewError: typeof s.previewError === 'string' ? s.previewError : null,
      previewRequestedAt: typeof s.previewRequestedAt === 'string' ? s.previewRequestedAt : null,
      durationSec: num(s.durationSec),
      sampleRate: num(s.sampleRate),
      channels: num(s.channels),
    };
  }
  const order = (Array.isArray(i.order) ? i.order : []).filter((id): id is string => typeof id === 'string' && id in stems);
  const mix: Record<string, StemMixEntry> = {};
  for (const [id, m] of Object.entries((i.mix ?? {}) as Record<string, Record<string, unknown>>)) {
    if (id in stems && m && typeof m.gainDb === 'number') mix[id] = { gainDb: m.gainDb, muted: m.muted === true };
  }
  const r = i.remix as Record<string, unknown> | null | undefined;
  const remix: StemRemix | null = r
    ? {
        key: typeof r.key === 'string' ? r.key : null,
        renderedAt: typeof r.renderedAt === 'string' ? r.renderedAt : null,
        mixUsed: (r.mixUsed as StemRemix['mixUsed']) ?? null,
        notes: Array.isArray(r.notes) ? (r.notes as unknown[]).filter((n): n is string => typeof n === 'string') : [],
        error: typeof r.error === 'string' ? r.error : null,
        requestedAt: typeof r.requestedAt === 'string' ? r.requestedAt : null,
      }
    : null;
  return {
    masterJobId: String(i.masterJobId ?? ''),
    order, stems, mix, remix,
    createdAt: String(i.createdAt ?? ''),
    updatedAt: String(i.updatedAt ?? ''),
  };
}
