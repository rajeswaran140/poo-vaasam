'use client';

/**
 * /admin/comments — viewer-comment triage.
 *
 * Replying to every comment is a known small-channel growth lever; this surfaces
 * WHICH comments are still waiting on the owner (channel-wide, unanswered
 * prioritised) and deep-links each to its watch page to reply (replies need
 * Studio/write). Reads GET /api/admin/youtube/comments.
 *
 * Tab counts come from the API's summary, which covers the whole SCANNED window
 * — not just the rows rendered — so "Needs reply · N" is never an undercount of
 * what the scan saw.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { commentDeepLink, type CommentItem, type CommentSummary } from '@/lib/youtube-comments';

interface Payload {
  success: boolean;
  comments: CommentItem[];
  summary: CommentSummary;
  scanned: number;
  hasMore: boolean;
  error?: string;
}

type Filter = 'all' | 'needsReply' | 'flagged';

const REASON_LABEL: Record<string, string> = {
  link: 'link',
  contact: 'contact info',
  promo: 'self-promo',
};

function relTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  return d < 30 ? `${d}d ago` : new Date(t).toLocaleDateString();
}

export default function CommentsPage() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  // The owner's own pinned comments are never actionable in a triage queue, so
  // they start hidden — they were taking ~30% of the rows.
  const [hideMine, setHideMine] = useState(true);
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = useId();
  const panelId = `${baseId}-panel`;

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await adminFetch('/api/admin/youtube/comments?max=200');
      const json = (await res.json()) as Payload;
      if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
      setPayload(json);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load comments');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const all = payload?.comments ?? [];
  const mineCount = all.filter((c) => c.isByOwner).length;
  const scoped = hideMine ? all.filter((c) => !c.isByOwner) : all;
  const visible =
    filter === 'needsReply' ? scoped.filter((c) => c.needsReply)
    : filter === 'flagged' ? scoped.filter((c) => c.flagged)
    : scoped;

  const TABS: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: payload?.summary.total ?? 0 },
    { key: 'needsReply', label: 'Needs reply', count: payload?.summary.needsReply ?? 0 },
    { key: 'flagged', label: 'Flagged', count: payload?.summary.flagged ?? 0 },
  ];

  // Roving-focus keyboard support, which `role="tab"` promises to screen readers.
  const onTabKeyDown = (e: React.KeyboardEvent, i: number) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (i + delta + TABS.length) % TABS.length;
    setFilter(TABS[next].key);
    tabsRef.current[next]?.focus();
  };

  const summary = payload?.summary;
  const truncated = !!summary && summary.shown < summary.total;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Comments</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Viewer comments across the channel — unanswered first. The <span className="font-semibold text-red-600 dark:text-red-400">Flagged</span> tab surfaces likely spam / self-promo / contact-info for a quick daily scan; open any one to hide it on YouTube.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {summary && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-2 text-sm" role="tablist" aria-label="Filter comments">
            {TABS.map((t, i) => {
              const active = filter === t.key;
              const isFlag = t.key === 'flagged' && t.count > 0;
              return (
                <button
                  key={t.key}
                  ref={(el) => { tabsRef.current[i] = el; }}
                  type="button"
                  role="tab"
                  id={`${baseId}-tab-${t.key}`}
                  aria-selected={active}
                  aria-controls={panelId}
                  tabIndex={active ? 0 : -1}
                  onKeyDown={(e) => onTabKeyDown(e, i)}
                  onClick={() => setFilter(t.key)}
                  className={`rounded-full px-3 py-1 font-semibold transition ${
                    active
                      ? 'bg-orange-600 text-white'
                      : isFlag
                      ? 'bg-red-100 text-red-800 hover:bg-red-200 dark:bg-red-500/20 dark:text-red-300'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300'
                  }`}
                >
                  {t.label} · {t.count}
                </button>
              );
            })}
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
            <input
              type="checkbox"
              checked={hideMine}
              onChange={(e) => setHideMine(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-gray-300 text-orange-600 dark:border-gray-600"
            />
            Hide my own comments{mineCount > 0 && ` (${mineCount})`}
          </label>
        </div>
      )}

      {summary && (summary.replyUnknown > 0 || truncated || payload?.hasMore) && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Scanned {payload?.scanned ?? 0} threads
          {payload?.hasMore && ' (the channel has more beyond this window)'}
          {truncated && ` · showing the top ${summary.shown}`}
          {summary.replyUnknown > 0 && ` · ${summary.replyUnknown} thread${summary.replyUnknown === 1 ? '' : 's'} had more replies than YouTube returned, so reply status is unknown and they are kept out of the queue`}
          .
        </p>
      )}

      {err && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {err}
        </p>
      )}
      {loading && !payload && <p className="text-gray-500">Loading…</p>}

      <div id={panelId} role="tabpanel" aria-labelledby={`${baseId}-tab-${filter}`} tabIndex={0}>
        {payload && visible.length === 0 && !loading && (
          <p className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            {filter === 'flagged'
              ? 'No flagged comments — nothing looks like spam or self-promo right now. 🎉'
              : filter === 'needsReply'
              ? 'No comments waiting on a reply.'
              : hideMine && mineCount > 0
              ? 'No viewer comments — untick “Hide my own comments” to see your pinned ones.'
              : 'No comments yet.'}
          </p>
        )}

        <ul className="space-y-2">
          {visible.map((c) => (
            <li
              key={c.id}
              className={`rounded-xl border bg-white p-4 shadow-sm dark:bg-gray-900 ${
                c.flagged
                  ? 'border-red-300 dark:border-red-700/60'
                  : c.needsReply
                  ? 'border-amber-300 dark:border-amber-700/60'
                  : 'border-gray-200 dark:border-gray-800'
              }`}
            >
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <span className="font-semibold text-gray-700 dark:text-gray-200">{c.author}</span>
                {c.isByOwner && <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold text-gray-700 dark:bg-gray-700 dark:text-gray-200">you</span>}
                {c.flagged && (
                  <span className="rounded bg-red-200 px-1.5 py-0.5 text-[10px] font-semibold text-red-900 dark:bg-red-500/30 dark:text-red-200">
                    ⚑ {c.flagReasons.map((r) => REASON_LABEL[r] ?? r).join(' · ')}
                  </span>
                )}
                {c.needsReply && <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-500/30 dark:text-amber-200">needs reply</span>}
                {c.repliesTruncated && (
                  <span
                    title="YouTube returned fewer replies than this thread has, so we can't tell whether you already answered."
                    className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                  >
                    reply status unknown
                  </span>
                )}
                {c.ownerHasReplied && <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-800 dark:bg-green-500/20 dark:text-green-300">replied</span>}
                <span>· {relTime(c.publishedAt)}</span>
                {c.likeCount > 0 && <span>· ♥ {c.likeCount}</span>}
                {c.totalReplyCount > 0 && <span>· {c.totalReplyCount} repl{c.totalReplyCount === 1 ? 'y' : 'ies'}</span>}
              </div>
              <p className="whitespace-pre-wrap break-words font-tamil text-sm text-gray-900 dark:text-gray-100">{c.text}</p>
              <a
                href={commentDeepLink(c)}
                target="_blank"
                rel="noopener noreferrer"
                className={`mt-2 inline-flex text-xs font-medium ${
                  c.flagged
                    ? 'text-red-600 hover:text-red-700 dark:text-red-400'
                    : 'text-orange-600 hover:text-orange-700 dark:text-orange-400'
                }`}
              >
                {c.flagged ? 'Review & hide on YouTube ↗' : c.needsReply ? 'Reply on YouTube ↗' : 'View on YouTube ↗'}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
