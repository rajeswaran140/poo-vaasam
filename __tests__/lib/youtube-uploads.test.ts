/** @jest-environment node */
/**
 * fetchChannelUploadsWithDurations — list a channel's uploads (id + title) with
 * their ISO-8601 durations, via the YouTube Data API. The publish flow uses it
 * to auto-link a new song to its long-form video and read that video's duration.
 */

import { fetchChannelUploadsWithDurations } from '@/lib/youtube-uploads';

const CH = 'UCabcdefghijklmnopqrstuv';
const originalFetch = global.fetch;
beforeEach(() => {
  // Start every test key-less — the ambient env (e.g. the Amplify/CI build) may
  // have YOUTUBE_API_KEY set, which would leak into the no-key case.
  delete process.env.YOUTUBE_API_KEY;
});
afterEach(() => {
  global.fetch = originalFetch;
  delete process.env.YOUTUBE_API_KEY;
});

it('returns [] (no network) without an API key', async () => {
  const fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  expect(await fetchChannelUploadsWithDurations(CH)).toEqual([]);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('lists uploads and attaches durations', async () => {
  process.env.YOUTUBE_API_KEY = 'k';
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          { snippet: { title: 'Song A', resourceId: { videoId: 'aaaaaaaaaaa' } } },
          { snippet: { title: 'Song B', resourceId: { videoId: 'bbbbbbbbbbb' } } },
        ],
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          { id: 'aaaaaaaaaaa', contentDetails: { duration: 'PT4M14S' } },
          { id: 'bbbbbbbbbbb', contentDetails: { duration: 'PT50S' } },
        ],
      }),
    }) as unknown as typeof fetch;

  const out = await fetchChannelUploadsWithDurations(CH);
  expect(out).toEqual([
    { id: 'aaaaaaaaaaa', title: 'Song A', duration: 'PT4M14S' },
    { id: 'bbbbbbbbbbb', title: 'Song B', duration: 'PT50S' },
  ]);
});

it('targets the uploads playlist (UU…) for the channel', async () => {
  process.env.YOUTUBE_API_KEY = 'k';
  const fetchMock = jest
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) });
  global.fetch = fetchMock as unknown as typeof fetch;
  await fetchChannelUploadsWithDurations(CH);
  expect(String(fetchMock.mock.calls[0][0])).toContain('playlistId=UUabcdefghijklmnopqrstuv');
});

it('follows nextPageToken to gather more than one page', async () => {
  process.env.YOUTUBE_API_KEY = 'k';
  const fetchMock = jest
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ snippet: { title: 'A', resourceId: { videoId: 'aaaaaaaaaaa' } } }], nextPageToken: 'P2' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ snippet: { title: 'B', resourceId: { videoId: 'bbbbbbbbbbb' } } }] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) }); // durations
  global.fetch = fetchMock as unknown as typeof fetch;

  const out = await fetchChannelUploadsWithDurations(CH);
  expect(out.map((u) => u.id)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb']);
  expect(String(fetchMock.mock.calls[1][0])).toContain('pageToken=P2');
});

it('still returns the uploads if the durations call fails', async () => {
  process.env.YOUTUBE_API_KEY = 'k';
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ snippet: { title: 'A', resourceId: { videoId: 'aaaaaaaaaaa' } } }] }) })
    .mockResolvedValueOnce({ ok: false }) as unknown as typeof fetch; // durations fail
  const out = await fetchChannelUploadsWithDurations(CH);
  expect(out).toEqual([{ id: 'aaaaaaaaaaa', title: 'A' }]);
});

it('returns [] when the playlist request fails', async () => {
  process.env.YOUTUBE_API_KEY = 'k';
  global.fetch = jest.fn().mockResolvedValueOnce({ ok: false }) as unknown as typeof fetch;
  expect(await fetchChannelUploadsWithDurations(CH)).toEqual([]);
});
