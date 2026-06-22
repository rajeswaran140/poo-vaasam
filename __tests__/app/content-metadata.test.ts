/** @jest-environment node */
/**
 * generateMetadata for the content page:
 *  - og:image is NOT the raw cover — the co-located opengraph-image.tsx card
 *    re-frames it to 1200×630 (a ~3MB square scrapes poorly in WhatsApp). The
 *    cover-selection itself is unit-tested in og-image.test.ts (shareCardCover).
 *  - songs say "listen free", text says "read for free"
 */

const mockFindById = jest.fn();
jest.mock('@/infrastructure/database/ContentRepository', () => ({
  ContentRepository: jest.fn().mockImplementation(() => ({
    findById: mockFindById,
    findAll: jest.fn().mockResolvedValue({ items: [] }),
  })),
}));

import { generateMetadata } from '@/app/content/[id]/page';

type SongLike = Record<string, unknown>;
const asEntity = (obj: SongLike) => ({ toObject: () => obj });

function meta(id: string) {
  return generateMetadata({ params: Promise.resolve({ id }) } as never);
}

beforeEach(() => mockFindById.mockReset());

describe('content generateMetadata', () => {
  it('does NOT point og:image at the raw cover — the generated 1200×630 card wins', async () => {
    // Even with a hero entry + a featuredImage, generateMetadata leaves images
    // unset so Next uses the co-located opengraph-image.tsx card (which embeds
    // the cover re-framed to the right ratio + size for WhatsApp's scraper).
    mockFindById.mockResolvedValue(
      asEntity({
        id: 'cnt_1781049094952_wstyqacm4',
        type: 'SONGS',
        title: 'எங்கள் தேசம்',
        author: 'இராஜ்',
        featuredImage: 'https://cdn.example/old-cover.png',
      })
    );
    const m = await meta('cnt_1781049094952_wstyqacm4');
    expect(m.openGraph?.images).toBeUndefined();
    expect(m.twitter?.images).toBeUndefined();
  });

  it('keeps the large-image twitter card (the generated card fills it)', async () => {
    mockFindById.mockResolvedValue(
      asEntity({ id: 'cnt_plain_song', type: 'SONGS', title: 'Plain Song', author: 'A', featuredImage: 'https://cdn.example/c.png' })
    );
    const m = await meta('cnt_plain_song');
    expect(m.twitter?.card).toBe('summary_large_image');
    expect(m.openGraph?.images).toBeUndefined();
  });

  it('says "listen free" for a song', async () => {
    mockFindById.mockResolvedValue(
      asEntity({ id: 'cnt_song2', type: 'SONGS', title: 'X', author: 'A' })
    );
    const m = await meta('cnt_song2');
    expect(m.description).toContain('listen for free');
    expect(m.description).not.toContain('read for free');
  });

  it('weaves the song theme into the fallback description (Tamil Homeland Song)', async () => {
    mockFindById.mockResolvedValue(
      asEntity({ id: 'cnt_h', type: 'SONGS', title: 'எங்கள் தேசம்', author: 'இராஜ்', theme: 'homeland' })
    );
    const m = await meta('cnt_h');
    expect(m.description).toContain('Tamil Homeland Song');
    expect(m.description).toContain('listen for free');
  });

  it('says "read for free" for a poem', async () => {
    mockFindById.mockResolvedValue(
      asEntity({ id: 'cnt_poem', type: 'POEMS', title: 'Y', author: 'A' })
    );
    const m = await meta('cnt_poem');
    expect(m.description).toContain('read for free');
  });

  it('romanises a Tamil-script author in the crawler-facing title + description', async () => {
    mockFindById.mockResolvedValue(
      asEntity({ id: 'cnt_ta', type: 'SONGS', title: 'எங்கள் தேசம்', author: 'இராஜ்' })
    );
    const m = await meta('cnt_ta');
    expect(m.title).toContain('Rajeswaran Thangarajah');
    expect(m.title).not.toContain('இராஜ்');
    expect(m.description).toContain('Rajeswaran Thangarajah');
  });

  it('sets og:type to music.song for a song, article for a poem', async () => {
    mockFindById.mockResolvedValue(asEntity({ id: 'cnt_s', type: 'SONGS', title: 'S', author: 'A' }));
    expect((await meta('cnt_s')).openGraph?.type).toBe('music.song');

    mockFindById.mockResolvedValue(asEntity({ id: 'cnt_p', type: 'POEMS', title: 'P', author: 'A' }));
    expect((await meta('cnt_p')).openGraph?.type).toBe('article');
  });
});
