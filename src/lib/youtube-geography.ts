/**
 * Pure helpers for per-video audience geography (YouTube Analytics `country`
 * dimension). The network fetch lives in lib/youtube-analytics
 * (fetchVideoGeography); everything here is pure and unit-tested.
 *
 * Note on coverage: YouTube only reports country-level rows for the
 * geo-attributed, finalized subset of views (privacy threshold + ~1–3 day
 * lag), so `totalAttributedViews` is expected to be < the lifetime view count.
 * The distribution is still representative — treat it as "where they come
 * from", not an exact head-count.
 */

/** One raw row as returned by the Analytics `country` report. */
export interface GeographyRawRow {
  country: string; // ISO 3166-1 alpha-2; YouTube uses "ZZ" for unknown
  views: number;
  estimatedMinutesWatched: number;
  averageViewDuration: number; // seconds
  averageViewPercentage: number; // 0..100
}

/** A raw row decorated with display name, flag, and view-share. */
export interface GeographyRow extends GeographyRawRow {
  countryName: string;
  flag: string;
  sharePct: number; // share of geo-attributed views, 0..100
}

export interface GeographySummary {
  rows: GeographyRow[]; // sorted by views desc
  totalAttributedViews: number;
  totalWatchMinutes: number;
  countryCount: number;
  topCountry: GeographyRow | null;
}

const REGIONAL_INDICATOR_A = 0x1f1e6; // 🇦

/** ISO 3166-1 alpha-2 → flag emoji. Non-country / unknown → 🌐. */
export function flagEmoji(code: string): string {
  const cc = code.trim().toUpperCase();
  if (cc === 'ZZ' || !/^[A-Z]{2}$/.test(cc)) return '🌐';
  return String.fromCodePoint(
    REGIONAL_INDICATOR_A + (cc.charCodeAt(0) - 65),
    REGIONAL_INDICATOR_A + (cc.charCodeAt(1) - 65)
  );
}

let regionNames: Intl.DisplayNames | null | undefined;
function getRegionNames(): Intl.DisplayNames | null {
  if (regionNames !== undefined) return regionNames;
  try {
    regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    regionNames = null; // very old runtime — fall back to the raw code
  }
  return regionNames;
}

/** ISO 3166-1 alpha-2 → English country name, falling back to the code. */
export function countryName(code: string): string {
  const cc = code.trim().toUpperCase();
  if (cc === 'ZZ') return 'Unknown region';
  if (!/^[A-Z]{2}$/.test(cc)) return cc || 'Unknown';
  try {
    const name = getRegionNames()?.of(cc);
    return name && name !== cc ? name : cc;
  } catch {
    return cc;
  }
}

/** Parse raw Analytics rows: [country, views, estMin, avgDur, avgPct]. */
export function parseGeographyRows(
  rows: Array<Array<string | number>> | undefined | null
): GeographyRawRow[] {
  return (rows ?? []).map((r) => ({
    country: String(r[0] ?? ''),
    views: Number(r[1] ?? 0),
    estimatedMinutesWatched: Number(r[2] ?? 0),
    averageViewDuration: Number(r[3] ?? 0),
    averageViewPercentage: Number(r[4] ?? 0),
  }));
}

/** Decorate rows with name/flag/share, sort by views desc, and summarise. */
export function summarizeGeography(raw: GeographyRawRow[] | undefined | null): GeographySummary {
  const cleaned = (raw ?? []).filter((r) => r.country && r.views > 0);
  const totalAttributedViews = cleaned.reduce((s, r) => s + r.views, 0);
  const totalWatchMinutes = cleaned.reduce((s, r) => s + r.estimatedMinutesWatched, 0);
  const rows: GeographyRow[] = cleaned
    .map((r) => ({
      ...r,
      countryName: countryName(r.country),
      flag: flagEmoji(r.country),
      sharePct: totalAttributedViews > 0 ? (r.views / totalAttributedViews) * 100 : 0,
    }))
    .sort((a, b) => b.views - a.views);
  return {
    rows,
    totalAttributedViews,
    totalWatchMinutes,
    countryCount: rows.length,
    topCountry: rows[0] ?? null,
  };
}
