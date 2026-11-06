'use client';

/**
 * "New from master" — pick a saved master, choose the window of the song the
 * story covers, aspect ratio and budget, then create. Errors from create render
 * directly beneath the submit button.
 */

import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { DEFAULT_BUDGET_USD_CAP, MIN_WINDOW_SEC, MAX_WINDOW_SEC, type AspectRatio } from '@/types/visualStory';
import { MAX_STYLE_CHARS } from '@/lib/visual-story-style';
import { WindowPicker, formatMss, type WindowValue } from './WindowPicker';

interface MasterRow {
  id: string;
  title: string | null;
  editedDurationSec: number | null;
}

const ASPECTS: AspectRatio[] = ['16:9', '9:16'];

export function NewStoryForm({ onCreated }: { onCreated: (vsId: string) => void }) {
  const [masters, setMasters] = useState<MasterRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [masterId, setMasterId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [win, setWin] = useState<WindowValue>({ startSec: 0, lengthSec: 60, valid: true });
  const [aspect, setAspect] = useState<AspectRatio>('16:9');
  const [budget, setBudget] = useState(String(DEFAULT_BUDGET_USD_CAP));
  const [style, setStyle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async (cursor: string | null) => {
    setLoading(true);
    setListError(null);
    try {
      const qs = new URLSearchParams({ limit: '50' });
      if (cursor) qs.set('cursor', cursor);
      const res = await adminFetch(`/api/admin/music-lab/masters?${qs}`);
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) throw new Error(body?.error || 'Could not load your saved masters.');
      setMasters((prev) => (cursor ? [...prev, ...body.masters] : body.masters));
      setNextCursor(body.nextCursor ?? null);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Could not load your saved masters.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  const master = masters.find((m) => m.id === masterId) ?? null;
  const songSec = master?.editedDurationSec != null ? Math.floor(master.editedDurationSec) : 0;
  const budgetNum = Number(budget);
  const budgetOk = budget.trim() !== '' && Number.isFinite(budgetNum) && budgetNum >= 0 && budgetNum <= 500;
  const lengthOk = win.valid && win.lengthSec >= MIN_WINDOW_SEC && win.lengthSec <= MAX_WINDOW_SEC;
  const canSubmit = !!master && songSec >= MIN_WINDOW_SEC && lengthOk && budgetOk && title.trim() !== '' && !submitting;

  const pick = (m: MasterRow) => {
    setMasterId(m.id);
    setTitle(m.title ?? '');
    const song = Math.floor(m.editedDurationSec ?? 0);
    setWin({ startSec: 0, lengthSec: Math.min(60, song), valid: true });
    setCreateError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!master || !canSubmit) return;
    setSubmitting(true);
    setCreateError(null);
    try {
      const res = await adminFetch('/api/admin/visual-story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          masterJobId: master.id,
          title: title.trim(),
          aspectRatio: aspect,
          windowStartSec: Math.floor(win.startSec),
          windowEndSec: Math.floor(win.startSec + win.lengthSec),
          budgetUsdCap: budgetNum,
          ...(style.trim() ? { style: style.trim() } : {}),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setCreateError(body?.error || 'Could not create the story.');
        return;
      }
      onCreated(body.data.vsId);
    } catch {
      setCreateError('Could not create the story. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">New from master</h2>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-gray-700 dark:text-gray-300">Saved master</legend>
        {loading && masters.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400">Loading masters…</p>}
        {!loading && !listError && masters.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400">No saved masters yet. Save one from Sound Engineering first.</p>
        )}
        <ul className="space-y-1">
          {masters.map((m) => {
            const noLength = m.editedDurationSec == null;
            const name = m.title || 'Untitled master';
            return (
              <li key={m.id}>
                <label className={`flex items-center gap-2 text-sm ${noLength ? 'text-gray-500 dark:text-gray-400' : 'text-gray-800 dark:text-gray-200'}`}>
                  <input
                    type="radio"
                    name="master"
                    checked={masterId === m.id}
                    disabled={noLength}
                    onChange={() => pick(m)}
                  />
                  <span>{name}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {noLength ? 'no recorded length' : formatMss(m.editedDurationSec as number)}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        {nextCursor && (
          <button type="button" onClick={() => load(nextCursor)} disabled={loading} className="text-sm text-blue-700 hover:underline disabled:opacity-50 dark:text-blue-400">
            Load more
          </button>
        )}
        {listError && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {listError}
          </p>
        )}
      </fieldset>

      {master && (
        <>
          <label className="block text-sm text-gray-700 dark:text-gray-300">
            Title
            <input
              type="text"
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 block w-full max-w-md rounded-md border border-gray-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-800"
            />
          </label>

          {songSec >= MIN_WINDOW_SEC ? (
            <WindowPicker key={master.id} songSec={songSec} startSec={win.startSec} lengthSec={win.lengthSec} onChange={setWin} />
          ) : (
            <p className="text-sm text-red-600 dark:text-red-400">This song is shorter than the {MIN_WINDOW_SEC} s minimum window.</p>
          )}

          <fieldset className="flex items-center gap-4 text-sm text-gray-700 dark:text-gray-300">
            <legend className="mb-1 font-medium">Aspect ratio</legend>
            {ASPECTS.map((a) => (
              <label key={a} className="flex items-center gap-1">
                <input type="radio" name="aspect" checked={aspect === a} onChange={() => setAspect(a)} />
                {a}
              </label>
            ))}
            <span className="text-gray-600 dark:text-gray-400">This can&apos;t be changed later.</span>
          </fieldset>

          <label className="block text-sm text-gray-700 dark:text-gray-300">
            Budget cap (USD)
            <input
              type="number"
              min={0}
              max={500}
              step="0.01"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              className="mt-1 block w-28 rounded-md border border-gray-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-800"
            />
          </label>
          {!budgetOk && <p role="alert" className="text-sm text-red-600 dark:text-red-400">Enter a budget between $0 and $500.</p>}

          <label className="block text-sm text-gray-700 dark:text-gray-300">
            Style (optional)
            <input
              type="text"
              value={style}
              maxLength={MAX_STYLE_CHARS}
              onChange={(e) => setStyle(e.target.value)}
              placeholder="e.g. warm cinematic film, golden-hour light, 35mm"
              className="mt-1 block w-full max-w-xl rounded-md border border-gray-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-800"
            />
            <span className="mt-1 block text-gray-600 dark:text-gray-400">
              Added to every picture and clip, and given to the storyboard draft, so the look stays the same. You can change it later.
            </span>
          </label>
        </>
      )}

      <div className="space-y-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Create story'}
        </button>
        {createError && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {createError}
          </p>
        )}
      </div>
    </form>
  );
}
