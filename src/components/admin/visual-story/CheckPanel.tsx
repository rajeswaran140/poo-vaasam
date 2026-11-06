'use client';

/**
 * Check panel: Claude reads the storyboard (and the lyrics, if pasted) and
 * lists what would waste a paid picture or clip. Advice only — nothing here
 * edits a shot; each issue's "Scene X, shot Y" opens that shot to fix by hand.
 *
 * A check runs on the background worker like a draft: POST → 202 { checkId },
 * pollJob() on the check route, then the newest check is reloaded. The newest
 * check is loaded again whenever the storyboard changes, so it can say it is
 * out of date. The lyrics are sent once and not kept. Errors render here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { pollJob } from '@/lib/poll-job';
import { buildCheckInput, buildCheckMessage } from '@/lib/visual-story-check';
import { checkReserveUsd } from '@/services/video/cost';
import type { Character, CheckIssueKind, Scene, Shot, StoryCheck, VisualStory } from '@/types/visualStory';
import { usd } from './ui-utils';

interface Props {
  vsId: string;
  story: VisualStory;
  scenes: Scene[];
  shots: Shot[];
  characters: Character[];
  /** Open a shot (shotOrder null: the scene) in the studio. */
  onOpen: (sceneOrder: number, shotOrder: number | null) => void;
  /** Reload the tree (spend) after a check settles. */
  onChanged: () => void;
}

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 8 * 60_000;
const POLL_TIMEOUT_MESSAGE = 'The check is taking longer than expected. Reload the page in a few minutes to see it.';

export const KIND_LABEL: Record<CheckIssueKind, string> = {
  character: 'Character',
  lyrics: 'Lyrics',
  repeat: 'Too alike',
  text: 'Words in the picture',
  style: 'Style',
  other: 'Other',
};

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
};

