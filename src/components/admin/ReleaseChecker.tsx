'use client';

/**
 * /admin/release — check one upload against the release checklist.
 *
 * The rules live in lib/release-checklist (pure + tested); the grading happens
 * server-side in /api/admin/youtube/release-check. This is the screen that made
 * the checker usable at all: it existed as an API for a day with no click-path,
 * which meant Raj could not exercise the thing it was built for.
 *
 * Accepts a bare id OR any YouTube URL — /watch?v=, youtu.be/, /shorts/ — because
 * what actually gets pasted is whatever the browser was showing.
 */

import { useCallback, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import type { Finding } from '@/lib/release-checklist';
import { FindingRow, groupFindings } from '@/components/admin/ReleaseFindings';

interface Result {
  videoId: string;
  title: string;
  isShort: boolean;
  durationSeconds: number;
  isUpcoming?: boolean;
  captionsChecked: boolean;
  blockers: number;
  gaps: number;
  notes: number;
  notChecked: number;
  ready: boolean;
  findings: Finding[];
  quota?: { used: number; limit: number; spent: number };
}

/**
 * Pull an 11-character video id out of anything YouTube shows in the address
 * bar. Exported so the parsing is testable without rendering.
 */
export function extractVideoId(input: string): string | null {
  const s = (input ?? '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const patterns = [
    /[?&]v=([\w-]{11})/,
    /youtu\.be\/([\w-]{11})/,
    /\/shorts\/([\w-]{11})/,
    /\/embed\/([\w-]{11})/,
    /\/live\/([\w-]{11})/,
  ];
  for (const re of patterns) {
    const m = re.exec(s);
    if (m) return m[1];
  }
  return null;
}

export function ReleaseChecker() {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    const id = extractVideoId(input);
    if (!id) {
      setError('That does not look like a YouTube video id or URL.');
      setResult(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/youtube/release-check?videoId=${id}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message ?? 'Check failed');
        setResult(null);
      } else {
        setResult(json as Result);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check failed');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [input]);

  // Kept apart from both actionable findings and notes: a not-checked finding
  // is neither a problem to fix nor an opinion the rule reached — it is the
  // rule saying it never ran, and must never read as either of those. The split
  // is shared with the Mastering Studio's upload panel so the two screens
  // cannot disagree about what a severity means.
  const { actionable, notes, notChecked } = groupFindings(result?.findings);

  return (
    <div className="mx-auto max-w-3xl p-4">
      <h1 className="text-xl font-semibold text-gray-900">Release check</h1>
      <p className="mt-1 text-sm text-gray-600">
        Paste a video id or any YouTube URL. Grades the upload against the per-release checklist —
        audio language, captions, title, description links, tags, playlists.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') run();
          }}
          placeholder="https://youtube.com/shorts/… or an 11-character id"
          aria-label="YouTube video id or URL"
          className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={run}
          disabled={loading || !input.trim()}
          className="rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? 'Checking…' : 'Check'}
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      )}

      {result && (
        <section className="mt-5" aria-live="polite">
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-sm text-gray-500">
              {result.isShort ? 'Short' : 'Song'}
              {result.isUpcoming && ' · unaired premiere'}
              {result.durationSeconds > 0 &&
                ` · ${Math.floor(result.durationSeconds / 60)}:${String(result.durationSeconds % 60).padStart(2, '0')}`}
            </p>
            <p className="mt-0.5 font-medium text-gray-900">{result.title}</p>
            <p className="mt-2 text-lg font-semibold">
              {result.ready ? (
                <span className="text-emerald-700">✅ Ready</span>
              ) : (
                <span className="text-amber-800">
                  ⚠️ {result.blockers} blocker{result.blockers === 1 ? '' : 's'}, {result.gaps} gap
                  {result.gaps === 1 ? '' : 's'}
                </span>
              )}
            </p>
            {!result.captionsChecked && (
              <p className="mt-1 text-xs text-gray-500">
                Caption tracks could not be read (the write token is missing the force-ssl scope) —
                caption findings are absent, not clear.
              </p>
            )}
          </div>

          {actionable.length > 0 && (
            <ul className="mt-3 space-y-2">
              {actionable.map((f) => (
                <FindingRow key={f.id} f={f} />
              ))}
            </ul>
          )}

          {notes.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-gray-600">
                {notes.length} note{notes.length === 1 ? '' : 's'} — nothing to fix, but worth knowing
              </summary>
              <ul className="mt-2 space-y-2">
                {notes.map((f) => (
                  <FindingRow key={f.id} f={f} />
                ))}
              </ul>
            </details>
          )}

          {notChecked.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm italic text-slate-400">
                {notChecked.length} check{notChecked.length === 1 ? '' : 's'} not run — inputs were missing, not clear
              </summary>
              <ul className="mt-2 space-y-2">
                {notChecked.map((f) => (
                  <FindingRow key={f.id} f={f} />
                ))}
              </ul>
            </details>
          )}

          {result.quota && (
            <p className="mt-3 text-xs text-gray-500">
              Quota: {result.quota.spent} units for this check · {result.quota.used}/
              {result.quota.limit} used today (resets midnight Pacific)
            </p>
          )}
        </section>
      )}
    </div>
  );
}
