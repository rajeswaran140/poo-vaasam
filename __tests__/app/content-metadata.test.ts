/** @jest-environment node */
/**
 * generateMetadata for the content page — the audit fixes:
 *  - a bespoke hero's designed artwork is the share image (og/twitter)
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
  it('uses the bespoke hero artwork as the share image (og + twitter)', async () => {
    // The vanity song id has a SONG_HEROES entry → hero image wins.
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
    const og = (m.openGraph?.images as { url?: string }[] | string[] | undefined) ?? [];
    const ogStr = JSON.stringify(og);
    expect(ogStr).toContain('thayagam-hero.png');
    expect(ogStr).not.toContain('old-cover.png');
    expect(JSON.stringify(m.twitter?.images)).toContain('thayagam-hero.png');
  });

  it('falls back to featuredImage when the song has no bespoke hero', async () => {
    mockFindById.mockResolvedValue(
      asEntity({
        id: 'cnt_plain_song',
        type: 'SONGS',
        title: 'Plain Song',
        author: 'இராஜ்',
        featuredImage: 'https://cdn.example/plain-cover.png',
      })
    );
    const m = await meta('cnt_plain_song');
    expect(JSON.stringify(m.openGraph?.images)).toContain('plain-cover.png');
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
