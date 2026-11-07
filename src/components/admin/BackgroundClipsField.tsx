'use client';

/**
 * The background clips of a render — one, or a story told in up to
 * MAX_BACKGROUND_CLIPS, played in order and repeated under the song if it is
 * longer (2026-11-07). Shared by the Mastering panel and each library row.
 *
 * Two ways in: upload files (several at once), or **Add clips from a visual
 * story**, which lists the story's own clip files — nothing is downloaded or
 * uploaded again, the keys are already in the mastering workspace.
 */

import { useCallback, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { uploadToWorkspace } from '@/lib/mastering-upload-client';
import { MAX_BACKGROUND_CLIPS, backgroundSummary } from '@/lib/master-background';
import { storyBackgroundClips, type StoryClip } from '@/lib/visual-story-clips';
import type { Candidate, Shot } from '@/types/visualStory';

export interface BackgroundClip {
  key: string;
  name: string;
  /** Seconds, when known (a story clip's shot, or what the browser read from the file). */
  seconds?: number | null;
}

type StoryRow = { vsId: string; title: string; updatedAt: string };

/** A clip file's length as the browser reads it; null for a GIF or a file it cannot read. */
function readVideoSeconds(file: File): Promise<number | null> {
  if (!file.type.startsWith('video/') || typeof URL.createObjectURL !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    const done = (v: number | null) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(v);
    };
    const timer = setTimeout(() => done(null), 10_000);
    video.preload = 'metadata';
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
    video.onerror = () => done(null);
    video.src = url;
  });
}

const fileInputClass =
  'mt-1 block w-full max-w-xs text-xs text-gray-600 file:mr-3 file:rounded-lg file:border file:border-gray-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-gray-700 dark:text-gray-300 dark:file:border-gray-700 dark:file:bg-gray-900 dark:file:text-gray-200';
const linkClass = 'text-orange-700 underline disabled:opacity-60 dark:text-orange-300';

