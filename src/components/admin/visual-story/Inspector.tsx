'use client';

/**
 * Right inspector: edit the selected shot's prompt, negative prompt, duration
 * and cast, or delete the shot (with its stills) after a confirm. The parent
 * remounts it per shot (`key`), so the form always starts from that shot's
 * saved values.
 */

import { useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { MAX_SHOT_SEC, MIN_SHOT_SEC } from '@/types/visualStory';
import type { Character, Shot } from '@/types/visualStory';

interface Props {
  vsId: string;
  shot: Shot | null;
  characters: Character[];
  onChanged: () => void;
}

export function Inspector({ vsId, shot, characters, onChanged }: Props) {
  const [prompt, setPrompt] = useState(shot?.visualPrompt ?? '');
  const [negative, setNegative] = useState(shot?.negativePrompt ?? '');
  const [duration, setDuration] = useState(String(shot?.durationSec ?? 5));
  const [charIds, setCharIds] = useState<string[]>(shot?.charIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (!shot) {
    return <p className="text-sm text-gray-600 dark:text-gray-400">Choose “Edit” on a shot to change its prompt, length and cast.</p>;
  }

  const durNum = Number(duration);
  const durOk = Number.isInteger(durNum) && durNum >= MIN_SHOT_SEC && durNum <= MAX_SHOT_SEC;
  const canSave = prompt.trim() !== '' && durOk && !busy;

  const toggle = (id: string) => setCharIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await adminFetch(`/api/admin/visual-story/${vsId}/shots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          op: 'update',
          sceneOrder: shot.sceneOrder,
          shotOrder: shot.shotOrder,
          visualPrompt: prompt.trim(),
          negativePrompt: negative.trim(),
          durationSec: durNum,
          charIds,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setError(body?.error || 'Could not save the shot.');
        return;
      }
      setSaved(true);
      onChanged();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await adminFetch(`/api/admin/visual-story/${vsId}/shots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'delete', sceneOrder: shot.sceneOrder, shotOrder: shot.shotOrder }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setDeleteError(body?.error || 'Could not delete the shot.');
        return;
      }
      setConfirmingDelete(false);
      onChanged();
    } catch {
      setDeleteError('Could not reach the server. Check your connection and try again.');
    } finally {
      setDeleting(false);
    }
  };

  const field = 'mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800';

  return (
    <form onSubmit={save} aria-label={`Edit shot ${shot.sceneOrder}.${shot.shotOrder}`} className="space-y-3">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{`Shot ${shot.sceneOrder}.${shot.shotOrder}`}</h2>
      <label className="block text-sm text-gray-700 dark:text-gray-300">
        Visual prompt
        <textarea rows={5} maxLength={2000} value={prompt} onChange={(e) => setPrompt(e.target.value)} className={field} />
      </label>
      <label className="block text-sm text-gray-700 dark:text-gray-300">
        Negative prompt
        <textarea rows={2} maxLength={1000} value={negative} onChange={(e) => setNegative(e.target.value)} className={field} />
      </label>
      <label className="block text-sm text-gray-700 dark:text-gray-300">
        {`Duration (${MIN_SHOT_SEC}–${MAX_SHOT_SEC} s)`}
        <input type="number" min={MIN_SHOT_SEC} max={MAX_SHOT_SEC} step={1} value={duration} onChange={(e) => setDuration(e.target.value)} className={field} />
      </label>
      {!durOk && <p className="text-sm text-red-600 dark:text-red-400">{`A shot lasts ${MIN_SHOT_SEC}–${MAX_SHOT_SEC} whole seconds.`}</p>}
      <fieldset className="space-y-1">
        <legend className="text-sm text-gray-700 dark:text-gray-300">Characters</legend>
        {characters.length === 0 && <p className="text-xs text-gray-600 dark:text-gray-400">No characters yet.</p>}
        {characters.map((c) => (
          <label key={c.charId} className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
            <input type="checkbox" checked={charIds.includes(c.charId)} onChange={() => toggle(c.charId)} />
            {c.name}
          </label>
        ))}
      </fieldset>
      <div className="space-y-1">
        <button type="submit" disabled={!canSave} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {busy ? 'Saving…' : 'Save shot'}
        </button>
        {saved && <p className="text-sm text-green-700 dark:text-green-400">Saved.</p>}
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
      <div className="space-y-1 border-t border-gray-200 pt-3 dark:border-gray-700">
        {!confirmingDelete ? (
          <button type="button" onClick={() => setConfirmingDelete(true)} className="rounded-md border border-red-300 px-3 py-1 text-sm text-red-700 dark:border-red-700 dark:text-red-400">
            Delete shot
          </button>
        ) : (
          <div role="alertdialog" aria-label="Delete this shot?" className="space-y-2 rounded-md border border-red-300 bg-red-50 p-3 dark:border-red-700 dark:bg-red-950">
            <p className="text-sm text-red-900 dark:text-red-200">{`Delete shot ${shot.sceneOrder}.${shot.shotOrder}? Its stills are deleted too. This cannot be undone.`}</p>
            <div className="flex gap-2">
              <button type="button" disabled={deleting} onClick={remove} className="rounded-md bg-red-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50">
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
              <button type="button" onClick={() => setConfirmingDelete(false)} className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-300">
                Cancel
              </button>
            </div>
          </div>
        )}
        {deleteError && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {deleteError}
          </p>
        )}
      </div>
    </form>
  );
}
