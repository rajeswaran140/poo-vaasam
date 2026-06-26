/** @jest-environment node */
/**
 * Tests for the YouTube RSS feed parser/fetcher.
 */

// fetchChannelVideos mirrors thumbnails to S3; stub it so tests stay hermetic.
jest.mock('@/lib/video-thumbnails', () => ({ ensureThumbnailsMirrored: jest.fn().mockResolvedValue(undefined) }));

import { parseChannelFeed, parseDataApiItems, fetchChannelVideos, videosItemListJsonLd, thumbnailVariants, s3ThumbnailUrl, withTruncatedDescriptions, _resetFeedCache } from '@/lib/youtube-feed';

const SAMPLE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <id>yt:channel:UCabcdefghijklmnopqrstuv</id>
 <yt:channelId>UCabcdefghijklmnopqrstuv</yt:channelId>
 <title>Channel Name Should Be Ignored</title>
 <entry>
  <id>yt:video:gfywsN483lI</id>
  <yt:videoId>gfywsN483lI</yt:videoId>
  <title>பூ வாசம் &amp; காதல்</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=gfywsN483lI"/>
  <published>2026-05-01T10:00:00+00:00</published>
  <media:group><media:thumbnail url="https://i.ytimg.com/vi/gfywsN483lI/hqdefault.jpg"/><media:description>ஒரு அழகான பாடல்</media:description></media:group>
 </entry>
 <entry>
  <id>yt:video:abcdefghijk</id>
  <yt:videoId>abcdefghijk</yt:videoId>
  <title>Second Video</title>
  <published>2026-04-01T10:00:00+00:00</published>
 </entry>
