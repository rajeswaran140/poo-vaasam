/** @jest-environment node */
/**
 * fetchChannelComments — the scan/slice/failure contract.
 *
 * These lock in three audit fixes:
 *   • an upstream failure THROWS (it used to `break` and render as "No comments yet")
 *   • the whole scanned window is triage-sorted BEFORE it is sliced to `max`
 *   • the request is uncached, so the page's Refresh button actually refreshes
 */

jest.mock('@/lib/fetch-retry', () => ({ fetchWithRetry: jest.fn() }));

import { fetchChannelComments } from '@/lib/youtube-comments';
import { fetchWithRetry } from '@/lib/fetch-retry';

const mockFetch = fetchWithRetry as jest.Mock;
const OWNER = 'UC_owner';

/** One commentThreads.list item. */
const thread = (id: string, over: { publishedAt?: string; replyAuthorIds?: string[]; author?: string } = {}) => ({
  id,
  snippet: {
    videoId: 'v1',
    totalReplyCount: over.replyAuthorIds?.length ?? 0,
    topLevelComment: {
      snippet: {
        authorDisplayName: over.author ?? '@Viewer',
        authorChannelId: { value: 'UC_viewer' },
        textOriginal: 'super',
        likeCount: 0,
        publishedAt: over.publishedAt ?? '2026-06-14T00:00:00Z',
      },
    },
  },
  ...(over.replyAuthorIds
    ? { replies: { comments: over.replyAuthorIds.map((a) => ({ snippet: { authorChannelId: { value: a } } })) } }
    : {}),
});

const page = (items: unknown[], nextPageToken?: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ items, nextPageToken }),
});

beforeEach(() => {
  mockFetch.mockReset();
  process.env.YOUTUBE_API_KEY = 'test-key';
});

describe('upstream failure', () => {
  it('THROWS instead of returning an empty scan (a dead key must not look like an empty inbox)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) });
    await expect(fetchChannelComments('UC_owner', 100)).rejects.toThrow(/403/);
  });

  it('throws even when an EARLIER page already succeeded (no silent partial scan)', async () => {
    mockFetch
      .mockResolvedValueOnce(page([thread('a')], 'tok2'))
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(fetchChannelComments('UC_owner', 100)).rejects.toThrow(/500/);
  });

  it('returns an empty scan (no request) when unconfigured', async () => {
    delete process.env.YOUTUBE_API_KEY;
    const scan = await fetchChannelComments('UC_owner', 100);
    expect(scan.comments).toEqual([]);
    expect(scan.summary.total).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('scan window vs returned slice', () => {
  it('sorts the WHOLE window before slicing, so an old unanswered comment is not lost', async () => {
    // Page 1: 2 answered but NEWER. Page 2: 1 unanswered but OLDER.
    // Slicing by recency first (the old bug) would drop the only actionable row.
    mockFetch
      .mockResolvedValueOnce(
        page(
          [
            thread('new1', { publishedAt: '2026-08-10T00:00:00Z', replyAuthorIds: [OWNER] }),
            thread('new2', { publishedAt: '2026-08-09T00:00:00Z', replyAuthorIds: [OWNER] }),
          ],
          'tok2'
        )
      )
      .mockResolvedValueOnce(page([thread('oldUnanswered', { publishedAt: '2026-06-27T00:00:00Z' })]));

    const scan = await fetchChannelComments(OWNER, 1);
    expect(scan.comments.map((c) => c.id)).toEqual(['oldUnanswered']);
    expect(scan.scanned).toBe(3);
  });

  it('summary counts the whole window while `shown` counts the slice', async () => {
    mockFetch.mockResolvedValueOnce(
      page([thread('a'), thread('b'), thread('c')])
    );
    const scan = await fetchChannelComments(OWNER, 2);
    expect(scan.summary).toMatchObject({ total: 3, needsReply: 3, shown: 2 });
    expect(scan.comments).toHaveLength(2);
  });

  it('stops paging when YouTube runs out of pages and reports hasMore=false', async () => {
    mockFetch.mockResolvedValueOnce(page([thread('a')]));
    const scan = await fetchChannelComments(OWNER, 200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(scan.hasMore).toBe(false);
  });

  it('caps the scan at 4 pages and reports hasMore=true when more remain', async () => {
    mockFetch.mockResolvedValue(page([thread('x')], 'always-more'));
    const scan = await fetchChannelComments(OWNER, 200);
    expect(mockFetch).toHaveBeenCalledTimes(4);
    expect(scan.hasMore).toBe(true);
    expect(scan.scanned).toBe(4);
  });
});

describe('request shape', () => {
  it('reads through the cache so Refresh is not a five-minute no-op', async () => {
    mockFetch.mockResolvedValueOnce(page([thread('a')]));
    await fetchChannelComments(OWNER, 10);
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ cache: 'no-store' });
  });

  it('requests replies and newest-first ordering', async () => {
    mockFetch.mockResolvedValueOnce(page([thread('a')]));
    await fetchChannelComments(OWNER, 10);
    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(url.searchParams.get('part')).toBe('snippet,replies');
    expect(url.searchParams.get('order')).toBe('time');
    expect(url.searchParams.get('allThreadsRelatedToChannelId')).toBe(OWNER);
    expect(url.searchParams.get('maxResults')).toBe('50');
  });
});
