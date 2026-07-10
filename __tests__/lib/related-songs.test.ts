import { pickRelatedSongs, type RelatedSongInput } from '@/lib/related-songs';

const href = (id: string) => `/content/${id}`;
const songs: RelatedSongInput[] = [
  { id: 'cur', title: 'Current', theme: 'love', publishedAt: '2026-07-05' },
  { id: 'l1', title: 'Love 1', theme: 'love', publishedAt: '2026-07-01' },
  { id: 'l2', title: 'Love 2', theme: 'love', publishedAt: '2026-07-04' },
  { id: 'm1', title: 'Mother 1', theme: 'mother', publishedAt: '2026-07-06' },
  { id: 'h1', title: 'Homeland 1', theme: 'homeland', publishedAt: '2026-07-03' },
];

describe('pickRelatedSongs', () => {
  it('excludes the current song', () => {
    const r = pickRelatedSongs('cur', 'love', songs, href);
    expect(r.map((s) => s.href)).not.toContain('/content/cur');
  });

  it('puts same-theme songs first, most recent first', () => {
    const r = pickRelatedSongs('cur', 'love', songs, href);
    expect(r[0].title).toBe('Love 2'); // 07-04
    expect(r[1].title).toBe('Love 1'); // 07-01
  });

  it('fills with other-theme songs (by recency) after same-theme', () => {
    const r = pickRelatedSongs('cur', 'love', songs, href);
    expect(r.slice(2).map((s) => s.title)).toEqual(['Mother 1', 'Homeland 1']); // 07-06, 07-03
  });

  it('respects the limit', () => {
    expect(pickRelatedSongs('cur', 'love', songs, href, 2)).toHaveLength(2);
  });

  it('maps id → href via the injected mapper and carries artist/cover', () => {
    const r = pickRelatedSongs(
      'cur',
      'love',
      [{ id: 'x', title: 'X', theme: 'love', artist: 'Raj', coverUrl: 'c.jpg' }],
      href,
    );
    expect(r[0]).toEqual({ title: 'X', artist: 'Raj', href: '/content/x', coverUrl: 'c.jpg' });
  });
});