</feed>`;

const originalFetch = global.fetch;
beforeEach(() => {
  // Start every test key-less — the ambient Amplify/CI build sets YOUTUBE_API_KEY,
  // which would otherwise leak into the no-key cases.
  delete process.env.YOUTUBE_API_KEY;
});
afterEach(() => {
  global.fetch = originalFetch;
  delete process.env.YOUTUBE_API_KEY;
});

/** Build a minimal channel RSS feed with `n` entries (11-char ids). */
function feedOf(ids: string[]): string {
  const entries = ids
    .map(
      (id) =>
        `<entry><yt:videoId>${id}</yt:videoId><title>t</title><published>2026-01-01T00:00:00Z</published></entry>`
    )
    .join('');
  return `<feed>${entries}</feed>`;
}
/** playlistItems-shaped items for a set of ids. */
function apiItems(ids: string[]) {
  return ids.map((id) => ({ snippet: { title: id, resourceId: { videoId: id } } }));
}
/** A unique, valid 11-char video id for index i. */
const vid = (i: number): string => `v${i}`.padEnd(11, '0');

describe('parseChannelFeed', () => {
  it('parses entries into video objects (ignoring the channel header title)', () => {
    const videos = parseChannelFeed(SAMPLE_FEED);
    expect(videos).toHaveLength(2);

    expect(videos[0]).toEqual({
      id: 'gfywsN483lI',
      title: 'பூ வாசம் & காதல்', // &amp; decoded
      description: 'ஒரு அழகான பாடல்',
      publishedAt: '2026-05-01T10:00:00+00:00',
      thumbnail: s3ThumbnailUrl('gfywsN483lI'), // self-hosted, not ytimg
      watchUrl: 'https://www.youtube.com/watch?v=gfywsN483lI',
    });
    expect(videos[1].id).toBe('abcdefghijk');
    expect(videos[1].description).toBe(''); // entry 2 has no media:description
    expect(videos.map((v) => v.title)).not.toContain('Channel Name Should Be Ignored');
  });

  it('respects the limit', () => {
    expect(parseChannelFeed(SAMPLE_FEED, 1)).toHaveLength(1);
  });

  it('returns [] for empty/garbage input', () => {
    expect(parseChannelFeed('')).toEqual([]);
    expect(parseChannelFeed('<feed></feed>')).toEqual([]);
  });
});

describe('fetchChannelVideos', () => {
  // The fetcher keeps an in-process TTL cache keyed by channel ID; clear it
  // between cases so a successful fetch doesn't bleed into later assertions.
  beforeEach(() => _resetFeedCache());

  it('returns [] when no channel ID is given (no network call)', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    expect(await fetchChannelVideos('')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches and parses the feed for a channel ID', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, text: async () => SAMPLE_FEED }) as unknown as typeof fetch;
    const videos = await fetchChannelVideos('UCabcdefghijklmnopqrstuv');
    expect(videos).toHaveLength(2);
    expect(videos[0].id).toBe('gfywsN483lI');
  });

  it('returns [] on a non-OK response or thrown error (no prior cache)', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
    expect(await fetchChannelVideos('UCabcdefghijklmnopqrstuv')).toEqual([]);

    _resetFeedCache();
    global.fetch = jest.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
    expect(await fetchChannelVideos('UCabcdefghijklmnopqrstuv')).toEqual([]);
  });

  it('serves the in-process cache within the TTL without re-fetching', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, text: async () => SAMPLE_FEED });
    global.fetch = fetchMock as unknown as typeof fetch;

    await fetchChannelVideos('UCabcdefghijklmnopqrstuv');
    await fetchChannelVideos('UCabcdefghijklmnopqrstuv');
    // Second call within TTL is served from memory — only one network hit.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the last good result when a fetch fails after the TTL expires', async () => {
    jest.useFakeTimers();
    try {
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: true, text: async () => SAMPLE_FEED }) as unknown as typeof fetch;
      expect(await fetchChannelVideos('UCabcdefghijklmnopqrstuv')).toHaveLength(2); // prime cache

      // Advance past the 5-minute TTL so the next call must re-fetch.
      jest.advanceTimersByTime(6 * 60 * 1000);

      global.fetch = jest.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
      // Fetch fails, but we still have last-good data → serve it instead of blanking.
      expect(await fetchChannelVideos('UCabcdefghijklmnopqrstuv')).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('falls back to the YouTube Data API when the RSS feed fails', async () => {
    process.env.YOUTUBE_API_KEY = 'test-key';
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false }) // RSS feed flakes
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            { snippet: { title: 'API Video', description: 'd', publishedAt: '2026-06-04T00:00:00Z', resourceId: { videoId: 'abcdefghijk' } } },
          ],
        }),
      }) as unknown as typeof fetch;

    const videos = await fetchChannelVideos('UCabcdefghijklmnopqrstuv');
    expect(videos).toHaveLength(1);
    expect(videos[0].id).toBe('abcdefghijk');
    expect(videos[0].title).toBe('API Video');
    delete process.env.YOUTUBE_API_KEY;
  });

  it('does NOT use the Data API fallback (playlistItems) when RSS succeeds', async () => {
    process.env.YOUTUBE_API_KEY = 'test-key';
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, text: async () => SAMPLE_FEED, json: async () => ({ items: [] }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    await fetchChannelVideos('UCabcdefghijklmnopqrstuv');
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('feeds/videos.xml'))).toBe(true); // RSS was used
    expect(urls.some((u) => u.includes('playlistItems'))).toBe(false); // no Data API fallback
    delete process.env.YOUTUBE_API_KEY;
  });

  it('escalates to the paginated Data API when RSS comes back full (capped), paging past 50', async () => {
    process.env.YOUTUBE_API_KEY = 'test-key';
    const rssIds = Array.from({ length: 15 }, (_, i) => vid(i)); // RSS at its ~15 cap → suspect truncation
    const apiPage1 = Array.from({ length: 50 }, (_, i) => vid(i));
    const apiPage2 = Array.from({ length: 10 }, (_, i) => vid(50 + i));
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, text: async () => feedOf(rssIds) }) // RSS (full → escalate)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: apiItems(apiPage1), nextPageToken: 'PG2' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: apiItems(apiPage2) }) }) // page 2 via token
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) }); // durations videos.list
    global.fetch = fetchMock as unknown as typeof fetch;

    const videos = await fetchChannelVideos('UCabcdefghijklmnopqrstuv', 60);
    expect(videos).toHaveLength(60); // 50 + 10 — well beyond the 15-item RSS cap

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('playlistItems'))).toBe(true);
    expect(urls.some((u) => u.includes('pageToken=PG2'))).toBe(true); // followed the page token
  });

  it('does NOT escalate to the Data API when RSS returns a short (complete) list', async () => {
    process.env.YOUTUBE_API_KEY = 'test-key';
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, text: async () => SAMPLE_FEED, json: async () => ({ items: [] }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    await fetchChannelVideos('UCabcdefghijklmnopqrstuv');
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('playlistItems'))).toBe(false); // 2 < 15 → RSS is enough, no quota spent
  });

  it('attaches ISO-8601 durations from the Data API when a key is present', async () => {
    process.env.YOUTUBE_API_KEY = 'test-key';
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, text: async () => SAMPLE_FEED }) // RSS
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ id: 'gfywsN483lI', contentDetails: { duration: 'PT3M5S' } }] }),
      }) as unknown as typeof fetch; // videos.list
    const videos = await fetchChannelVideos('UCabcdefghijklmnopqrstuv');
    expect(videos.find((v) => v.id === 'gfywsN483lI')?.duration).toBe('PT3M5S');
    delete process.env.YOUTUBE_API_KEY;
  });
});

describe('parseDataApiItems', () => {
  it('maps playlistItems snippets to videos and skips invalid ids', () => {
    const videos = parseDataApiItems({
      items: [
        { snippet: { title: 'A', description: 'da', publishedAt: 'p', resourceId: { videoId: 'abcdefghijk' } } },
        { snippet: { title: 'bad-id', resourceId: { videoId: 'short' } } }, // skipped: not 11 chars
        { snippet: { title: 'no-resource' } }, // skipped: no videoId
      ],
    });
    expect(videos).toHaveLength(1);
    expect(videos[0]).toEqual({
      id: 'abcdefghijk',
      title: 'A',
      description: 'da',
      publishedAt: 'p',
      thumbnail: s3ThumbnailUrl('abcdefghijk'), // self-hosted, not ytimg
      watchUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
    });
  });

  it('returns [] for missing/garbage input', () => {
    expect(parseDataApiItems({})).toEqual([]);
    expect(parseDataApiItems(null)).toEqual([]);
    expect(parseDataApiItems({ items: 'nope' })).toEqual([]);
  });
});

describe('thumbnailVariants', () => {
  it('returns mq/hq/sd/maxres URLs in ascending resolution order', () => {
    const urls = thumbnailVariants('gfywsN483lI');
    expect(urls).toEqual([
      'https://i.ytimg.com/vi/gfywsN483lI/mqdefault.jpg',
      'https://i.ytimg.com/vi/gfywsN483lI/hqdefault.jpg',
      'https://i.ytimg.com/vi/gfywsN483lI/sddefault.jpg',
      'https://i.ytimg.com/vi/gfywsN483lI/maxresdefault.jpg',
    ]);
  });
});

describe('videosItemListJsonLd', () => {
  it('builds a schema.org ItemList of VideoObjects', () => {
    const ld = videosItemListJsonLd(parseChannelFeed(SAMPLE_FEED)) as {
      '@type': string;
      itemListElement: Array<{ position: number; item: Record<string, string | string[]> }>;
    };

    expect(ld['@type']).toBe('ItemList');
    expect(ld.itemListElement).toHaveLength(2);

    const first = ld.itemListElement[0];
    expect(first.position).toBe(1);
    expect(first.item['@type']).toBe('VideoObject');
    expect(first.item.name).toBe('பூ வாசம் & காதல்');
    expect(first.item.description).toBe('ஒரு அழகான பாடல்');
    expect(first.item.embedUrl).toBe('https://www.youtube.com/embed/gfywsN483lI');
    // Tamil-language signal for regional/language ranking of the videos.
    expect(first.item.inLanguage).toBe('ta');

    // thumbnailUrl is now an array of multi-resolution URLs (Google prefers
    // this for richer video snippets).
    expect(first.item.thumbnailUrl).toEqual([
      'https://i.ytimg.com/vi/gfywsN483lI/mqdefault.jpg',
      'https://i.ytimg.com/vi/gfywsN483lI/hqdefault.jpg',
      'https://i.ytimg.com/vi/gfywsN483lI/sddefault.jpg',
      'https://i.ytimg.com/vi/gfywsN483lI/maxresdefault.jpg',
    ]);

    // Entry without a description falls back to its title.
    expect(ld.itemListElement[1].item.description).toBe('Second Video');
  });

  const baseVideo = {
    id: 'gfywsN483lI',
    title: 'T',
    description: 'd',
    publishedAt: '2026-01-01T00:00:00Z',
    thumbnail: s3ThumbnailUrl('gfywsN483lI'),
    watchUrl: 'https://www.youtube.com/watch?v=gfywsN483lI',
  };

  it('reports numberOfItems matching the list length', () => {
    const ld = videosItemListJsonLd(parseChannelFeed(SAMPLE_FEED)) as { numberOfItems: number; itemListElement: unknown[] };
    expect(ld.numberOfItems).toBe(2);
    expect(ld.numberOfItems).toBe(ld.itemListElement.length);

    const empty = videosItemListJsonLd([]) as { numberOfItems: number };
    expect(empty.numberOfItems).toBe(0);
  });

  it('includes the VideoObject duration when present', () => {
    const ld = videosItemListJsonLd([{ ...baseVideo, duration: 'PT4M12S' }]) as {
      itemListElement: Array<{ item: Record<string, unknown> }>;
    };
    expect(ld.itemListElement[0].item.duration).toBe('PT4M12S');
  });

  it('omits the duration key when absent (no empty/undefined value)', () => {
    const ld = videosItemListJsonLd([baseVideo]) as {
      itemListElement: Array<{ item: Record<string, unknown> }>;
    };
    expect('duration' in ld.itemListElement[0].item).toBe(false);
  });

  it('truncates long VideoObject descriptions (keeps the JSON-LD lean)', () => {
    const longDesc = 'அ '.repeat(900); // ~1800 chars
    const ld = videosItemListJsonLd([{ ...baseVideo, description: longDesc }]) as {
      itemListElement: Array<{ item: { description: string } }>;
    };
    const desc = ld.itemListElement[0].item.description;
    expect(desc.length).toBeLessThanOrEqual(200);
    expect(desc.endsWith('…')).toBe(true);
  });
});

describe('withTruncatedDescriptions', () => {
  const v = {
    id: 'gfywsN483lI',
    title: 'T',
    description: 'x'.repeat(500),
    publishedAt: '2026-01-01T00:00:00Z',
    thumbnail: s3ThumbnailUrl('gfywsN483lI'),
    watchUrl: 'https://www.youtube.com/watch?v=gfywsN483lI',
  };

  it('bounds long descriptions with an ellipsis, preserving every other field', () => {
    const [out] = withTruncatedDescriptions([v]);
    expect(out.description.length).toBeLessThanOrEqual(200);
    expect(out.description.endsWith('…')).toBe(true);
    expect(out.id).toBe(v.id);
    expect(out.title).toBe(v.title);
    expect(out.thumbnail).toBe(v.thumbnail);
    expect(out.watchUrl).toBe(v.watchUrl);
  });

  it('leaves a short description untouched and keeps an empty one empty', () => {
    expect(withTruncatedDescriptions([{ ...v, description: 'short' }])[0].description).toBe('short');
    expect(withTruncatedDescriptions([{ ...v, description: '' }])[0].description).toBe('');
  });

  it('does not mutate the input array/objects', () => {
    const input = [{ ...v }];
    withTruncatedDescriptions(input);
    expect(input[0].description.length).toBe(500);
  });
});

describe('s3ThumbnailUrl', () => {
  // Env-independent: the media base is S3 by default but CloudFront when
  // MEDIA_BASE_URL is configured (captured at import) — both are self-hosted.
  it('points at self-hosted media with the right key, not YouTube', () => {
    const url = s3ThumbnailUrl('abcdefghijk');
    expect(url).toMatch(/^https:\/\//);
    expect(url).toContain('/images/video-thumbs/abcdefghijk.jpg');
    expect(url).not.toMatch(/ytimg|youtube/);
  });
});
