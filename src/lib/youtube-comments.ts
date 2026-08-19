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
 *
 * SCAN vs SHOW: the triage queue must not be a function of recency. We scan a
 * fixed window of the newest threads (MAX_PAGES × PAGE_SIZE), sort the WHOLE
 * window unanswered-first, and only then slice to the caller's `max`. Slicing
 * before sorting silently hides older unanswered comments — which is exactly
 * the thing this page exists to prevent.
 */

import { fetchWithRetry } from '@/lib/fetch-retry';

const COMMENTS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/commentThreads';

/** commentThreads.list page size (API max) and how many pages we scan per load.
 *  4 × 50 = 200 threads for 4 quota units (the daily budget is 10,000). */
const PAGE_SIZE = 50;
const MAX_PAGES = 4;

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
  /** The owner has replied somewhere in the replies we can see. */
  ownerHasReplied: boolean;
  /**
   * The API returned fewer replies than `totalReplyCount`, so we cannot know
   * whether the owner already answered. Such a thread is NOT put in the
   * needs-reply queue — a false "needs reply" wastes the owner's time.
   */
  repliesTruncated: boolean;
  /** Viewer comment the owner demonstrably hasn't answered → the triage queue. */
  needsReply: boolean;
  /** Heuristically likely spam/promo/contact — surfaced for a faster moderation scan. */
  flagged: boolean;
  /** Why it was flagged (empty when not flagged or when authored by the owner). */
  flagReasons: FlagReason[];
}

export interface CommentSummary {
  /** Threads scanned (NOT the whole channel — see `hasMore` on the scan). */
  total: number;
  needsReply: number;
  fromViewers: number;
  flagged: number;
  /** Threads whose reply list was truncated, so reply status is unknown. */
  replyUnknown: number;
  /** How many rows were actually returned to the client. */
  shown: number;
}

export interface CommentScan {
  /** Triage-sorted and sliced to the caller's `max`. */
  comments: CommentItem[];
  /** Counts over the ENTIRE scanned window, not just the returned slice. */
  summary: CommentSummary;
  /** Threads examined in this scan. */
  scanned: number;
  /** True when the channel has more threads than the scan window covers. */
  hasMore: boolean;
}

/** High-precision moderation signals. Deliberately conservative — these catch
 *  spam / self-promo / contact-info, NOT "off-topic", to avoid flagging
 *  heartfelt fan comments (which are exactly what the channel wants to keep). */
export type FlagReason = 'link' | 'contact' | 'promo';

/* ------------------------------------------------------------------ *
 * Text normalisation
 * ------------------------------------------------------------------ */

// Dot look-alikes spammers use to defeat naive URL matching ("t·me/x").
const DOT_LOOKALIKE_RE = /[·․‧∙⋅．。]/g;

/** Digit ranges that are not folded to ASCII by NFKC. */
const DIGIT_BLOCKS: [number, number][] = [
  [0x0be6, 0x0bef], // Tamil ௦-௯
  [0x0966, 0x096f], // Devanagari
  [0x0660, 0x0669], // Arabic-Indic
  [0x06f0, 0x06f9], // Extended Arabic-Indic
];

/**
 * Fold a comment to a comparable ASCII-ish form: NFKC (which maps fullwidth and
 * mathematical digits — the 𝟵𝟴𝟰 trick — to ASCII), then the remaining
 * non-ASCII digit blocks, then dot look-alikes.
 */
export function normalizeForFlagging(text: string): string {
  let t = String(text ?? '').normalize('NFKC');
  for (const [lo, hi] of DIGIT_BLOCKS) {
    t = t.replace(
      new RegExp(`[\\u${lo.toString(16).padStart(4, '0')}-\\u${hi.toString(16).padStart(4, '0')}]`, 'g'),
      (d) => String(d.charCodeAt(0) - lo)
    );
  }
  return t.replace(DOT_LOOKALIKE_RE, '.');
}

/* ------------------------------------------------------------------ *
 * Link detection
 * ------------------------------------------------------------------ */

/**
 * TLDs that are never an ordinary English word, so a bare `foo.TLD` is safe to
 * treat as a link even mid-sentence.
 */
const SAFE_TLDS = 'com|net|org|io|xyz|ly|biz|ru|cn|tk|top|site|online|vip|pro';
/**
 * TLDs that ARE ordinary words. "Nice song.in tamil", "Thanks.me too" and
 * "Amazing.tv quality" are fan comments, not spam, so these only count as a
 * link when they carry a scheme/`www.` or a path.
 */
