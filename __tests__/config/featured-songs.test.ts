import { FEATURED_SONGS, featuredWatchUrl, featuredThumbUrl } from '@/config/featured-songs';

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
