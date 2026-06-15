'use client';

/**
 * /admin/comments — viewer-comment triage.
 *
 * Replying to every comment is a known small-channel growth lever; this surfaces
 * WHICH comments are still waiting on the owner (channel-wide, newest first,
 * unanswered prioritised) and deep-links each to its watch page to reply
 * (replies need Studio/write). Reads GET /api/admin/youtube/comments.
 */

import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { commentDeepLink, type CommentItem, type CommentSummary } from '@/lib/youtube-comments';

interface Payload {
  success: boolean;
  comments: CommentItem[];
  summary: CommentSummary;
  error?: string;
}

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

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await adminFetch('/api/admin/youtube/comments?max=100');
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

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Comments</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Viewer comments across the channel — unanswered first. Replying is a real growth lever for a small channel.
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

      {payload?.summary && (
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
            {payload.summary.needsReply} need a reply
          </span>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            {payload.summary.fromViewers} from viewers
          </span>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            {payload.summary.total} loaded
          </span>
        </div>
      )}

      {err && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {err}
        </p>
      )}
      {loading && !payload && <p className="text-gray-500">Loading…</p>}

      {payload && payload.comments.length === 0 && !loading && (
        <p className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          No comments yet.
        </p>
      )}

      <ul className="space-y-2">
        {payload?.comments.map((c) => (
          <li
            key={c.id}
            className={`rounded-xl border bg-white p-4 shadow-sm dark:bg-gray-900 ${
              c.needsReply ? 'border-amber-300 dark:border-amber-700/60' : 'border-gray-200 dark:border-gray-800'
            }`}
          >
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span className="font-semibold text-gray-700 dark:text-gray-200">{c.author}</span>
              {c.isByOwner && <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold text-gray-700 dark:bg-gray-700 dark:text-gray-200">you</span>}
              {c.needsReply && <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-500/30 dark:text-amber-200">needs reply</span>}
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
              className="mt-2 inline-flex text-xs font-medium text-orange-600 hover:text-orange-700 dark:text-orange-400"
            >
              {c.needsReply ? 'Reply on YouTube ↗' : 'View on YouTube ↗'}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