const WORD_TLDS = 'in|me|co|app|link|click|shop|store|info|tv|live|news|life|best|work|one';

const SCHEME_RE = /(https?:\/\/|www\.)\S/i;
const BARE_DOMAIN_RE = new RegExp(String.raw`\b[a-z0-9][a-z0-9-]*\.(${SAFE_TLDS})\b`, 'i');
const PATH_DOMAIN_RE = new RegExp(String.raw`\b[a-z0-9][a-z0-9-]*\.(${WORD_TLDS})\/\S`, 'i');

function hasLink(t: string): boolean {
  return SCHEME_RE.test(t) || BARE_DOMAIN_RE.test(t) || PATH_DOMAIN_RE.test(t);
}

/* ------------------------------------------------------------------ *
 * Contact detection
 * ------------------------------------------------------------------ */

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
/** Any digit run that *could* be a number; `looksLikePhone` does the real work. */
const PHONE_CANDIDATE_RE = /\+?\d[\d\s().-]{4,}\d/g;

/**
 * Decide whether a digit run is a phone number rather than years, a countdown,
 * or a view-count milestone. Rejects, in order: too few/many digits; no group of
 * 3+ consecutive digits ("1 2 3 4 5 6 7 8"); all groups being 4-digit years
 * ("2025 2026"); and short mostly-zero runs ("1 000 000 views").
 */
export function looksLikePhone(run: string): boolean {
  const groups = run.match(/\d+/g) ?? [];
  const digits = groups.join('');
  if (digits.length < 7 || digits.length > 15) return false;
  if (!groups.some((g) => g.length >= 3)) return false;
  if (groups.every((g) => g.length === 4 && Number(g) >= 1900 && Number(g) <= 2099)) return false;
  const zeros = (digits.match(/0/g) ?? []).length;
  if (digits.length <= 8 && zeros / digits.length >= 0.6) return false;
  return true;
}

function hasContact(t: string): boolean {
  if (EMAIL_RE.test(t)) return true;
  return (t.match(PHONE_CANDIDATE_RE) ?? []).some(looksLikePhone);
}

/* ------------------------------------------------------------------ *
 * Self-promotion detection
 * ------------------------------------------------------------------ */

const PROMO_RE = new RegExp(
  [
    String.raw`\bsub(scribe)?\s+(to\s+)?my\b`,
    String.raw`\bcheck\s+(out\s+)?my\b`,
    String.raw`\bvisit\s+my\b`,
    String.raw`\bfollow\s+(me|my)\b`,
    String.raw`\bmy\s+(channel|page|video|profile|insta(gram)?|yt|account|link)\b`,
    String.raw`\b(dm|inbox|contact|message|msg)\s+me\b`,
    String.raw`\bsub(scribe)?\s*(back|4\s*sub|for\s*sub)\b`,
    String.raw`\b(plz|pls|please)\s+sub\b`,
  ].join('|'),
  'i'
);

/**
 * Tamil self-promo. Anchored on "என் + சேனல்/சானல்/வீடியோ" so it survives case
 * suffixes ("என் சேனலையும்") without matching the very common bare "என்".
 * Deliberately narrow: this channel's audience writes in Tamil, and a false
 * positive on a fan comment costs more than a missed spammer.
 */
const PROMO_TA_RE = /என்\s*(சேனல|சானல|வீடியோ)/;

/** Classify a comment's text for moderation. Pure, content-neutral. */
export function flagComment(text: string): { flagged: boolean; reasons: FlagReason[] } {
  const t = normalizeForFlagging(text);
  const reasons: FlagReason[] = [];
  if (hasLink(t)) reasons.push('link');
  if (hasContact(t)) reasons.push('contact');
  if (PROMO_RE.test(t) || PROMO_TA_RE.test(t)) reasons.push('promo');
  return { flagged: reasons.length > 0, reasons };
}

/* ------------------------------------------------------------------ *
 * Parsing
 * ------------------------------------------------------------------ */

/**
 * Channel IDs treated as "the owner". Extra IDs (e.g. a personal Google account
 * the owner sometimes replies from) can be added via YOUTUBE_OWNER_CHANNEL_IDS,
 * comma-separated — otherwise those replies read as "still unanswered".
 */
export function ownerChannelIds(primary: string): string[] {
  const extra = (process.env.YOUTUBE_OWNER_CHANNEL_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([primary, ...extra].filter(Boolean))];
}

