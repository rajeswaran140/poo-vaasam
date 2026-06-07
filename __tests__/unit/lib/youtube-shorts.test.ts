/** @jest-environment node */
/**
 * youtube-shorts — classify channel items as Shorts vs long-form videos by
 * duration, so the /videos page can present each appropriately. Duration is
 * the only signal available at render without a per-video request.
 */

import {
  iso8601DurationToSeconds,
  isShort,
  partitionShorts,
  SHORTS_MAX_DURATION_SECONDS,
} from '@/lib/youtube-shorts';

describe('iso8601DurationToSeconds', () => {
  it.each([
    ['PT50S', 50],
    ['PT4M14S', 254],
    ['PT6M', 360],
    ['PT1H2M3S', 3723],
    ['PT0S', 0],
  ])('parses %s', (iso, secs) => {
    expect(iso8601DurationToSeconds(iso)).toBe(secs);
  });

  it('returns null for missing / unparseable input', () => {
    expect(iso8601DurationToSeconds(undefined)).toBeNull();
    expect(iso8601DurationToSeconds('')).toBeNull();
    expect(iso8601DurationToSeconds('PT')).toBeNull();
    expect(iso8601DurationToSeconds('4:14')).toBeNull();
  });
});

describe('isShort', () => {
  it('treats a sub-3-minute item as a Short (YouTube ceiling)', () => {
    expect(isShort({ duration: 'PT50S' })).toBe(true);
    expect(isShort({ duration: `PT${SHORTS_MAX_DURATION_SECONDS}S` })).toBe(true); // exactly 180s
  });
  it('treats a 4–6 minute song as a regular video', () => {
    expect(isShort({ duration: 'PT4M14S' })).toBe(false);
    expect(isShort({ duration: 'PT6M29S' })).toBe(false);
  });
  it('treats unknown duration as a regular video (safe default → stays in grid)', () => {
    expect(isShort({})).toBe(false);
    expect(isShort({ duration: undefined })).toBe(false);
  });
});

describe('partitionShorts', () => {
  it('splits a mixed feed, preserving order within each bucket', () => {
    const feed = [
      { id: 'a', duration: 'PT4M14S' },
      { id: 's1', duration: 'PT50S' },
      { id: 'b', duration: 'PT6M5S' },
      { id: 's2', duration: 'PT30S' },
      { id: 'c', duration: undefined }, // unknown → video
    ];
    const { shorts, videos } = partitionShorts(feed);
    expect(shorts.map((v) => v.id)).toEqual(['s1', 's2']);
    expect(videos.map((v) => v.id)).toEqual(['a', 'b', 'c']);
  });

  it('handles an all-video feed', () => {
    const { shorts, videos } = partitionShorts([{ id: 'a', duration: 'PT4M' }]);
    expect(shorts).toHaveLength(0);
    expect(videos).toHaveLength(1);
  });
});