export function CheckPanel({ vsId, story, scenes, shots, characters, onOpen, onChanged }: Props) {
  const [lyrics, setLyrics] = useState('');
  const [check, setCheck] = useState<StoryCheck | null>(null);
  const [outOfDate, setOutOfDate] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const abort = useRef<AbortController | null>(null);
  const seq = useRef(0);
  // Checks whose status could not be read: not watched again until the owner starts a new one.
  const failedIds = useRef(new Set<string>());
  // Read through a ref, so a new callback from the parent never re-runs the effect below.
  const changed = useRef(onChanged);
  changed.current = onChanged;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);

  const loadLatest = useCallback(async (): Promise<StoryCheck | null> => {
    const mine = ++seq.current;
    try {
      const res = await adminFetch(`/api/admin/visual-story/${vsId}/check`);
      const body = await res.json().catch(() => null);
      if (!mounted.current || mine !== seq.current || !res.ok || !body?.success) return null;
      setCheck(body.data.check ?? null);
      setOutOfDate(!!body.data.outOfDate);
      return body.data.check ?? null;
    } catch {
      return null; // the panel keeps what it showed; the next change retries
    }
  }, [vsId]);

  const watch = useCallback(
    async (checkId: string) => {
      inFlight.current = true;
      setPending(true);
      setError(null);
      const ctrl = new AbortController();
      abort.current = ctrl;
      try {
        await pollJob<{ checkId: string }>({
          fetchStatus: (signal) => adminFetch(`/api/admin/visual-story/${vsId}/check/${checkId}`, { signal }),
          signal: ctrl.signal,
          isMounted: () => mounted.current,
          intervalMs: POLL_INTERVAL_MS,
          timeoutMs: POLL_TIMEOUT_MS,
          timeoutMessage: POLL_TIMEOUT_MESSAGE,
        });
      } catch (err) {
        failedIds.current.add(checkId);
        if (!mounted.current) return;
        const message = err instanceof Error ? err.message : '';
        setError(message && !/fetch|network/i.test(message) ? message : 'Could not reach the server. Check your connection and try again.');
      } finally {
        inFlight.current = false;
        if (mounted.current) {
          setPending(false);
          await loadLatest();
          changed.current(); // the settled spend comes from the server
        }
      }
    },
    [vsId, loadLatest]
  );

  // What would be checked. Its text is the effect's key: a page reload with
  // the same storyboard (new arrays, same content) does not reload the check.
  const input = useMemo(() => buildCheckInput({ story, scenes, shots, characters }), [story, scenes, shots, characters]);
  const inputKey = JSON.stringify(input);

  // Reload on every storyboard change, so an edit marks the check out of date;
  // a check still running when the page opened is watched to the end.
  useEffect(() => {
    void loadLatest().then((latest) => {
      if (!latest || (latest.status !== 'queued' && latest.status !== 'running')) return;
      if (!inFlight.current && !failedIds.current.has(latest.checkId)) void watch(latest.checkId);
    });
  }, [loadLatest, watch, inputKey]);

  const start = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/visual-story/${vsId}/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lyrics.trim() ? { lyrics } : {}),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success || !body?.data?.checkId) {
        setError(body?.error || `Could not start the check (HTTP ${res.status}).`);
        inFlight.current = false;
        setPending(false);
        return;
      }
      setLyrics(''); // sent once, not kept
      await watch(String(body.data.checkId));
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      inFlight.current = false;
      setPending(false);
    }
  };

  const priceUsd = checkReserveUsd(buildCheckMessage(input, lyrics).length);
  const shotExists = (sceneOrder: number, shotOrder: number | null) =>
    shotOrder === null ? scenes.some((s) => s.order === sceneOrder) : shots.some((s) => s.sceneOrder === sceneOrder && s.shotOrder === shotOrder);
  const done = check?.status === 'done' ? check : null;
  const issues = done?.issues ?? [];

  return (
    <section aria-label="Storyboard check" className="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Check storyboard</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Before you spend on pictures and clips, Claude reads every shot and lists problems. It changes nothing.
      </p>
      <label className="block text-sm text-gray-700 dark:text-gray-300">
        Lyrics (optional — paste them to also check that scenes fit the words)
        <textarea
          rows={3}
          maxLength={8000}
          value={lyrics}
          onChange={(e) => setLyrics(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
        />
      </label>
      <button
        type="button"
        disabled={pending || shots.length === 0}
        onClick={start}
        className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? 'Checking…' : `Check storyboard (up to ${usd(priceUsd)})`}
      </button>
      {pending && (
        <p role="status" className="text-sm text-gray-700 dark:text-gray-300">
          Checking… this takes about a minute.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {!pending && check?.status === 'failed' && !error && (
        <p className="text-sm text-red-600 dark:text-red-400">{`Last check failed: ${check.error || 'please try again.'}`}</p>
      )}

      {done && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {`Last check (${when(done.createdAt)}${done.withLyrics ? ', with lyrics' : ''}${done.costUsd !== undefined ? ` · ${usd(done.costUsd)}` : ''})`}
          </h3>
          {outOfDate && (
            <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              You have changed the storyboard since this check. Some notes may no longer apply — check again when you are ready.
            </p>
          )}
          {done.summary && <p className="text-sm text-gray-800 dark:text-gray-200">{done.summary}</p>}
          {issues.length === 0 ? (
            <p className="text-sm font-medium text-green-700 dark:text-green-400">No problems found.</p>
          ) : (
            <ol aria-label="Problems found" className="space-y-2">
              {issues.map((i, n) => (
                <li key={n} className="rounded-md border border-gray-200 p-2 text-sm dark:border-gray-700">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-800 dark:bg-gray-800 dark:text-gray-200">
                      {KIND_LABEL[i.kind] ?? 'Other'}
                    </span>
                    {shotExists(i.sceneOrder, i.shotOrder) ? (
                      <button
                        type="button"
                        onClick={() => onOpen(i.sceneOrder, i.shotOrder)}
                        className="min-h-11 text-blue-700 hover:underline lg:min-h-0 dark:text-blue-400"
                      >
                        {i.shotOrder === null ? `Scene ${i.sceneOrder}` : `Scene ${i.sceneOrder}, shot ${i.shotOrder}`}
                      </button>
                    ) : (
                      <span className="text-gray-600 dark:text-gray-400">
                        {i.shotOrder === null ? `Scene ${i.sceneOrder} (gone)` : `Scene ${i.sceneOrder}, shot ${i.shotOrder} (gone)`}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-gray-900 dark:text-gray-100">{i.problem}</p>
                  <p className="mt-1 text-gray-700 dark:text-gray-300">
                    <span className="font-medium">Try: </span>
                    {i.suggestion}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