/** Parse `commentThreads.list` items into triage rows. Pure. */
export function parseCommentThreads(items: any[], owner: string | string[]): CommentItem[] {
  const owners = (Array.isArray(owner) ? owner : [owner]).filter(Boolean);
  const isOwner = (id: string) => !!id && owners.includes(id);
  const out: CommentItem[] = [];
  for (const it of items ?? []) {
    const top = it?.snippet?.topLevelComment?.snippet;
    if (!top) continue;
    const authorChannelId = String(top.authorChannelId?.value ?? '');
    const isByOwner = isOwner(authorChannelId);
    const replies: any[] = it?.replies?.comments ?? [];
    const totalReplyCount = Number(it?.snippet?.totalReplyCount ?? 0);
    const ownerHasReplied = replies.some((r) => isOwner(String(r?.snippet?.authorChannelId?.value ?? '')));
    // The API caps the inline reply list; if we didn't see every reply, an owner
    // reply may be among the ones we can't see.
    const repliesTruncated = totalReplyCount > replies.length;
    const text = String(top.textOriginal ?? top.textDisplay ?? '');
    // Never flag the owner's own pinned/promo comment (it legitimately links out).
    const mod = isByOwner ? { flagged: false, reasons: [] as FlagReason[] } : flagComment(text);
    out.push({
      id: String(it.id ?? ''),
      videoId: String(it?.snippet?.videoId ?? ''),
      author: String(top.authorDisplayName ?? ''),
      authorChannelId,
      text,
      likeCount: Number(top.likeCount ?? 0),
      publishedAt: String(top.publishedAt ?? ''),
      totalReplyCount,
      isByOwner,
      ownerHasReplied,
      repliesTruncated: !isByOwner && !ownerHasReplied && repliesTruncated,
      needsReply: !isByOwner && !ownerHasReplied && !repliesTruncated,
      flagged: mod.flagged,
      flagReasons: mod.reasons,
    });
  }
  return out;
}

export function summarizeComments(items: CommentItem[], shown = items.length): CommentSummary {
  return {
    total: items.length,
    needsReply: items.filter((c) => c.needsReply).length,
    fromViewers: items.filter((c) => !c.isByOwner).length,
    flagged: items.filter((c) => c.flagged).length,
    replyUnknown: items.filter((c) => c.repliesTruncated).length,
    shown,
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
  return `https://www.youtube.com/watch?v=${encodeURIComponent(c.videoId)}&lc=${encodeURIComponent(c.id)}`;
}

/**
 * Scan recent channel-wide comment threads (API key), triage them, and return
 * the top `max` rows plus counts over the whole scanned window.
 *
 * THROWS on an upstream failure. Returning [] instead would render as
 * "No comments yet" — a blown quota or a revoked key must not be
 * indistinguishable from a quiet inbox.
 */
export async function fetchChannelComments(channelId: string, max = 50): Promise<CommentScan> {
  const key = process.env.YOUTUBE_API_KEY;
  const empty: CommentScan = {
    comments: [],
    summary: { total: 0, needsReply: 0, fromViewers: 0, flagged: 0, replyUnknown: 0, shown: 0 },
    scanned: 0,
    hasMore: false,
  };
  if (!key || !channelId) return empty;

  const raw: any[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const url = new URL(COMMENTS_ENDPOINT);
    url.searchParams.set('part', 'snippet,replies');
    url.searchParams.set('allThreadsRelatedToChannelId', channelId);
    url.searchParams.set('maxResults', String(PAGE_SIZE));
    url.searchParams.set('order', 'time');
    url.searchParams.set('key', key);
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    // Admin-only, ~4 quota units per load: always read through to YouTube so the
    // page's Refresh button actually refreshes.
    const res = await fetchWithRetry(url.toString(), { cache: 'no-store' } as RequestInit);
    if (!res.ok) {
      throw new Error(`commentThreads.list HTTP ${res.status} on page ${i + 1}`);
    }
    const json = (await res.json()) as { items?: unknown[]; nextPageToken?: string };
    raw.push(...(json.items ?? []));
    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }

  // Sort the FULL scanned window before slicing, so the needs-reply queue is
  // complete rather than "whatever happened to be in the newest `max` threads".
  const all = sortForTriage(parseCommentThreads(raw, ownerChannelIds(channelId)));
  const comments = all.slice(0, max);
  return {
    comments,
    summary: summarizeComments(all, comments.length),
    scanned: all.length,
    hasMore: Boolean(pageToken),
  };
}
