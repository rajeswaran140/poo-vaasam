'use client';

/**
 * The studio's title row: the story's title with Rename (PATCH title) and
 * Delete story (DELETE, after a confirm). The server refuses a delete while a
 * clip renders or a draft runs; that message renders inside the confirm.
 * Deleting removes the story's records; files already in the bucket stay.
 */

import { useState } from 'react';
import { adminFetch } from '@/lib/client-auth';

const BUTTON = 'min-h-11 rounded-md border px-3 py-1 text-sm lg:min-h-0';

interface Props {
  vsId: string;
  title: string;
  shotCount: number;
  onChanged: () => void;
  onDeleted: () => void;
}

export function StoryActions({ vsId, title, shotCount, onChanged, onDeleted }: Props) {
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [saving, setSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const startRename = () => {
    setDraftTitle(title);
    setRenameError(null);
    setConfirmingDelete(false);
    setRenaming(true);
  };

  const saveTitle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setRenameError(null);
    try {
      const res = await adminFetch(`/api/admin/visual-story/${vsId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: draftTitle.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setRenameError(body?.error || 'Could not rename the story.');
        return;
      }
      setRenaming(false);
      onChanged();
    } catch {
      setRenameError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await adminFetch(`/api/admin/visual-story/${vsId}`, { method: 'DELETE' });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setDeleteError(body?.error || 'Could not delete the story.');
        return;
      }
      onDeleted();
    } catch {
      setDeleteError('Could not reach the server. Check your connection and try again.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-2xl font-bold text-gray-900 dark:text-gray-100">{title}</h1>
        {!renaming && !confirmingDelete && (
          <>
            <button type="button" onClick={startRename} className={`${BUTTON} border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-300`}>
              Rename
            </button>
            <button
              type="button"
              onClick={() => {
                setDeleteError(null);
                setConfirmingDelete(true);
              }}
              className={`${BUTTON} border-red-300 text-red-700 dark:border-red-700 dark:text-red-400`}
            >
              Delete story
            </button>
          </>
        )}
      </div>
      {renaming && (
          <form onSubmit={saveTitle} aria-label="Rename story" className="flex flex-wrap items-end gap-2">
            <label className="text-sm text-gray-700 dark:text-gray-300">
              Story title
              <input
                type="text"
                value={draftTitle}
                maxLength={120}
                onChange={(e) => setDraftTitle(e.target.value)}
                className="mt-1 block w-72 max-w-full rounded-md border border-gray-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-800"
              />
            </label>
            <button type="submit" disabled={saving} className={`${BUTTON} border-blue-600 bg-blue-600 font-medium text-white disabled:opacity-50`}>
              {saving ? 'Saving…' : 'Save title'}
            </button>
            <button type="button" onClick={() => setRenaming(false)} className={`${BUTTON} border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-300`}>
              Cancel
            </button>
            {renameError && (
              <p role="alert" className="basis-full text-sm text-red-600 dark:text-red-400">
                {renameError}
              </p>
            )}
          </form>
      )}
      {confirmingDelete && (
        <div role="alertdialog" aria-label="Delete this story?" className="space-y-2 rounded-md border border-red-300 bg-red-50 p-3 dark:border-red-700 dark:bg-red-950">
          <p className="text-sm text-red-900 dark:text-red-200">
            {`Delete "${title}" with its ${shotCount} ${shotCount === 1 ? 'shot' : 'shots'}, pictures and clips? This cannot be undone. Money already spent is not refunded.`}
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={deleting} onClick={remove} className={`${BUTTON} border-red-600 bg-red-600 font-medium text-white disabled:opacity-50`}>
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
            <button type="button" onClick={() => setConfirmingDelete(false)} className={`${BUTTON} border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-300`}>
              Cancel
            </button>
          </div>
          {deleteError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {deleteError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
