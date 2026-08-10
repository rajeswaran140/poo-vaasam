import { FEATURED_SONGS, featuredWatchUrl, featuredThumbUrl, featuredSongsItemListJsonLd} from '@/config/featured-songs';

describe('featured-songs config', () => {
  it('has exactly 5 songs with unique, valid 11-char video ids', () => {
    expect(FEATURED_SONGS).toHaveLength(5);
    const ids = FEATURED_SONGS.map((s) => s.videoId);
    expect(new Set(ids).size).toBe(5);
    ids.forEach((id) => expect(id).toMatch(/^[\w-]{11}$/));
  });

  it('every song has a non-empty Tamil title + romanized name', () => {
    FEATURED_SONGS.forEach((s) => {
      expect(s.title.trim().length).toBeGreaterThan(0);
      expect(s.romanized.trim().length).toBeGreaterThan(0);
    });
  });

  it('builds YouTube watch + thumbnail urls', () => {
    expect(featuredWatchUrl('GXLu3Y7FghU')).toBe('https://www.youtube.com/watch?v=GXLu3Y7FghU');
    expect(featuredThumbUrl('GXLu3Y7FghU')).toBe('https://i.ytimg.com/vi/GXLu3Y7FghU/maxresdefault.jpg');
  });
});

/**
 * Homepage structured data. Added 2026-08-03 after auditing the landing page:
 * it displayed five songs with cover art and marked up NONE of them, while
 * /videos carried 90 VideoObjects — backwards, since the homepage takes 125 of
 * 369 genuine pageviews (28 days, measured 2026-08-02) and /videos takes 36.
 */
describe('featuredSongsItemListJsonLd', () => {
  it('is a valid ItemList covering every featured song', () => {
    const ld = featuredSongsItemListJsonLd() as {
      '@type': string;
      numberOfItems: number;
      itemListElement: Array<{ position: number; item: Record<string, string> }>;
    };
    expect(ld['@type']).toBe('ItemList');
    expect(ld.numberOfItems).toBe(FEATURED_SONGS.length);
    expect(ld.itemListElement).toHaveLength(FEATURED_SONGS.length);
    expect(ld.itemListElement.map((e) => e.position)).toEqual(
      FEATURED_SONGS.map((_, i) => i + 1)
    );
  });

  it('carries the romanisation as alternateName — how the diaspora searches', () => {
    const first = (featuredSongsItemListJsonLd() as any).itemListElement[0].item;
    expect(first.name).toBe(FEATURED_SONGS[0].title);
    expect(first.alternateName).toBe(FEATURED_SONGS[0].romanized);
    expect(first.inLanguage).toBe('ta');
  });

  it('points every entry at the real video, thumbnail and embed', () => {
    for (const el of (featuredSongsItemListJsonLd() as any).itemListElement) {
      expect(el.item['@type']).toBe('VideoObject');
      expect(el.item.contentUrl).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/);
      expect(el.item.embedUrl).toMatch(/^https:\/\/www\.youtube\.com\/embed\/[\w-]{11}$/);
      expect(el.item.thumbnailUrl).toMatch(/^https:\/\/i\.ytimg\.com\/vi\/[\w-]{11}\/maxresdefault\.jpg$/);
    }
  });

  /**
   * Regression guard. Omitting uploadDate made every VideoObject INVALID —
   * Search Console reported 5x ERROR "Missing field uploadDate" on / (found
   * 2026-08-10). It is a REQUIRED property; without it the markup earns nothing.
   */
  it('carries uploadDate on every entry — it is REQUIRED, not optional', () => {
    for (const el of (featuredSongsItemListJsonLd() as any).itemListElement) {
      expect(typeof el.item.uploadDate).toBe('string');
      // ISO 8601, and it must parse to a real instant. A placeholder would be
      // worse than no markup, which is why these come from the Data API.
      expect(el.item.uploadDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      expect(Number.isNaN(Date.parse(el.item.uploadDate))).toBe(false);
    }
  });

  it('uses each video\'s OWN upload date, not one shared date', () => {
    const dates = (featuredSongsItemListJsonLd() as any).itemListElement.map(
      (e: any) => e.item.uploadDate
    );
    expect(new Set(dates).size).toBe(FEATURED_SONGS.length);
    expect(dates).toEqual(FEATURED_SONGS.map((s) => s.uploadDate));
  });

  it('STILL omits description — recommended, not required, and never ghostwritten', () => {
    // The only source in reach is the YouTube description's first line, which
    // is navigation boilerplate. Song copy is Raj's own words; a warning is the
    // right price until he supplies one line per song.
    for (const el of (featuredSongsItemListJsonLd() as any).itemListElement) {
      expect('description' in el.item).toBe(false);
    }
  });

  it('tracks the config — adding a song adds an entry, no second list to maintain', () => {
    const ld = featuredSongsItemListJsonLd() as any;
    expect(ld.itemListElement.map((e: any) => e.item.contentUrl)).toEqual(
      FEATURED_SONGS.map((s) => `https://www.youtube.com/watch?v=${s.videoId}`)
    );
  });
});
