import {
  parseCommentThreads,
  summarizeComments,
  sortForTriage,
  commentDeepLink,
  flagComment,
  looksLikePhone,
  ownerChannelIds,
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

  it('counts total / needsReply / fromViewers / flagged', () => {
    expect(summarizeComments(items)).toEqual({
      total: 4, needsReply: 2, fromViewers: 3, flagged: 0, replyUnknown: 0, shown: 4,
    });
  });

  it('reports `shown` separately from `total` so tab counts are not the slice', () => {
    expect(summarizeComments(items, 2)).toMatchObject({ total: 4, needsReply: 2, shown: 2 });
  });

  it('puts needs-reply first, newest within each group', () => {
    const order = sortForTriage(items).map((c) => c.id);
    expect(order.slice(0, 2)).toEqual(['newNeedsReply', 'oldNeedsReply']); // both needsReply, newest first
    expect(order.slice(2)).toContain('owner');
    expect(order.slice(2)).toContain('answered');
  });
});

describe('flagComment (high-precision spam/promo/contact heuristics)', () => {
  it('does NOT flag genuine praise (Tamil or English)', () => {
    expect(flagComment('அருமையான பாடல் 🙏')).toEqual({ flagged: false, reasons: [] });
    expect(flagComment('Super song ❤️❤️')).toEqual({ flagged: false, reasons: [] });
    expect(flagComment('Released in 2024, still my favourite')).toEqual({ flagged: false, reasons: [] }); // a year is not a phone number
  });

  it('flags links / domains', () => {
    expect(flagComment('watch here http://spam.example/x').reasons).toContain('link');
    expect(flagComment('free followers www.bad.ly').reasons).toContain('link');
    expect(flagComment('go to cheapsmm.com now').reasons).toContain('link');
  });

  it('flags self-promotion', () => {
    expect(flagComment('Nice! check out my channel').reasons).toContain('promo');
    expect(flagComment('subscribe to my channel please').reasons).toContain('promo');
    expect(flagComment('please visit my page').reasons).toContain('promo');
  });

  it('flags contact info (phone / email)', () => {
    expect(flagComment('call me 077 123 4567').reasons).toContain('contact');
    expect(flagComment('whatsapp +94771234567').reasons).toContain('contact');
    expect(flagComment('mail me at seller@example.com').reasons).toContain('contact');
  });

  it('can attach multiple reasons', () => {
    const r = flagComment('subscribe to my channel youtube.com/abc').reasons;
    expect(r).toEqual(expect.arrayContaining(['promo', 'link']));
  });
});

describe('parseCommentThreads — flagging', () => {
  it('flags a spammy viewer comment with reasons', () => {
    const [c] = parseCommentThreads([thread({ id: 's1', text: 'check out my channel www.x.io' })], OWNER);
    expect(c.flagged).toBe(true);
    expect(c.flagReasons).toEqual(expect.arrayContaining(['promo', 'link']));
  });

  it('never flags the owner’s own comment, even with a link', () => {
    const [c] = parseCommentThreads(
      [thread({ id: 's2', authorChannelId: OWNER, text: 'New song: tamilagaval.com' })],
      OWNER
    );
    expect(c.isByOwner).toBe(true);
    expect(c.flagged).toBe(false);
    expect(c.flagReasons).toEqual([]);
  });
});

describe('commentDeepLink', () => {
  it('builds a watch-page link that highlights the comment', () => {
    expect(commentDeepLink({ videoId: 'abc', id: 'cmt1' })).toBe('https://www.youtube.com/watch?v=abc&lc=cmt1');
  });

  it('percent-encodes ids so they cannot break out of the query string', () => {
    expect(commentDeepLink({ videoId: 'a b&c', id: 'x=1' })).toBe(
      'https://www.youtube.com/watch?v=a%20b%26c&lc=x%3D1'
    );
  });
});

/* ------------------------------------------------------------------ *
 * REGRESSION: reply-list truncation (audit finding 7)
 * ------------------------------------------------------------------ */

describe('parseCommentThreads — truncated reply lists', () => {
  it('does NOT claim "needs reply" when YouTube returned fewer replies than exist', () => {
    // 9 replies on the thread, only 2 handed back — the owner's reply may be
    // among the 7 we cannot see, so guessing "unanswered" wastes the owner's time.
    const [c] = parseCommentThreads(
      [thread({ id: 'tr', totalReplyCount: 9, replyAuthorIds: ['UC_a', 'UC_b'] })],
      OWNER
    );
    expect(c.repliesTruncated).toBe(true);
    expect(c.needsReply).toBe(false);
    expect(c.ownerHasReplied).toBe(false);
  });

  it('is NOT truncated when every reply was returned', () => {
    const [c] = parseCommentThreads(
      [thread({ id: 'tf', totalReplyCount: 2, replyAuthorIds: ['UC_a', 'UC_b'] })],
      OWNER
    );
    expect(c.repliesTruncated).toBe(false);
    expect(c.needsReply).toBe(true);
  });

  it('a visible owner reply still wins over truncation', () => {
    const [c] = parseCommentThreads(
      [thread({ id: 'to', totalReplyCount: 9, replyAuthorIds: [OWNER] })],
      OWNER
    );
    expect(c.ownerHasReplied).toBe(true);
    expect(c.repliesTruncated).toBe(false);
    expect(c.needsReply).toBe(false);
  });

  it('counts unknown-reply-status threads in the summary', () => {
    const items = parseCommentThreads(
      [
        thread({ id: 'a', totalReplyCount: 9, replyAuthorIds: ['UC_a'] }),
        thread({ id: 'b' }),
      ],
      OWNER
    );
    expect(summarizeComments(items)).toMatchObject({ replyUnknown: 1, needsReply: 1 });
  });
});

