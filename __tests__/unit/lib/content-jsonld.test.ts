import { contentJsonLd, type ContentJsonLdInput } from '@/lib/content-jsonld';
import { SITE_URL } from '@/lib/seo';

const song: ContentJsonLdInput = {
  type: 'SONGS',
  title: 'எங்கள் தேசம்',
  author: 'இராஜ்',
  publishedAt: '2026-06-09T23:51:34.952Z',
  updatedAt: '2026-06-10T04:02:38.000Z',
  audioUrl: 'https://cdn.example/engal-thesam.mp3',
};

const baseOpts = {
  canonicalUrl: `${SITE_URL}/thayagam`,
  image: `${SITE_URL}/images/thayagam-hero.png`,
  audioDurationIso: 'PT5M36S',
  parent: { name: 'பாடல்கள்', url: `${SITE_URL}/songs` },
};

/** The main (first) LD node — the CreativeWork/MusicRecording. */
const mainOf = (arr: Record<string, unknown>[]) => arr[0];
const breadcrumbOf = (arr: Record<string, unknown>[]) =>
  arr.find((n) => n['@type'] === 'BreadcrumbList') as Record<string, unknown>;

describe('contentJsonLd — song', () => {
  it('models a song as a MusicRecording with byArtist + audio (not MusicComposition)', () => {
    const main = mainOf(contentJsonLd(song, baseOpts));
    expect(main['@type']).toBe('MusicRecording');
    // Crawler-facing author is romanised even though the stored value is Tamil.
    expect(main.byArtist).toEqual({ '@type': 'Person', name: 'Raj' });
    expect(main.author).toEqual({ '@type': 'Person', name: 'Raj' });
    expect(main.audio).toEqual({
      '@type': 'AudioObject',
      contentUrl: 'https://cdn.example/engal-thesam.mp3',
      duration: 'PT5M36S',
    });
    expect(main.duration).toBe('PT5M36S');
    expect(main.inLanguage).toBe('ta');
    expect(main.image).toBe(`${SITE_URL}/images/thayagam-hero.png`);
  });

  it('preserves an already-romanised stored author', () => {
    const main = mainOf(contentJsonLd({ ...song, author: 'Raj' }, baseOpts));
    expect(main.author).toEqual({ '@type': 'Person', name: 'Raj' });
    expect(main.byArtist).toEqual({ '@type': 'Person', name: 'Raj' });
  });

  it('builds a 3-level breadcrumb whose parent matches the section (முகப்பு › பாடல்கள் › title)', () => {
    const bc = breadcrumbOf(contentJsonLd(song, baseOpts));
    expect(bc.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'முகப்பு', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'பாடல்கள்', item: `${SITE_URL}/songs` },
      { '@type': 'ListItem', position: 3, name: 'எங்கள் தேசம்', item: `${SITE_URL}/thayagam` },
    ]);
  });
});

describe('contentJsonLd — other content kinds', () => {
  it('keeps LYRICS as a MusicComposition and adds NO byArtist (it is the written work)', () => {
    const main = mainOf(
      contentJsonLd({ type: 'LYRICS', title: 'L', author: 'இராஜ்' }, baseOpts)
    );
    expect(main['@type']).toEqual(['CreativeWork', 'MusicComposition']);
    expect('byArtist' in main).toBe(false);
  });

  it('types a poem as CreativeWork/Poem with no audio/byArtist', () => {
    const main = mainOf(contentJsonLd({ type: 'POEMS', title: 'P' }, { ...baseOpts, audioDurationIso: undefined }));
    expect(main['@type']).toEqual(['CreativeWork', 'Poem']);
    expect('byArtist' in main).toBe(false);
    expect('audio' in main).toBe(false);
  });

  it('falls back to the romanised default author when none is stored', () => {
    const main = mainOf(contentJsonLd({ type: 'POEMS', title: 'P' }, baseOpts));
    expect(main.author).toEqual({ '@type': 'Person', name: 'Raj' });
  });

  it('omits audio + image when absent (no empty keys)', () => {
    const main = mainOf(
      contentJsonLd({ type: 'STORIES', title: 'S' }, { ...baseOpts, image: undefined, audioDurationIso: undefined })
    );
    expect('audio' in main).toBe(false);
    expect('image' in main).toBe(false);
  });
});

describe('contentJsonLd — VideoObject', () => {
  it('adds a VideoObject only when a youtubeId is supplied', () => {
    const without = contentJsonLd(song, baseOpts);
    expect(without.some((n) => n['@type'] === 'VideoObject')).toBe(false);

    const withVideo = contentJsonLd(song, { ...baseOpts, youtubeId: 'GXLu3Y7FghU', videoDescription: 'desc' });
    const vid = withVideo.find((n) => n['@type'] === 'VideoObject') as Record<string, unknown>;
    expect(vid).toBeDefined();
    expect(vid.embedUrl).toBe('https://www.youtube.com/embed/GXLu3Y7FghU');
    expect(vid.contentUrl).toBe('https://www.youtube.com/watch?v=GXLu3Y7FghU');
    expect(vid.thumbnailUrl).toEqual(['https://i.ytimg.com/vi/GXLu3Y7FghU/hqdefault.jpg']);
    expect(vid.description).toBe('desc');
  });
});
