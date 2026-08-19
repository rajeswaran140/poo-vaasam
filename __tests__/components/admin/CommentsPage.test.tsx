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
  repliesTruncated: false,
};

const COMMENTS: CommentItem[] = [
  { ...base, id: 'praise', author: '@Fan', text: 'அருமையான பாடல்', needsReply: true, flagged: false, flagReasons: [] },
  { ...base, id: 'spam', author: '@Bot', text: 'check out my channel www.x.io', needsReply: true, flagged: true, flagReasons: ['promo', 'link'] },
  { ...base, id: 'answered', author: '@Two', text: 'thanks', needsReply: false, ownerHasReplied: true, flagged: false, flagReasons: [] },
];

const SUMMARY = { total: 3, needsReply: 2, fromViewers: 3, flagged: 1, replyUnknown: 0, shown: 3 };

const payload = (over: Record<string, unknown> = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({
    success: true, comments: COMMENTS, summary: SUMMARY, scanned: 3, hasMore: false, ...over,
  }),
});

beforeEach(() => {
  adminFetch.mockReset();
  adminFetch.mockResolvedValue(payload());
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

it('requests a scan window wide enough to hold the whole queue', async () => {
  render(<CommentsPage />);
  await screen.findByText('அருமையான பாடல்');
  expect(adminFetch).toHaveBeenCalledWith('/api/admin/youtube/comments?max=200');
});

/* --- audit fix: the owner's own pins no longer eat the queue --- */

describe('own comments', () => {
  const withMine = [
    ...COMMENTS,
    { ...base, id: 'mine', author: '@Tamilagaval', text: 'pinned promo', isByOwner: true, needsReply: false, flagged: false, flagReasons: [] },
  ];

  beforeEach(() => {
    adminFetch.mockResolvedValue(payload({ comments: withMine, summary: { ...SUMMARY, total: 4, shown: 4 } }));
  });

  it('hides the owner’s own pinned comments by default', async () => {
    render(<CommentsPage />);
    await screen.findByText('அருமையான பாடல்');
    expect(screen.queryByText('pinned promo')).not.toBeInTheDocument();
  });

  it('shows them when the toggle is unticked, with a count', async () => {
    render(<CommentsPage />);
    await screen.findByText('அருமையான பாடல்');
    const box = screen.getByLabelText(/Hide my own comments \(1\)/);
    fireEvent.click(box);
    expect(await screen.findByText('pinned promo')).toBeInTheDocument();
  });
});

/* --- audit fix: an upstream failure must not read as an empty inbox --- */

describe('upstream failure', () => {
  it('shows an error, NOT “No comments yet”', async () => {
    adminFetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ success: false, error: 'Failed to load comments' }),
    });
    render(<CommentsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load comments');
    expect(screen.queryByText(/No comments yet/)).not.toBeInTheDocument();
  });
});

/* --- audit fix: honest scan disclosure --- */

describe('scan disclosure', () => {
  it('says the window is capped when more threads exist', async () => {
    adminFetch.mockResolvedValue(payload({ scanned: 200, hasMore: true }));
    render(<CommentsPage />);
    expect(await screen.findByText(/Scanned 200 threads/)).toBeInTheDocument();
    expect(screen.getByText(/more beyond this window/)).toBeInTheDocument();
  });

  it('discloses threads whose reply status is unknown', async () => {
    adminFetch.mockResolvedValue(
      payload({
        comments: [{ ...base, id: 'tr', author: '@Fan', text: 'long thread', needsReply: false, repliesTruncated: true, totalReplyCount: 9, flagged: false, flagReasons: [] }],
        summary: { ...SUMMARY, replyUnknown: 1 },
      })
    );
    render(<CommentsPage />);
    expect(await screen.findByText(/reply status is unknown/)).toBeInTheDocument();
    expect(screen.getByText('reply status unknown')).toBeInTheDocument();
  });

  it('stays quiet when the scan was complete and clean', async () => {
    render(<CommentsPage />);
    await screen.findByText('அருமையான பாடல்');
    expect(screen.queryByText(/Scanned/)).not.toBeInTheDocument();
  });
});

/* --- audit fix: role="tab" now behaves like a tablist --- */

describe('tab accessibility', () => {
  it('wires aria-controls/aria-labelledby to a real tabpanel', async () => {
    render(<CommentsPage />);
    const tab = await screen.findByRole('tab', { name: /All · 3/ });
    const panel = screen.getByRole('tabpanel');
    expect(tab).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', tab.id);
  });

  it('moves selection with arrow keys and rovers tabindex', async () => {
    render(<CommentsPage />);
    const all = await screen.findByRole('tab', { name: /All · 3/ });
    expect(all).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(all, { key: 'ArrowRight' });
    const needs = screen.getByRole('tab', { name: /Needs reply · 2/ });
    await waitFor(() => expect(needs).toHaveAttribute('aria-selected', 'true'));
    expect(needs).toHaveAttribute('tabindex', '0');
    expect(all).toHaveAttribute('tabindex', '-1');
  });

  it('wraps from the first tab back to the last', async () => {
    render(<CommentsPage />);
    const all = await screen.findByRole('tab', { name: /All · 3/ });
    fireEvent.keyDown(all, { key: 'ArrowLeft' });
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /Flagged · 1/ })).toHaveAttribute('aria-selected', 'true')
    );
  });
});
