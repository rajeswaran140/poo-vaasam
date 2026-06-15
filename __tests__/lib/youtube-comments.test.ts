import {
  parseCommentThreads,
  summarizeComments,
  sortForTriage,
  commentDeepLink,
  type CommentItem,
} from '@/lib/youtube-comments';

const OWNER = 'UC_owner';

const thread = (over: {
  id: string;
  videoId?: string;
  author?: string;
  authorChannelId?: string;
  text?: string;
  publishedAt?: string;
  likeCount?: number;
  totalReplyCount?: number;
  replyAuthorIds?: string[];
}) => ({
  id: over.id,
  snippet: {
    videoId: over.videoId ?? 'vid1',
    totalReplyCount: over.totalReplyCount ?? (over.replyAuthorIds?.length ?? 0),
    topLevelComment: {
      snippet: {
        authorDisplayName: over.author ?? '@Viewer',
        authorChannelId: { value: over.authorChannelId ?? 'UC_viewer' },
        textOriginal: over.text ?? 'nice song',
        likeCount: over.likeCount ?? 0,
        publishedAt: over.publishedAt ?? '2026-06-14T00:00:00Z',
      },
    },
  },
  replies: over.replyAuthorIds
    ? { comments: over.replyAuthorIds.map((id) => ({ snippet: { authorChannelId: { value: id } } })) }
    : undefined,
});

describe('parseCommentThreads', () => {
  it('flags a viewer comment with no owner reply as needsReply', () => {
    const [c] = parseCommentThreads([thread({ id: 't1' })], OWNER);
    expect(c).toMatchObject({ isByOwner: false, ownerHasReplied: false, needsReply: true, videoId: 'vid1', author: '@Viewer' });
  });

  it('does NOT flag the owner’s own (pinned/promo) comment', () => {
    const [c] = parseCommentThreads([thread({ id: 't2', authorChannelId: OWNER, author: '@Tamilagaval' })], OWNER);
    expect(c.isByOwner).toBe(true);
    expect(c.needsReply).toBe(false);
  });

  it('does NOT flag a thread the owner has already replied to', () => {
    const [c] = parseCommentThreads([thread({ id: 't3', replyAuthorIds: ['UC_viewer', OWNER] })], OWNER);
    expect(c.ownerHasReplied).toBe(true);
    expect(c.needsReply).toBe(false);
  });

  it('skips malformed items (no top-level comment)', () => {
    expect(parseCommentThreads([{ id: 'x' }, null], OWNER)).toEqual([]);
  });
});

describe('summarizeComments + sortForTriage', () => {
  const items: CommentItem[] = parseCommentThreads(
    [
      thread({ id: 'owner', authorChannelId: OWNER, publishedAt: '2026-06-15T00:00:00Z' }),
      thread({ id: 'answered', replyAuthorIds: [OWNER], publishedAt: '2026-06-13T00:00:00Z' }),
      thread({ id: 'newNeedsReply', publishedAt: '2026-06-14T00:00:00Z' }),
      thread({ id: 'oldNeedsReply', publishedAt: '2026-06-10T00:00:00Z' }),
    ],
    OWNER
  );

  it('counts total / needsReply / fromViewers', () => {
    expect(summarizeComments(items)).toEqual({ total: 4, needsReply: 2, fromViewers: 3 });
  });

  it('puts needs-reply first, newest within each group', () => {
    const order = sortForTriage(items).map((c) => c.id);
    expect(order.slice(0, 2)).toEqual(['newNeedsReply', 'oldNeedsReply']); // both needsReply, newest first
    expect(order.slice(2)).toContain('owner');
    expect(order.slice(2)).toContain('answered');
  });
});

describe('commentDeepLink', () => {
  it('builds a watch-page link that highlights the comment', () => {
    expect(commentDeepLink({ videoId: 'abc', id: 'cmt1' })).toBe('https://www.youtube.com/watch?v=abc&lc=cmt1');
  });
});
