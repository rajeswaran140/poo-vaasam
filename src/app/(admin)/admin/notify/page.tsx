'use client';

/**
 * /admin/notify — compose & send a new-song push notification to opted-in
 * subscribers. Manual, human-in-the-loop (never auto-fires). Shows the current
 * subscriber count and the send tally (delivered / pruned / failed).
 */

import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';

interface Tally { total: number; sent: number; pruned: number; failed: number }

export default function NotifyPage() {
  const [subscribers, setSubscribers] = useState<number | null>(null);
  const [configErr, setConfigErr] = useState<string | null>(null);
  const [title, setTitle] = useState('புதிய பாடல்! 🎵');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('/songs');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<Tally | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadCount = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/push/broadcast');
      const json = await res.json();
      if (res.status === 503) { setConfigErr(json.error || 'Web push not configured'); return; }
      if (json.success) setSubscribers(json.subscribers);
    } catch {
      /* count is best-effort */
    }
  }, []);

  useEffect(() => { loadCount(); }, [loadCount]);

  async function send() {
    if (!body.trim()) { setError('Message body is required.'); return; }
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const res = await adminFetch('/api/admin/push/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), body: body.trim(), url: url.trim() || '/songs' }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
      setResult({ total: json.total, sent: json.sent, pruned: json.pruned, failed: json.failed });
      loadCount();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }

  const field = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

  return (
    <div className="max-w-xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Notify subscribers</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Send a push notification to everyone who opted in for new-song alerts. Manual — nothing is sent automatically.
        </p>
      </header>

      {configErr ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {configErr}
        </p>
      ) : (
        <p className="text-sm text-gray-600 dark:text-gray-300">
          <span className="font-semibold text-gray-900 dark:text-gray-100">{subscribers ?? '—'}</span> subscriber{subscribers === 1 ? '' : 's'} opted in.
        </p>
      )}

      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Title</span>
          <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Message</span>
          <textarea className={field} rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={300} placeholder="புதிய பாடல் இப்போது நேரலையில் — கேளுங்கள்!" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Opens (path or URL)</span>
          <input className={field} value={url} onChange={(e) => setUrl(e.target.value)} maxLength={300} placeholder="/songs" />
        </label>
      </div>

      <button
        type="button"
        onClick={send}
        disabled={sending || !!configErr}
        className="rounded-lg bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
      >
        {sending ? 'Sending…' : `Send${subscribers ? ` to ${subscribers}` : ''}`}
      </button>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{error}</p>
      )}
      {result && (
        <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
          Delivered <strong>{result.sent}</strong> / {result.total} · pruned {result.pruned} dead · {result.failed} failed.
        </p>
      )}
    </div>
  );
}
