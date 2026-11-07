'use client';

/**
 * /admin/video-text: the project list, then one project's editor.
 *
 * The open project lives in `?p=<id>` so a reload reopens it. Read from and
 * written to `window.location` directly (not useSearchParams, which needs a
 * Suspense boundary that only a production build would catch missing).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Type } from 'lucide-react';
import { adminFetch } from '@/lib/client-auth';
import type { RenderStatus, VideoTextProject } from '@/types/videoText';
import { VideoTextEditor } from './VideoTextEditor';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "7 Nov 2026 · 14:05" in the viewer's time. */
function edited(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} · ${hh}:${mm}`;
}

const STATUS_TEXT: Partial<Record<RenderStatus, { text: string; tone: string }>> = {
  queued: { text: 'Rendering…', tone: 'text-orange-700 dark:text-orange-300' },
  segmenting: { text: 'Rendering…', tone: 'text-orange-700 dark:text-orange-300' },
  encoding: { text: 'Rendering…', tone: 'text-orange-700 dark:text-orange-300' },
  joining: { text: 'Rendering…', tone: 'text-orange-700 dark:text-orange-300' },
  done: { text: 'Video ready', tone: 'text-emerald-700 dark:text-emerald-300' },
  error: { text: 'Render failed', tone: 'text-red-600 dark:text-red-400' },
};

const projectFromUrl = () => {
  if (typeof window === 'undefined') return null;
  const p = new URLSearchParams(window.location.search).get('p');
  return p && /^[A-Za-z0-9_-]{1,64}$/.test(p) ? p : null;
};

function setUrlProject(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('p', id);
  else url.searchParams.delete('p');
  window.history.pushState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

export function VideoTextApp() {
  const [projects, setProjects] = useState<VideoTextProject[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [open, setOpen] = useState<VideoTextProject | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const wanted = useRef<string | null>(null);
  const openRef = useRef<VideoTextProject | null>(null);
  openRef.current = open;
  // The open editor's "may I leave?" check (unsaved edits ask first).
  const leaveGuard = useRef<(() => boolean) | null>(null);

  const loadList = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/video-text');
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(body?.projects)) throw new Error(body?.error || 'Could not load the projects.');
      setProjects(body.projects);
      setListError(null);
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const openProject = useCallback(async (id: string) => {
    wanted.current = id;
    setOpening(id);
    setOpenError(null);
    try {
      const res = await adminFetch(`/api/admin/video-text/${id}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.project) throw new Error(body?.error || 'Could not load the project.');
      if (wanted.current === id) setOpen(body.project);
    } catch (err) {
      if (wanted.current === id) {
        setOpenError(err instanceof Error ? err.message : String(err));
        setUrlProject(null);
        wanted.current = null;
        void loadList();
      }
    } finally {
      setOpening((o) => (o === id ? null : o));
    }
  }, [loadList]);

  // First load: the list, plus the project named in ?p=. Back/forward follow the URL.
  useEffect(() => {
    const sync = () => {
      const id = projectFromUrl();
      // Back/forward away from a project with unsaved edits: ask, and on
      // "stay" put the project's address back.
      const current = openRef.current;
      if (current && id !== current.id && leaveGuard.current && !leaveGuard.current()) {
        setUrlProject(current.id);
        return;
      }
      if (id) void openProject(id);
      else {
        wanted.current = null;
        setOpen(null);
        void loadList();
      }
    };
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [loadList, openProject]);

  const pick = (id: string) => {
    setUrlProject(id);
    void openProject(id);
  };

  const back = () => {
    setUrlProject(null);
    wanted.current = null;
    setOpen(null);
    void loadList();
  };

  const create = async () => {
    const name = newName.trim();
    if (!name || saving) return;
    setSaving(true);
    setCreateError(null);
    try {
      const res = await adminFetch('/api/admin/video-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.project) throw new Error(body?.error || 'Could not create the project.');
      setCreating(false);
      setNewName('');
      setUrlProject(body.project.id);
      wanted.current = body.project.id;
      setOpen(body.project);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full min-w-0 max-w-4xl space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
          <Type className="h-6 w-6 text-orange-600 dark:text-orange-400" aria-hidden="true" />
          Video Text
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Add a title, lyrics and credits to a finished video.
        </p>
      </header>

      {open ? (
        <VideoTextEditor key={open.id} project={open} onBack={back} leaveGuard={leaveGuard} />
      ) : (
        <div className="space-y-4">
          {creating ? (
            <form
              className="flex min-w-0 flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <input
                aria-label="Project name"
                autoFocus
                value={newName}
                maxLength={120}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Song name"
                className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              />
              <button
                type="submit"
                disabled={!newName.trim() || saving}
                className="rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setCreateError(null);
                }}
                className="rounded-md px-3 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
              >
                Cancel
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New project
            </button>
          )}
          {createError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {createError}
            </p>
          )}
          {openError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {openError}
            </p>
          )}
          {listError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {listError}
            </p>
          )}

          {projects && projects.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400">No projects yet.</p>
          )}
          {projects && projects.length > 0 && (
            <ul className="divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
              {projects.map((p) => {
                const status = STATUS_TEXT[p.render?.status];
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => pick(p.id)}
                      disabled={opening === p.id}
                      className="flex w-full min-w-0 items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-none dark:hover:bg-gray-900 dark:focus-visible:bg-gray-900"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">{p.name}</span>
                        <span className="block text-xs text-gray-500 dark:text-gray-400">Edited {edited(p.updatedAt)}</span>
                      </span>
                      {status && <span className={`shrink-0 text-xs font-medium ${status.tone}`}>{status.text}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
