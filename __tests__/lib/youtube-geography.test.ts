/** @jest-environment node */
/**
 * Unit tests for src/lib/youtube-geography.ts — the pure decoration/summary
 * layer for per-video audience geography. No network; all functions pure.
 */
import {
  flagEmoji,
  countryName,
  parseGeographyRows,
  summarizeGeography,
  type GeographyRawRow,
} from '@/lib/youtube-geography';

describe('flagEmoji', () => {
  it('maps ISO alpha-2 codes to flag emoji (case-insensitive)', () => {
    expect(flagEmoji('IN')).toBe('🇮🇳');
    expect(flagEmoji('lk')).toBe('🇱🇰');
    expect(flagEmoji(' ca ')).toBe('🇨🇦');
  });

  it('returns a globe for unknown/non-country codes', () => {
    expect(flagEmoji('ZZ')).toBe('🌐');
    expect(flagEmoji('')).toBe('🌐');
    expect(flagEmoji('X')).toBe('🌐');
    expect(flagEmoji('123')).toBe('🌐');
  });
});

describe('countryName', () => {
  it('resolves ISO codes to English names', () => {
    expect(countryName('IN')).toBe('India');
    expect(countryName('LK')).toBe('Sri Lanka');
    expect(countryName('CA')).toBe('Canada');
  });

  it('handles the unknown-region sentinel and junk codes', () => {
    expect(countryName('ZZ')).toBe('Unknown region');
    expect(countryName('')).toBe('Unknown');
    // A badly-formatted code (not two letters) falls back to the raw code.
    expect(countryName('q1')).toBe('Q1');
  });
});

describe('parseGeographyRows', () => {
  it('maps raw [country, views, estMin, avgDur, avgPct] tuples by index', () => {
    const out = parseGeographyRows([
      ['IN', 149, 379, 152, 37.88],
      ['CA', 25, 74, 178, 44.29],
    ]);
    expect(out[0]).toEqual({
      country: 'IN',
      views: 149,
      estimatedMinutesWatched: 379,
      averageViewDuration: 152,
      averageViewPercentage: 37.88,
    });
    expect(out).toHaveLength(2);
  });

  it('coerces missing/blank cells to safe defaults', () => {
    expect(parseGeographyRows(null)).toEqual([]);
    expect(parseGeographyRows([['US']])[0]).toEqual({
      country: 'US',
      views: 0,
      estimatedMinutesWatched: 0,
      averageViewDuration: 0,
      averageViewPercentage: 0,
    });
  });
});

describe('summarizeGeography', () => {
  const raw: GeographyRawRow[] = [
    // Deliberately out of order to prove the sort.
    { country: 'CA', views: 25, estimatedMinutesWatched: 74, averageViewDuration: 178, averageViewPercentage: 44.29 },
    { country: 'IN', views: 149, estimatedMinutesWatched: 379, averageViewDuration: 152, averageViewPercentage: 37.88 },
  ];

  it('sorts by views desc, computes share %, and picks the top country', () => {
    const s = summarizeGeography(raw);
    expect(s.rows.map((r) => r.country)).toEqual(['IN', 'CA']);
    expect(s.totalAttributedViews).toBe(174);
    expect(s.totalWatchMinutes).toBe(453);
    expect(s.countryCount).toBe(2);
    expect(s.topCountry?.country).toBe('IN');
    expect(s.rows[0].sharePct).toBeCloseTo((149 / 174) * 100, 5);
    expect(s.rows[0].flag).toBe('🇮🇳');
    expect(s.rows[0].countryName).toBe('India');
  });

  it('drops rows with no country or zero views', () => {
    const s = summarizeGeography([
      { country: 'IN', views: 10, estimatedMinutesWatched: 5, averageViewDuration: 30, averageViewPercentage: 20 },
      { country: '', views: 5, estimatedMinutesWatched: 2, averageViewDuration: 24, averageViewPercentage: 10 },
      { country: 'US', views: 0, estimatedMinutesWatched: 0, averageViewDuration: 0, averageViewPercentage: 0 },
    ]);
    expect(s.countryCount).toBe(1);
    expect(s.rows[0].country).toBe('IN');
    expect(s.rows[0].sharePct).toBe(100);
  });

  it('returns an empty, null-safe summary for no data', () => {
    const s = summarizeGeography(null);
    expect(s.rows).toEqual([]);
    expect(s.totalAttributedViews).toBe(0);
    expect(s.countryCount).toBe(0);
    expect(s.topCountry).toBeNull();
  });
});
