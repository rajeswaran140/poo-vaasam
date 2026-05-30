/** @jest-environment node */
/**
 * Unit tests for src/lib/youtube-api.ts — pure helpers (no network) plus
 * the public-API wrappers with `fetch` stubbed to a fixed JSON payload.
 */

import {
  parseIsoDurationSeconds,
  formatDuration,
  isYouTubeApiConfigured,
  fetchChannelStats,
  fetchChannelVideoStats,
} from '@/lib/youtube-api';

describe('parseIsoDurationSeconds', () => {
  it('parses H + M + S forms', () => {
    expect(parseIsoDurationSeconds('PT1H2M3S')).toBe(3723);
    expect(parseIsoDurationSeconds('PT4M15S')).toBe(255);
    expect(parseIsoDurationSeconds('PT45S')).toBe(45);
    expect(parseIsoDurationSeconds('PT2H')).toBe(7200);
  });
  it('handles garbage gracefully', () => {
    expect(parseIsoDurationSeconds('')).toBe(0);
    expect(parseIsoDurationSeconds('not a duration')).toBe(0);
    expect(parseIsoDurationSeconds('PT')).toBe(0);
  });
});

describe('formatDuration', () => {
  it('drops the hour when zero', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(185)).toBe('3:05');
  });
  it('renders H:MM:SS once we cross the hour', () => {
    expect(formatDuration(3723)).toBe('1:02:03');
    expect(formatDuration(7200)).toBe('2:00:00');
  });
  it('guards against bad input', () => {
    expect(formatDuration(NaN)).toBe('0:00');
    expect(formatDuration(-10)).toBe('0:00');
    expect(formatDuration(Infinity)).toBe('0:00');
  });
});

describe('isYouTubeApiConfigured', () => {
  const original = process.env.YOUTUBE_API_KEY;
  afterEach(() => { process.env.YOUTUBE_API_KEY = original; });

  it('reflects YOUTUBE_API_KEY presence', () => {
    delete process.env.YOUTUBE_API_KEY;
    expect(isYouTubeApiConfigured()).toBe(false);
    process.env.YOUTUBE_API_KEY = 'fake-key';
    expect(isYouTubeApiConfigured()).toBe(true);
  });
});

describe('fetchChannelStats', () => {
  const original = process.env.YOUTUBE_API_KEY;
  beforeEach(() => { process.env.YOUTUBE_API_KEY = 'fake-key'; });
  afterEach(() => {
    process.env.YOUTUBE_API_KEY = original;
    jest.restoreAllMocks();
  });

  it('returns null when no API key is configured', async () => {
    delete process.env.YOUTUBE_API_KEY;
    const out = await fetchChannelStats('UCabc123');
    expect(out).toBeNull();
  });

  it('returns null when channelId is empty', async () => {
    const out = await fetchChannelStats('');
    expect(out).toBeNull();
  });

  it('parses a valid channels.list response', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({
        items: [{
          id: 'UCabc',
          snippet: { title: 'My Channel' },
          statistics: { subscriberCount: '1234', viewCount: '56789', videoCount: '12' },
          contentDetails: { relatedPlaylists: { uploads: 'UUabc' } },
        }],
      }),
      { status: 200 }
    ));

    const out = await fetchChannelStats('UCabc');
    expect(out).toEqual({
      channelId: 'UCabc',
      title: 'My Channel',
      subscriberCount: 1234,
      viewCount: 56789,
      videoCount: 12,
      uploadsPlaylistId: 'UUabc',
    });
    // Key should be appended as a query param, never logged in error.
    const calledWith = (fetchMock.mock.calls[0]?.[0] ?? '') as string;
    expect(calledWith).toContain('key=fake-key');
  });

  it('returns null on upstream non-OK response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('quota exceeded', { status: 403 }));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const out = await fetchChannelStats('UCabc');
    expect(out).toBeNull();
  });

  it('returns null when the channel is not found', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{"items": []}', { status: 200 }));
    const out = await fetchChannelStats('UCmissing');
    expect(out).toBeNull();
  });
});

describe('fetchChannelVideoStats', () => {
  const original = process.env.YOUTUBE_API_KEY;
  beforeEach(() => { process.env.YOUTUBE_API_KEY = 'fake-key'; });
  afterEach(() => {
    process.env.YOUTUBE_API_KEY = original;
    jest.restoreAllMocks();
  });

  it('returns [] when no API key is configured', async () => {
    delete process.env.YOUTUBE_API_KEY;
    const out = await fetchChannelVideoStats('UCabc', 10);
    expect(out).toEqual([]);
  });

  it('returns [] when the channel has no uploads playlist', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ items: [{ id: 'UCabc', snippet: {}, statistics: {}, contentDetails: {} }] }),
      { status: 200 }
    ));
    const out = await fetchChannelVideoStats('UCabc');
    expect(out).toEqual([]);
  });

  it('hydrates per-video stats from playlistItems + videos.list', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/channels?')) {
        return new Response(JSON.stringify({
          items: [{
            id: 'UCabc',
            snippet: { title: 'Ch' },
            statistics: { subscriberCount: '1', viewCount: '2', videoCount: '3' },
            contentDetails: { relatedPlaylists: { uploads: 'UUabc' } },
          }],
        }), { status: 200 });
      }
      if (url.includes('/playlistItems?')) {
        return new Response(JSON.stringify({
          items: [
            { contentDetails: { videoId: 'vid1' } },
            { contentDetails: { videoId: 'vid2' } },
          ],
        }), { status: 200 });
      }
      if (url.includes('/videos?')) {
        return new Response(JSON.stringify({
          items: [
            {
              id: 'vid1',
              snippet: {
                title: 'First',
                publishedAt: '2026-05-01T00:00:00Z',
                thumbnails: { medium: { url: 'https://i.ytimg.com/vi/vid1/mqdefault.jpg' } },
              },
              statistics: { viewCount: '100', likeCount: '10', commentCount: '2' },
              contentDetails: { duration: 'PT3M15S' },
            },
            {
              id: 'vid2',
              snippet: {
                title: 'Second',
                publishedAt: '2026-05-02T00:00:00Z',
                thumbnails: { default: { url: 'https://i.ytimg.com/vi/vid2/default.jpg' } },
              },
              statistics: { viewCount: '50', likeCount: '5', commentCount: '0' },
              contentDetails: { duration: 'PT1M' },
            },
          ],
        }), { status: 200 });
      }
      throw new Error(`unexpected URL: ${url}`);
    });

    const out = await fetchChannelVideoStats('UCabc', 50);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      id: 'vid1',
      title: 'First',
      viewCount: 100,
      likeCount: 10,
      commentCount: 2,
      durationSeconds: 195,
    });
    // Falls back to default thumbnail when medium is missing.
    expect(out[1].thumbnail).toBe('https://i.ytimg.com/vi/vid2/default.jpg');
    // Three upstream calls in total: channels, playlistItems, videos.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('caps limit to YouTube playlistItems max (50)', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/channels?')) {
        return new Response(JSON.stringify({
          items: [{ id: 'UCabc', snippet: {}, statistics: {}, contentDetails: { relatedPlaylists: { uploads: 'UUabc' } } }],
        }), { status: 200 });
      }
      return new Response('{"items": []}', { status: 200 });
    });

    await fetchChannelVideoStats('UCabc', 200);
    const playlistCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/playlistItems?'));
    expect(String(playlistCall?.[0])).toContain('maxResults=50');
  });
});