export function BackgroundClipsField(props: {
  idPrefix: string;
  /** Read in the label: "for <title>" on a library row. */
  forWhom?: string;
  clips: BackgroundClip[];
  onChange: (update: (prev: BackgroundClip[]) => BackgroundClip[]) => void;
  /** The master whose stories are listed first. */
  masterJobId: string | null;
  songSeconds: number | null;
  /** A render in progress: the list is what it is using. */
  disabled: boolean;
  /** An upload in flight — the caller holds its Render buttons. */
  onBusyChange?: (busy: boolean) => void;
  onError: (message: string | null) => void;
  onAnnounce?: (message: string) => void;
}) {
  const { clips, onChange, onBusyChange, onError, onAnnounce, disabled } = props;
  const [progress, setProgress] = useState<string | null>(null);
  const [stories, setStories] = useState<{ rows: StoryRow[]; all: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<{ vsId: string; clips: StoryClip[]; withoutClip: string[] } | null>(null);
  const room = MAX_BACKGROUND_CLIPS - clips.length;
  const busy = progress !== null || loading;

  /** Appends what fits; the count is from the list as shown, the updater re-checks the latest. */
  const add = useCallback(
    (more: BackgroundClip[]) => {
      onChange((prev) => [...prev, ...more.slice(0, Math.max(0, MAX_BACKGROUND_CLIPS - prev.length))]);
      return Math.min(more.length, Math.max(0, MAX_BACKGROUND_CLIPS - clips.length));
    },
    [onChange, clips.length]
  );

  const onFiles = useCallback(
    async (files: File[]) => {
      onError(null);
      const take = files.slice(0, room);
      if (take.length < files.length) onError(`Only ${take.length} more fit — ${MAX_BACKGROUND_CLIPS} clips at most.`);
      if (take.length === 0) return;
      onBusyChange?.(true);
      try {
        for (let i = 0; i < take.length; i++) {
          const file = take[i];
          const label = take.length > 1 ? `Uploading ${i + 1} of ${take.length}` : 'Uploading background';
          setProgress(`${label}… 0%`);
          // Read beside the upload, never before it: a file the browser cannot
          // decode may say nothing until the timeout.
          const length = readVideoSeconds(file);
          const key = await uploadToWorkspace(
            file,
            (loaded, total) => setProgress(`${label}… ${total ? Math.floor((loaded / total) * 100) : 0}%`),
            new AbortController().signal,
            'background'
          );
          add([{ key, name: file.name, seconds: null }]);
          void length.then((seconds) => {
            if (seconds !== null) onChange((prev) => prev.map((c) => (c.key === key ? { ...c, seconds } : c)));
          });
        }
        onAnnounce?.(take.length > 1 ? `${take.length} clips uploaded.` : 'Background uploaded.');
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      } finally {
        setProgress(null);
        onBusyChange?.(false);
      }
    },
    [room, add, onChange, onBusyChange, onError, onAnnounce]
  );

  const openStories = useCallback(async () => {
    onError(null);
    setLoading(true);
    try {
      const load = async (query: string) => {
        const res = await adminFetch(`/api/admin/visual-story${query}`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.success) throw new Error(body.error || 'Could not load the visual stories.');
        return (body.data as StoryRow[]).map((s) => ({ vsId: s.vsId, title: s.title, updatedAt: s.updatedAt }));
      };
      let rows = props.masterJobId ? await load(`?masterJobId=${encodeURIComponent(props.masterJobId)}`) : [];
      const all = rows.length === 0;
      if (all) rows = await load('');
      rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      setStories({ rows, all });
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [props.masterJobId, onError]);

  const pickStory = useCallback(
    async (vsId: string) => {
      onError(null);
      setPicked(null);
      if (!vsId) return;
      setLoading(true);
      try {
        const res = await adminFetch(`/api/admin/visual-story/${encodeURIComponent(vsId)}`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.success) throw new Error(body.error || 'Could not load that story.');
        const tree = body.data as { shots: Shot[]; candidates: Candidate[] };
        setPicked({ vsId, ...storyBackgroundClips(tree) });
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [onError]
  );

  const addStory = useCallback(() => {
    if (!picked) return;
    const added = add(picked.clips);
    if (added < picked.clips.length) {
      onError(`Only the first ${added} of the story's ${picked.clips.length} clips fit — ${MAX_BACKGROUND_CLIPS} clips at most.`);
    }
    onAnnounce?.(`${added} clip${added === 1 ? '' : 's'} added from the story.`);
    setPicked(null);
    setStories(null);
  }, [picked, add, onError, onAnnounce]);

  const move = (i: number, by: -1 | 1) =>
    onChange((prev) => {
      const next = [...prev];
      const j = i + by;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const remove = (i: number) => onChange((prev) => prev.filter((_, n) => n !== i));
  const secs = (s?: number | null) =>
    typeof s === 'number' && s > 0 ? ` (${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, '0')})` : '';

  return (
    <div>
      <label htmlFor={`${props.idPrefix}-background`} className="block text-xs font-medium text-gray-600 dark:text-gray-300">
        Background videos or GIFs{props.forWhom ? ` for ${props.forWhom}` : ''} (optional — up to {MAX_BACKGROUND_CLIPS}, played in order)
      </label>

      {clips.length > 0 && (
        <>
          <ol className="mt-1 space-y-1 text-xs text-gray-600 dark:text-gray-300">
            {clips.map((c, i) => (
              <li key={`${c.key}-${i}`} className="flex flex-wrap items-center gap-2">
                <span>
                  {i + 1}. <span className="font-medium">{c.name}</span>
                  {secs(c.seconds)}
                </span>
                <button type="button" onClick={() => move(i, -1)} disabled={disabled || i === 0} className={linkClass} aria-label={`Move clip ${i + 1} up`}>
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={disabled || i === clips.length - 1}
                  className={linkClass}
                  aria-label={`Move clip ${i + 1} down`}
                >
                  ↓
                </button>
                <button type="button" onClick={() => remove(i)} disabled={disabled} className={linkClass} aria-label={`Remove clip ${i + 1}`}>
                  Remove
                </button>
              </li>
            ))}
          </ol>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span>{backgroundSummary(clips, props.songSeconds)}</span>
            <button type="button" onClick={() => onChange(() => [])} disabled={disabled} className={linkClass}>
              Remove all
            </button>
          </p>
        </>
      )}

      {room > 0 && (
        <input
          id={`${props.idPrefix}-background`}
          type="file"
          multiple
          accept="video/mp4,video/quicktime,video/webm,image/gif"
          disabled={disabled || busy}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length) void onFiles(files);
          }}
          className={fileInputClass}
        />
      )}
      {progress && (
        <p role="status" className="mt-1 text-xs text-gray-600 dark:text-gray-300">
          {progress}
        </p>
      )}

      {room > 0 && !stories && (
        <button type="button" onClick={() => void openStories()} disabled={disabled || busy} className={`mt-1 text-xs ${linkClass}`}>
          Add clips from a visual story
        </button>
      )}
      {stories && (
        <div className="mt-2 space-y-1 rounded-lg border border-gray-200 p-2 text-xs dark:border-gray-700">
          <label htmlFor={`${props.idPrefix}-story`} className="block font-medium text-gray-600 dark:text-gray-300">
            Visual story
          </label>
          {stories.all && stories.rows.length > 0 && (
            <p className="text-gray-500 dark:text-gray-400">No story is linked to this song, so every story is listed.</p>
          )}
          {stories.rows.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400">There are no visual stories yet.</p>
          ) : (
            <select
              id={`${props.idPrefix}-story`}
              defaultValue=""
              disabled={loading}
              onChange={(e) => void pickStory(e.target.value)}
              className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            >
              <option value="">Choose a story…</option>
              {stories.rows.map((s) => (
                <option key={s.vsId} value={s.vsId}>
                  {s.title || s.vsId}
                </option>
              ))}
            </select>
          )}
          {picked && (
            <>
              <p className="text-gray-600 dark:text-gray-300">
                {picked.clips.length === 0
                  ? 'This story has no clips yet.'
                  : `${picked.clips.length} clip${picked.clips.length === 1 ? '' : 's'}, in story order · ${backgroundSummary(picked.clips, null).split(' · ')[1] ?? ''}`}
              </p>
              {picked.withoutClip.length > 0 && (
                <p className="text-gray-500 dark:text-gray-400">No clip yet, left out: {picked.withoutClip.join('; ')}.</p>
              )}
            </>
          )}
          <div className="flex gap-3">
            {picked && picked.clips.length > 0 && (
              <button type="button" onClick={addStory} disabled={disabled} className={linkClass}>
                Add {Math.min(picked.clips.length, room)} clip{Math.min(picked.clips.length, room) === 1 ? '' : 's'}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setStories(null);
                setPicked(null);
              }}
              className={linkClass}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
