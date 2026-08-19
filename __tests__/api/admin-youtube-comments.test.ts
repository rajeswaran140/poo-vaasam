/** @jest-environment node */
/**
 * INTEGRATION TESTS — GET /api/admin/youtube/comments.
 * Auth gating, the not-configured gate, triage ordering/summary, upstream failure.
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/youtube-comments', () => ({
  ...jest.requireActual('@/lib/youtube-comments'),
  isCommentsConfigured: jest.fn(() => true),
  fetchChannelComments: jest.fn(),
}));

jest.mock('@/config/site', () => ({
  ...jest.requireActual('@/config/site'),
  isYouTubeVideosConfigured: jest.fn(() => true),
}));

import { GET } from '@/app/api/admin/youtube/comments/route';
import * as auth from '@/lib/auth-helper';
import * as comments from '@/lib/youtube-comments';

const mockRequireAdmin = auth.requireAdmin as jest.Mock;
const mockConfigured = comments.isCommentsConfigured as jest.Mock;
const mockFetch = comments.fetchChannelComments as jest.Mock;

const mk = (id: string, over: Partial<comments.CommentItem> = {}): comments.CommentItem => ({
  id, videoId: 'v', author: '@Viewer', authorChannelId: 'UCv', text: 'nice',
  likeCount: 0, publishedAt: '2026-06-14T00:00:00Z', totalReplyCount: 0,
  isByOwner: false, ownerHasReplied: false, repliesTruncated: false, needsReply: true,
  flagged: false, flagReasons: [], ...over,
});

/** A CommentScan as fetchChannelComments now returns it. */
const scan = (items: comments.CommentItem[], over: Partial<comments.CommentScan> = {}): comments.CommentScan => ({
  comments: items,
  summary: jest.requireActual('@/lib/youtube-comments').summarizeComments(items, items.length),
  scanned: items.length,
  hasMore: false,
  ...over,
});

const req = (qs = '') => new NextRequest(new Request(`http://localhost/api/admin/youtube/comments${qs}`));

beforeEach(() => {
  mockRequireAdmin.mockReset().mockResolvedValue({ isAuthenticated: true });
  mockConfigured.mockReset().mockReturnValue(true);
  mockFetch.mockReset();
});

it('401s when not an admin', async () => {
  const { AuthError } = jest.requireActual('@/lib/auth-helper');
  mockRequireAdmin.mockRejectedValueOnce(new AuthError('Unauthorized', 401));
  const res = await GET(req());
  expect(res.status).toBe(401);
  expect(mockFetch).not.toHaveBeenCalled();
});

it('503s when YouTube is not configured', async () => {
  mockConfigured.mockReturnValueOnce(false);
  const res = await GET(req());
  expect(res.status).toBe(503);
});

it('returns triaged comments (unanswered first) + summary', async () => {
  mockFetch.mockResolvedValueOnce(
    scan([
      mk('answered', { needsReply: false, ownerHasReplied: true, publishedAt: '2026-06-15T00:00:00Z' }),
      mk('new', { publishedAt: '2026-06-14T00:00:00Z' }),
      mk('old', { publishedAt: '2026-06-10T00:00:00Z' }),
    ])
  );
  const res = await GET(req('?max=100'));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.comments.map((c: comments.CommentItem) => c.id)).toEqual(['new', 'old', 'answered']);
  expect(body.summary).toEqual({
    total: 3, needsReply: 2, fromViewers: 3, flagged: 0, replyUnknown: 0, shown: 3,
  });
});

it('passes through scanned / hasMore so the UI can admit the window is capped', async () => {
  mockFetch.mockResolvedValueOnce(scan([mk('a')], { scanned: 200, hasMore: true }));
  const body = await (await GET(req('?max=200'))).json();
  expect(body).toMatchObject({ scanned: 200, hasMore: true });
});

it('502s on an upstream failure (never throws, never reports an empty inbox)', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockFetch.mockRejectedValueOnce(new Error('commentThreads.list HTTP 403 on page 1'));
  const res = await GET(req());
  expect(res.status).toBe(502);
  const body = await res.json();
  expect(body.success).toBe(false);
  // The client must not be able to mistake this for "no comments".
  expect(body.comments).toBeUndefined();
});

it('clamps `max` to the 10–200 range', async () => {
  mockFetch.mockResolvedValue(scan([mk('a')]));
  await GET(req('?max=9999'));
  expect(mockFetch).toHaveBeenLastCalledWith(expect.any(String), 200);
  await GET(req('?max=1'));
  expect(mockFetch).toHaveBeenLastCalledWith(expect.any(String), 10);
  await GET(req('?max=notanumber'));
  expect(mockFetch).toHaveBeenLastCalledWith(expect.any(String), 50);
});
