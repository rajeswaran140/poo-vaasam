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
  // Markers found in the real archive on 2026-08-07 that nothing matched, so
  // each one sat as a group of one beside the song it belongs to:
  //   ஈழத்து மண்ணே-NCY-2.5   ஈழத்து மண்ணே-NCY-2.11   ஈழத்து மண்ணே-finalver2
  // and ஈழத்து மண்ணே-Final-Ver-1.1, which stripped its "-Ver-1.1" and left a
  // stray "-Final" behind — a partial strip, which is worse than none because
  // the leftover looks deliberate.
  /\s*[-–]\s*ncy[-\s]*[\d.]+.*$/i,
  /\s*[-–]\s*final(?:ver)?[-\s]*[\d.]*\s*$/i,
  /\s*[-–]\s*new[-\s]*z[\d.]+.*$/i,
  /\s*[-–]?\s*part\s*[ab][-\s]*[\d.]*\s*$/i,
  // ⚠️ "all" MUST carry a version number. It used to share the rule above,
  // whose separator is optional (needed for "PartA-1.9", which has a space and
  // no dash) — so a title merely ENDING in the word "all" lost it: "இறுதி final
  // call" grouped as "இறுதி final c". In the archive this marker is always
  // "-All-1.7"-shaped, so requiring the number costs nothing and stops the rule
  // reaching into real words.
  /\s*[-–]?\s*all[-\s]*[\d.]+\s*$/i,
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

// ---------------------------------------------------------------------------
// Library search + sort (pure — the page owns the fetching)
// ---------------------------------------------------------------------------

export type LibrarySort = 'newest' | 'oldest' | 'title' | 'loudest' | 'quietest';

export const LIBRARY_SORTS: ReadonlyArray<{ id: LibrarySort; label: string }> = [
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'title', label: 'Title' },
  { id: 'loudest', label: 'Loudest' },
  { id: 'quietest', label: 'Quietest' },
];

/** Case-insensitive title match. Empty query returns everything, unfiltered. */
export function filterMasters<T extends { title?: string | null }>(masters: readonly T[], query: string): T[] {
  const q = (query ?? '').normalize('NFC').trim().toLowerCase();
  if (!q) return [...masters];
  return masters.filter((m) => (m.title ?? '').normalize('NFC').toLowerCase().includes(q));
}

/**
 * Sort a library page.
 *
 * ⚠️ SORTING IS PER-PAGE, and the UI has to say so. The rows come from a
 * newest-first index one page at a time, so "loudest" orders the masters
 * LOADED, not the whole library — claiming otherwise would be a lie the moment
 * a second page exists. Sorting a partial list is still useful; pretending it
 * is global is not.
 *
 * Missing loudness sorts last in both directions rather than reading as
 * silence, which is what a naive `?? 0` would do (0 LUFS is deafening, not
 * absent).
 */
export function sortMasters<T extends { title?: string | null; savedAt?: string | null; measuredLufs?: number | null }>(
  masters: readonly T[],
  sort: LibrarySort
): T[] {
  const rows = [...masters];
  const byDate = (a: T, b: T) => (b.savedAt ?? '').localeCompare(a.savedAt ?? '');
  const loud = (m: T) => (typeof m.measuredLufs === 'number' ? m.measuredLufs : null);

  switch (sort) {
    case 'oldest':
      return rows.sort((a, b) => -byDate(a, b));
    case 'title':
      return rows.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? '', 'ta'));
    case 'loudest':
    case 'quietest': {
      const dir = sort === 'loudest' ? -1 : 1;
      return rows.sort((a, b) => {
        const x = loud(a);
        const y = loud(b);
        if (x === null && y === null) return byDate(a, b);
        if (x === null) return 1; // unmeasured rows sink, either direction
        if (y === null) return -1;
        return (x - y) * dir;
      });
    }
    default:
      return rows.sort(byDate);
  }
}
