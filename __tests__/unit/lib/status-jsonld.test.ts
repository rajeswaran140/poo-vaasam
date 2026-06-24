import {
  joinStatusClips,
  statusCollectionJsonLd,
  statusSitemapVideos,
  type StatusVideoItem,
} from '@/lib/status-jsonld';
import { SITE_URL } from '@/lib/seo';

// Two real STATUS_CLIPS song ids (akkam has a plain /content path; engaldesam
// has the /thayagam vanity path — exercises contentPath in the join).
const AKKAM = 'cnt_1780067292516_rpxtdnhoa';
const ENGALDESAM = 'cnt_1781049094952_wstyqacm4';

const songs = [
  { id: AKKAM, title: 'அக்கம் பக்கம்', publishedAt: '2026-02-01T00:00:00Z' },
  { id: ENGALDESAM, title: 'எங்கள் தேசம்', publishedAt: '2026-03-01T00:00:00Z' },
  { id: 'cnt_unpublished_x', title: 'Not a clip', publishedAt: '2026-01-01T00:00:00Z' },
];

describe('joinStatusClips', () => {
  it('keeps only clips whose song is published, in STATUS_CLIPS order', () => {
    const items = joinStatusClips(songs);
    const ids = items.map((i) => i.songId);
    expect(ids).toContain(AKKAM);
    expect(ids).toContain(ENGALDESAM);
    // akkam is listed before engaldesam in the config → order preserved.
    expect(ids.indexOf(AKKAM)).toBeLessThan(ids.indexOf(ENGALDESAM));
  });

  it('drops a song that has no clip and a clip whose song is absent', () => {
    const items = joinStatusClips([songs[2]]); // only the non-clip song
    expect(items).toHaveLength(0);
  });

  it('carries title, vanity path, clip file and uploadDate through', () => {
    const item = joinStatusClips(songs).find((i) => i.songId === ENGALDESAM)!;
    expect(item.title).toBe('எங்கள் தேசம்');
    expect(item.path).toBe('/thayagam'); // vanity path resolved via contentPath
    expect(item.clip).toBe('/clips/engaldesam-short.mp4');
    expect(item.uploadDate).toBe('2026-03-01T00:00:00Z');
  });
});

const items: StatusVideoItem[] = [
  { songId: AKKAM, title: 'அக்கம் பக்கம்', path: '/content/' + AKKAM, clip: '/clips/akkam-short.mp4', uploadDate: '2026-02-01T00:00:00Z' },
];

describe('statusCollectionJsonLd', () => {
  it('is a CollectionPage with an ItemList of VideoObjects', () => {
    const ld = statusCollectionJsonLd(items, {
      name: 'Status Clips',
      description: 'Share Tamil song clips.',
      url: `${SITE_URL}/status`,
    }) as {
      '@type': string;
      inLanguage: string;
      mainEntity: { '@type': string; numberOfItems: number; itemListElement: Record<string, unknown>[] };
    };

    expect(ld['@type']).toBe('CollectionPage');
    expect(ld.inLanguage).toBe('ta');
    expect(ld.mainEntity['@type']).toBe('ItemList');
    expect(ld.mainEntity.numberOfItems).toBe(1);

    const el = ld.mainEntity.itemListElement[0] as { '@type': string; position: number; item: Record<string, unknown> };
    expect(el).toMatchObject({ '@type': 'ListItem', position: 1 });
    expect(el.item).toMatchObject({
      '@type': 'VideoObject',
      name: 'அக்கம் பக்கம்',
      thumbnailUrl: `${SITE_URL}/clips/akkam-short.jpg`, // the short's own poster
      contentUrl: `${SITE_URL}/clips/akkam-short.mp4`,
      url: `${SITE_URL}/content/${AKKAM}`,
      uploadDate: '2026-02-01T00:00:00Z',
      inLanguage: 'ta',
    });
  });
});

describe('statusSitemapVideos', () => {
  it('emits self-hosted video entries (content_loc = the mp4, absolute poster)', () => {
    const [v] = statusSitemapVideos(items);
    expect(v.content_loc).toBe(`${SITE_URL}/clips/akkam-short.mp4`);
    expect(v.thumbnail_loc).toBe(`${SITE_URL}/clips/akkam-short.jpg`);
    expect(v.publication_date).toBe('2026-02-01T00:00:00Z');
    expect(v.title).toBe('அக்கம் பக்கம்');
    expect(v.description).toContain('அக்கம் பக்கம்');
  });

  it('omits publication_date when the song has no publishedAt', () => {
    const [v] = statusSitemapVideos([{ ...items[0], uploadDate: undefined }]);
    expect('publication_date' in v).toBe(false);
  });
});
