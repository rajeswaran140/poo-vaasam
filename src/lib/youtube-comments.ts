/**
 * YouTube comment triage for /admin/comments.
 *
 * Reads channel-wide comment threads via the Data API `commentThreads.list`
 * (`allThreadsRelatedToChannelId`) — a PUBLIC read, so it works with the
 * existing YOUTUBE_API_KEY (no OAuth). Replying still needs Studio/write, so the
 * UI deep-links each comment to its watch page; this layer only surfaces WHICH
 * comments are waiting on the owner.
 *
 * "Needs reply" = a viewer's top-level comment (not the channel owner's own
 * pinned/promo comment) that the owner hasn't replied to in-thread.
 */

const COMMENTS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/commentThreads';

export interface CommentItem {
  id: string;
  videoId: string;
  author: string;
  authorChannelId: string;
  text: string;
  likeCount: number;
  publishedAt: string;
  totalReplyCount: number;
  /** Top-level comment authored by the channel owner (pinned/promo). */
  isByOwner: boolean;
  /** The owner has replied somewhere in this thread. */
  ownerHasReplied: boolean;
  /** Viewer comment the owner hasn't answered → the triage queue. */
  needsReply: boolean;
}

export interface CommentSummary {
  total: number;
  needsReply: number;
  fromViewers: number;
}

/** Parse `commentThreads.list` items into triage rows. Pure. */
export function parseCommentThreads(items: any[], ownerChannelId: string): CommentItem[] {
  const out: CommentItem[] = [];
  for (const it of items ?? []) {
    const top = it?.snippet?.topLevelComment?.snippet;
    if (!top) continue;
    const authorChannelId = String(top.authorChannelId?.value ?? '');
    const isByOwner = !!ownerChannelId && authorChannelId === ownerChannelId;
    const replies: any[] = it?.replies?.comments ?? [];
    const ownerHasReplied =
      !!ownerChannelId &&
      replies.some((r) => String(r?.snippet?.authorChannelId?.value ?? '') === ownerChannelId);
    out.push({
      id: String(it.id ?? ''),
      videoId: String(it?.snippet?.videoId ?? ''),
      author: String(top.authorDisplayName ?? ''),
      authorChannelId,
      text: String(top.textOriginal ?? top.textDisplay ?? ''),
      likeCount: Number(top.likeCount ?? 0),
      publishedAt: String(top.publishedAt ?? ''),
      totalReplyCount: Number(it?.snippet?.totalReplyCount ?? 0),
      isByOwner,
      ownerHasReplied,
      needsReply: !isByOwner && !ownerHasReplied,
    });
  }
  return out;
}

export function summarizeComments(items: CommentItem[]): CommentSummary {
  return {
    total: items.length,
    needsReply: items.filter((c) => c.needsReply).length,
    fromViewers: items.filter((c) => !c.isByOwner).length,
  };
}

/** Triage order: unanswered viewer comments first, then most-recent. Pure. */
export function sortForTriage(items: CommentItem[]): CommentItem[] {
  return [...items].sort((a, b) => {
    if (a.needsReply !== b.needsReply) return a.needsReply ? -1 : 1;
    const tb = Date.parse(b.publishedAt) || 0;
    const ta = Date.parse(a.publishedAt) || 0;
    return tb - ta;
  });
}

export function isCommentsConfigured(): boolean {
  return Boolean(process.env.YOUTUBE_API_KEY);
}

/** Watch-page deep link that highlights a specific comment (for replying). */
export function commentDeepLink(c: Pick<CommentItem, 'videoId' | 'id'>): string {
  return `https://www.youtube.com/watch?v=${c.videoId}&lc=${c.id}`;
}

/** Fetch recent channel-wide comment threads (API key) and parse them. */
export async function fetchChannelComments(channelId: string, max = 50): Promise<CommentItem[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key || !channelId) return [];
  const raw: any[] = [];
  let pageToken: string | undefined;
  // Up to 4 pages × 50 = 200 threads; 1 quota unit each.
  for (let i = 0; i < 4 && raw.length < max; i++) {
    const url = new URL(COMMENTS_ENDPOINT);
    url.searchParams.set('part', 'snippet,replies');
    url.searchParams.set('allThreadsRelatedToChannelId', channelId);
    url.searchParams.set('maxResults', '50');
    url.searchParams.set('order', 'time');
    url.searchParams.set('key', key);
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url.toString(), { next: { revalidate: 300 } });
    if (!res.ok) break;
    const json = (await res.json()) as { items?: unknown[]; nextPageToken?: string };
    raw.push(...(json.items ?? []));
    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }
  return parseCommentThreads(raw.slice(0, max), channelId);
}