/* ------------------------------------------------------------------ *
 * REGRESSION: multiple owner identities (audit finding 7, second half)
 * ------------------------------------------------------------------ */

describe('parseCommentThreads — multiple owner channel ids', () => {
  it('treats a reply from a secondary owner account as answered', () => {
    const [c] = parseCommentThreads(
      [thread({ id: 'm1', replyAuthorIds: ['UC_personal'] })],
      [OWNER, 'UC_personal']
    );
    expect(c.ownerHasReplied).toBe(true);
    expect(c.needsReply).toBe(false);
  });

  it('ownerChannelIds merges YOUTUBE_OWNER_CHANNEL_IDS and de-dupes', () => {
    const prev = process.env.YOUTUBE_OWNER_CHANNEL_IDS;
    process.env.YOUTUBE_OWNER_CHANNEL_IDS = ' UC_alt , UC_owner ,';
    expect(ownerChannelIds(OWNER)).toEqual([OWNER, 'UC_alt']);
    process.env.YOUTUBE_OWNER_CHANNEL_IDS = prev;
  });
});

/* ------------------------------------------------------------------ *
 * REGRESSION: flag false POSITIVES (audit finding 4)
 * Every string below is a plausible fan comment. None may be flagged.
 * ------------------------------------------------------------------ */

describe('flagComment — must not flag ordinary fan comments', () => {
  it.each([
    'Nice song.in tamil this is the best',
    'Thanks.me too I love it',
    'Super.co brother',
    'Beautiful voice.info about the singer?',
    'Amazing.tv quality',
    'Great song.live performance please',
  ])('word-like TLD after a period is not a link: %s', (t) => {
    expect(flagComment(t).flagged).toBe(false);
  });

  it.each([
    'Great work 2025 2026 keep going',
    'Best song of 2024 and 2025',
    'மிக அருமை. 1 2 3 4 5 6 7 8',
    'timestamps 0.00 intro 1.30 chorus 2.45 end',
    'congrats on 1 000 000 views',
    'congrats on 1000000 views',
  ])('digit runs that are not phone numbers: %s', (t) => {
    expect(flagComment(t).flagged).toBe(false);
  });

  it.each([
    'அருமையான பாடல் 🙏',
    'Super song ❤️❤️',
    'என் மனசை தொட்ட பாடல்',
    'I subscribed already, keep them coming',
  ])('plain praise: %s', (t) => {
    expect(flagComment(t).flagged).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * REGRESSION: flag false NEGATIVES (audit finding 3)
 * The heuristics scored 0/199 on live data because they were English-only.
 * ------------------------------------------------------------------ */

describe('flagComment — must catch real spam shapes', () => {
  it('catches Tamil self-promotion', () => {
    expect(flagComment('நல்ல பாடல் என் சேனலையும் பாருங்கள்').reasons).toContain('promo');
    expect(flagComment('என் வீடியோ பாருங்க').reasons).toContain('promo');
  });

  it('catches non-ASCII digits used to hide a phone number', () => {
    expect(flagComment('Whatsapp \u{1D7F5}\u{1D7F4}\u{1D7F0}\u{1D7F3}\u{1D7F2}\u{1D7EF}\u{1D7EE}\u{1D7ED}\u{1D7EC}\u{1D7F6}').reasons).toContain('contact');
    expect(flagComment('அழையுங்கள் ௦௭௭௧௨௩௪௫௬௭').reasons).toContain('contact');
  });

  it('catches sub-for-sub and follow-me solicitations', () => {
    expect(flagComment('plz sub back').reasons).toContain('promo');
    expect(flagComment('Follow my insta').reasons).toContain('promo');
    expect(flagComment('sub 4 sub anyone?').reasons).toContain('promo');
    expect(flagComment('contact me on whats app nine eight four seven').reasons).toContain('promo');
  });

  it('catches dot look-alikes used to disguise a domain', () => {
    expect(flagComment('visit t·me/spamchannel').reasons).toContain('link');
  });

  it('still catches a word-like TLD when it carries a path', () => {
    expect(flagComment('join t.me/freefollowers').reasons).toContain('link');
  });
});

describe('looksLikePhone', () => {
  it.each(['077 123 4567', '+94771234567', '(077) 123-4567'])('accepts %s', (t) => {
    expect(looksLikePhone(t)).toBe(true);
  });
  it.each(['2025 2026', '1 2 3 4 5 6 7 8', '1 000 000', '12345', '1234567890123456789'])(
    'rejects %s',
    (t) => {
      expect(looksLikePhone(t)).toBe(false);
    }
  );
});
