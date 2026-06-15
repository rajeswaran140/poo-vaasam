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
  isByOwner: false, ownerHasReplied: false, needsReply: true, ...over,
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
  mockFetch.mockResolvedValueOnce([
    mk('answered', { needsReply: false, ownerHasReplied: true, publishedAt: '2026-06-15T00:00:00Z' }),
    mk('new', { publishedAt: '2026-06-14T00:00:00Z' }),
    mk('old', { publishedAt: '2026-06-10T00:00:00Z' }),
  ]);
  const res = await GET(req('?max=100'));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.comments.map((c: comments.CommentItem) => c.id)).toEqual(['new', 'old', 'answered']);
  expect(body.summary).toEqual({ total: 3, needsReply: 2, fromViewers: 3 });
});

it('502s on an upstream failure (never throws)', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockFetch.mockRejectedValueOnce(new Error('quota'));
  const res = await GET(req());
  expect(res.status).toBe(502);
});
