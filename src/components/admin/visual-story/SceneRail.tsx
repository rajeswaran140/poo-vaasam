'use client';

/** Left rail: the story's scenes with their shot counts, "Add scene", and "Delete scene" (after a confirm). */

import { useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import type { Scene, Shot } from '@/types/visualStory';

interface Props {
  vsId: string;
  scenes: Scene[];
  shots: Shot[];
  selectedOrder: number | null;
  onSelect: (order: number) => void;
  onChanged: () => void;
}

export function SceneRail({ vsId, scenes, shots, selectedOrder, onSelect, onChanged }: Props) {
  const [heading, setHeading] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOrder, setConfirmOrder] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const remove = async (order: number) => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await adminFetch(`/api/admin/visual-story/${vsId}/scenes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'delete', order }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setDeleteError(body?.error || 'Could not delete the scene.');
        return;
      }
      setConfirmOrder(null);
      onChanged();
    } catch {
      setDeleteError('Could not reach the server. Check your connection and try again.');
    } finally {
      setDeleting(false);
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!heading.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/visual-story/${vsId}/scenes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'create', heading: heading.trim(), summary: '' }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setError(body?.error || 'Could not add the scene.');
        return;
      }
      setHeading('');
      if (body.data?.scene?.order) onSelect(body.data.scene.order);
      onChanged();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <nav aria-label="Scenes" className="space-y-3">
      <h2 className="text-sm font-semibold uppercase text-gray-600 dark:text-gray-400">Scenes</h2>
      <ol className="space-y-1">
        {scenes.map((s) => {
          const count = shots.filter((sh) => sh.sceneOrder === s.order).length;
          const current = s.order === selectedOrder;
          return (
            <li key={s.order}>
              <button
                type="button"
                aria-current={current ? 'true' : undefined}
                onClick={() => onSelect(s.order)}
                className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${current ? 'bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200' : 'text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'}`}
              >
                <span className="block font-medium">{s.heading}</span>
                <span className="block text-xs text-gray-600 dark:text-gray-400">{count === 1 ? '1 shot' : `${count} shots`}</span>
              </button>
              {confirmOrder !== s.order ? (
                <button
                  type="button"
                  aria-label={`Delete scene ${s.heading}`}
                  onClick={() => {
                    setDeleteError(null);
                    setConfirmOrder(s.order);
                  }}
                  className="px-2 text-xs text-red-700 hover:underline dark:text-red-400"
                >
                  Delete scene
                </button>
              ) : (
                <div role="alertdialog" aria-label="Delete this scene?" className="mt-1 space-y-2 rounded-md border border-red-300 bg-red-50 p-2 dark:border-red-700 dark:bg-red-950">
                  <p className="text-xs text-red-900 dark:text-red-200">
                    {`Delete “${s.heading}”, its ${count === 1 ? '1 shot' : `${count} shots`} and their stills? This cannot be undone.`}
                  </p>
                  <div className="flex gap-2">
                    <button type="button" disabled={deleting} onClick={() => remove(s.order)} className="rounded-md bg-red-600 px-2 py-0.5 text-xs font-medium text-white disabled:opacity-50">
                      {deleting ? 'Deleting…' : 'Delete'}
                    </button>
                    <button type="button" onClick={() => setConfirmOrder(null)} className="rounded-md border border-gray-300 px-2 py-0.5 text-xs text-gray-700 dark:border-gray-600 dark:text-gray-300">
                      Cancel
                    </button>
                  </div>
                  {deleteError && (
                    <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                      {deleteError}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <form onSubmit={add} className="space-y-1">
        <label className="block text-sm text-gray-700 dark:text-gray-300">
          New scene heading
          <input
            type="text"
            value={heading}
            maxLength={120}
            onChange={(e) => setHeading(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-800"
          />
        </label>
        <button type="submit" disabled={!heading.trim() || busy} className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-800 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200">
          {busy ? 'Adding…' : 'Add scene'}
        </button>
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </form>
    </nav>
  );
}
