/**
 * Tests for /admin/comments — the moderation triage view.
 * Verifies the flag chip renders with reasons and the All / Needs reply / Flagged
 * tabs filter the loaded list. adminFetch is mocked to serve one payload.
 */

const adminFetch = jest.fn();
jest.mock('@/lib/client-auth', () => ({ adminFetch: (...a: unknown[]) => adminFetch(...a) }));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CommentsPage from '@/app/(admin)/admin/comments/page';
import type { CommentItem } from '@/lib/youtube-comments';

const base = {
  videoId: 'vid1',
  authorChannelId: 'UC_v',
  likeCount: 0,
  publishedAt: '2026-06-20T00:00:00Z',
  totalReplyCount: 0,
  isByOwner: false,
  ownerHasReplied: false,
};

const COMMENTS: CommentItem[] = [
  { ...base, id: 'praise', author: '@Fan', text: 'அருமையான பாடல்', needsReply: true, flagged: false, flagReasons: [] },
  { ...base, id: 'spam', author: '@Bot', text: 'check out my channel www.x.io', needsReply: true, flagged: true, flagReasons: ['promo', 'link'] },
  { ...base, id: 'answered', author: '@Two', text: 'thanks', needsReply: false, ownerHasReplied: true, flagged: false, flagReasons: [] },
];

const SUMMARY = { total: 3, needsReply: 2, fromViewers: 3, flagged: 1 };

beforeEach(() => {
  adminFetch.mockReset();
  adminFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true, comments: COMMENTS, summary: SUMMARY }),
  });
});

it('renders the flag chip with its reasons', async () => {
  render(<CommentsPage />);
  expect(await screen.findByText(/check out my channel/)).toBeInTheDocument();
  expect(screen.getByText(/⚑ self-promo · link/)).toBeInTheDocument(); // mapped reason labels
});

it('shows tab counts from the summary', async () => {
  render(<CommentsPage />);
  expect(await screen.findByRole('tab', { name: /All · 3/ })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: /Needs reply · 2/ })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: /Flagged · 1/ })).toBeInTheDocument();
});

it('Flagged tab filters to only flagged comments', async () => {
  render(<CommentsPage />);
  await screen.findByText('அருமையான பாடல்'); // all visible initially
  fireEvent.click(screen.getByRole('tab', { name: /Flagged · 1/ }));
  await waitFor(() => expect(screen.queryByText('அருமையான பாடல்')).not.toBeInTheDocument());
  expect(screen.getByText(/check out my channel/)).toBeInTheDocument(); // the flagged one stays
});

it('Needs reply tab hides answered comments', async () => {
  render(<CommentsPage />);
  await screen.findByText('thanks'); // answered visible under All
  fireEvent.click(screen.getByRole('tab', { name: /Needs reply · 2/ }));
  await waitFor(() => expect(screen.queryByText('thanks')).not.toBeInTheDocument());
  expect(screen.getByText('அருமையான பாடல்')).toBeInTheDocument();
});
