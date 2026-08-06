/**
 * Grouping saved masters into SONGS.
 *
 * The library is a flat list of every master ever kept, newest first. After a
 * few weeks that is 21 rows for 6 songs — வானவில்லே appears six times, ஈழத்து
 * மண்ணே four — and finding "the one I actually released" means reading version
 * suffixes off the end of Tamil titles.
 *
 * ⚠️ THIS DELIBERATELY GROUPS BY SONG, NOT BY SOURCE. The long-standing plan
 * was "versions per source" (group by `s3Key`). Measured against the real
 * library on 2026-08-06 that produces **21 groups of one**: Raj uploads a fresh
 * file for every attempt, so no two saved masters share a source. The plan
 * described a workflow he does not have. Titles are what actually repeat.
 *
 * GROUPING IS FUZZY, SO IT FAILS SAFE. Titles are free text and version markers
 * are invented on the spot (`-ver3.5`, `-New-z1.23`, `-zzV.5`, `- CO-1.1`,
 * `PartA-1.9`). The rule is therefore biased to UNDER-group: two takes that
 * stay separate are a cosmetic miss, whereas merging two different songs would
 * hide one behind the other. Every row keeps its full title on screen, so a
 * wrong grouping is visible rather than silent.
 */

import type { MasterJob } from '@/types/masterJob';

/**
 * Trailing markers that denote a TAKE rather than a song: a version number, a
 * part, a voice. Anchored to the end so a marker-like word inside a real title
 * cannot truncate it.
 */
const TAKE_MARKERS: RegExp[] = [
  /\s*[-–]\s*(?:new[-\s]*)?(?:ver|version|v)[-\s.]*[\d.]+.*$/i,
  /\s*[-–]\s*version\s*[-\s]*\d*.*$/i,
  /\s*[-–]\s*(?:zz)?v[.\s]*[\d.]+.*$/i,
  /\s*[-–]\s*co[-\s]*[\d.]+.*$/i,
  /\s*[-–]\s*newr[-\s]*[\d.]+.*$/i,
  /\s*[-–]\s*new[-\s]*z[\d.]+.*$/i,
  /\s*[-–]?\s*(?:part\s*[ab]|all)[-\s]*[\d.]*\s*$/i,
  /\s*[-–]\s*(?:female|male)[-_\s]*(?:version)?\s*$/i,
  /\s*\((?:v[\d.]+|female|male|part [ab]|co-[\d.]+)\)\s*$/i,
];

/** The brand, when appended to a title. ASCII only — never strip Tamil words. */
const BRAND = /\s*[-_\s]\s*Tamilagaval\s*$/i;

/**
 * The song a title belongs to.
 *
 * Applied repeatedly because takes stack markers (`ஈழத்து மண்ணே_Tamilagaval-ver3.5`
 * carries both a brand and a version). Returns the trimmed title unchanged when
 * nothing matches, which is the safe outcome — an ungrouped row.
 */
export function songKey(title: string | null | undefined): string {
  let s = (title ?? '').replace(/_/g, ' ').replace(/\s{2,}/g, ' ').trim();
  for (let pass = 0; pass < 4; pass++) {
    const before = s;
    s = s.replace(BRAND, '');
    for (const re of TAKE_MARKERS) s = s.replace(re, '');
    s = s.replace(/\s{2,}/g, ' ').trim().replace(/[-–\s]+$/, '');
    if (s === before) break;
  }
  return s || (title ?? '').trim();
}

export interface SongGroup {
  /** The shared song name — the longest title in the group, less its markers. */
  song: string;
  masters: MasterJob[];
  /** Most recent savedAt in the group, for ordering. */
  latestSavedAt: string;
}

/**
 * Group saved masters by song, newest group first and newest take first inside
 * each group.
 *
 * An untitled master cannot be grouped — it has no name to match on — so each
 * gets its own group rather than being lumped into a misleading "(untitled)"
 * bucket that would imply they are takes of one song.
 */
export function groupMastersBySong(masters: MasterJob[]): SongGroup[] {
  const groups = new Map<string, MasterJob[]>();
  for (const m of masters) {
    const key = m.title ? songKey(m.title) : `__untitled__${m.id}`;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }

  const out: SongGroup[] = [];
  for (const [key, list] of groups) {
    const sorted = [...list].sort((a, b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? ''));
    out.push({
      song: key.startsWith('__untitled__') ? '' : key,
      masters: sorted,
      latestSavedAt: sorted[0]?.savedAt ?? '',
    });
  }
  return out.sort((a, b) => b.latestSavedAt.localeCompare(a.latestSavedAt));
}

/** "3 takes · newest 5 Aug" — the one-line summary for a collapsed group. */
export function describeGroup(group: SongGroup): string {
  const n = group.masters.length;
  const takes = n === 1 ? '1 take' : `${n} takes`;
  const published = group.masters.filter((m) => m.publishedAt).length;
  const archived = group.masters.filter((m) => m.archivedAt).length;
  const bits = [takes];
  if (archived) bits.push(`${archived} archived`);
  if (published) bits.push(`${published} on site`);
  return bits.join(' · ');
}
