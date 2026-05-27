/** @jest-environment node */
/**
 * Tests for the YouTube RSS feed parser/fetcher.
 */

import { parseChannelFeed, fetchChannelVideos } from '@/lib/youtube-feed';

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
  <media:group><media:thumbnail url="https://i.ytimg.com/vi/gfywsN483lI/hqdefault.jpg"/></media:group>
 </entry>
 <entry>
  <id>yt:video:abcdefghijk</id>
  <yt:videoId>abcdefghijk</yt:videoId>
  <title>Second Video</title>
  <published>2026-04-01T10:00:00+00:00</published>
 </entry>
</feed>`;

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

describe('parseChannelFeed', () => {
  it('parses entries into video objects (ignoring the channel header title)', () => {
    const videos = parseChannelFeed(SAMPLE_FEED);
    expect(videos).toHaveLength(2);

    expect(videos[0]).toEqual({
      id: 'gfywsN483lI',
      title: 'பூ வாசம் & காதல்', // &amp; decoded
      publishedAt: '2026-05-01T10:00:00+00:00',
      thumbnail: 'https://i.ytimg.com/vi/gfywsN483lI/hqdefault.jpg',
      watchUrl: 'https://www.youtube.com/watch?v=gfywsN483lI',
    });
    expect(videos[1].id).toBe('abcdefghijk');
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

  it('returns [] on a non-OK response or thrown error', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
    expect(await fetchChannelVideos('UCabcdefghijklmnopqrstuv')).toEqual([]);

    global.fetch = jest.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
    expect(await fetchChannelVideos('UCabcdefghijklmnopqrstuv')).toEqual([]);
  });
});
