'use client';

/**
 * One Video Text project, top to bottom: Name → Upload → Title, Credits,
 * Lyrics → Preview → Timeline → Text size, Lyric position → Make video →
 * Download. Before a video is uploaded only Name and Upload show.
 *
 * Every error sits directly under the control that caused it. Upload and Make
 * video are disabled while either is running; text stays editable during a
 * render (it is for the next one — autosave only holds it back while the
 * render is starting, see useAutosave's `hold`).
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Download, Loader2, UploadCloud } from 'lucide-react';
import { adminFetch } from '@/lib/client-auth';
import { putToS3 } from '@/lib/mastering-upload-client';
import { MAX_VIDEO_TEXT_BYTES } from '@/lib/video-text/keys';
import { syncTextToBlocks, unplacedLineCount, validateBlocks } from '@/lib/video-text/timeline';
import type { SourceInfo, TextBlock, TextStyle, VideoTextProject } from '@/types/videoText';
import { useAutosave, type AutosaveStatus } from './useAutosave';
import { useRenderJob } from './useRenderJob';
import { Timeline } from './Timeline';
import { TextPreview } from './TextPreview';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const EXPIRED = 'The uploaded video was deleted after 30 days — upload it again; your timing is kept.';
const UNPLAYABLE = 'The video could not be played — reload the page to try again.';
const LINK_RETRY_AFTER_MS = 60 * 1000;

/** "7 Dec 2026", in UTC so it matches the stored date everywhere. */
export function formatDay(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const mmss = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const sourceSummary = (s: SourceInfo) =>
  `Video: ${Math.min(s.width, s.height)}p · ${mmss(s.durationSec)} · deleted on ${formatDay(s.expiresAt)}`;

const isExpired = (s: SourceInfo | null) => Boolean(s && new Date(s.expiresAt).getTime() <= Date.now());

/** Phones often leave `file.type` empty for .mov/.mp4; fall back to the extension. */
function videoTypeOf(file: File): string | null {
  if (file.type === 'video/mp4' || file.type === 'video/quicktime') return file.type;
  if (file.type && file.type !== 'application/octet-stream') return null;
  if (/\.mp4$/i.test(file.name) || /\.m4v$/i.test(file.name)) return 'video/mp4';
  if (/\.mov$/i.test(file.name)) return 'video/quicktime';
  return null;
}

const INPUT =
  'w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const BUTTON =
  'inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-50';

function FieldError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="mt-1.5 text-sm text-red-600 dark:text-red-400">
      {children}
    </p>
  );
}

function Section({ title, children, testId }: { title?: string; children: ReactNode; testId?: string }) {
  return (
    <section className="min-w-0 space-y-2" data-testid={testId}>
      {title && <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{title}</h2>}
      {children}
    </section>
  );
}

type UploadState = { phase: 'idle' } | { phase: 'saving' } | { phase: 'uploading'; pct: number } | { phase: 'checking' };

export const LEAVE_MESSAGE = 'You have unsaved changes. Leave anyway?';
const HELD_MESSAGE = 'Changes will save when the render starts';

/**
 * Save status and error. Rendered under Name AND above the timeline, so a
 * failed save is seen beside the lyrics and blocks that caused it (on a phone
 * Name is off-screen by then). Only the first copy is announced.
 */
function SaveStatus({
  status,
  error,
  announce,
  testId,
}: {
  status: AutosaveStatus;
  error: string | null;
  announce: boolean;
  testId?: string;
}) {
  const label = status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : status === 'held' ? HELD_MESSAGE : null;
  return (
    <div className="min-w-0 text-xs" data-testid={testId}>
      <span
        className="text-gray-500 dark:text-gray-400"
        {...(announce ? { role: 'status', 'aria-live': 'polite' as const } : {})}
      >
        {status === 'error' ? null : label}
      </span>
      {status === 'error' && error && (
        <p {...(announce ? { role: 'alert' } : {})} className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

export function VideoTextEditor({
  project: initial,
  onBack,
  leaveGuard,
}: {
  project: VideoTextProject;
  onBack: () => void;
  /** Set to a check the app runs before leaving by browser Back; true = go. */
  leaveGuard?: { current: (() => boolean) | null };
}) {
  const [project, setProject] = useState<VideoTextProject>(initial);
  const [nameInput, setNameInput] = useState(initial.name);
  const [playhead, setPlayhead] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ids = { name: useId(), title: useId(), credits: useId(), lyrics: useId(), lyricsHint: useId(), file: useId(), size: useId() };

  const job = useRenderJob(initial.id, initial.render);
  const onVersion = useCallback((version: number) => setProject((p) => ({ ...p, version })), []);
  const autosave = useAutosave(project, onVersion, { hold: job.startingUp });

  // Leaving with unsaved edits — pending, held for a render, or failed — asks first.
  const { isDirty } = autosave;
  const confirmLeave = useCallback(() => !isDirty() || window.confirm(LEAVE_MESSAGE), [isDirty]);
  useEffect(() => {
    if (!leaveGuard) return;
    leaveGuard.current = confirmLeave;
    return () => {
      if (leaveGuard.current === confirmLeave) leaveGuard.current = null;
    };
  }, [leaveGuard, confirmLeave]);

  // ---- text → blocks
  const setTexts = (patch: Partial<Pick<VideoTextProject, 'titleText' | 'creditsText' | 'lyricsText'>>) =>
    setProject((p) => {
      const next = { ...p, ...patch };
      return p.source ? { ...next, blocks: syncTextToBlocks(p.blocks, next, p.source.durationSec) } : next;
    });
  const setBlocks = useCallback((blocks: TextBlock[]) => setProject((p) => ({ ...p, blocks })), []);
  const setStyle = (patch: Partial<TextStyle>) => setProject((p) => ({ ...p, style: { ...p.style, ...patch } }));
  const onName = (value: string) => {
    setNameInput(value);
    // The server needs a name; a cleared field keeps the last one until retyped.
    if (value.trim()) setProject((p) => ({ ...p, name: value }));
  };

  // ---- preview source: the local file right after an upload, else a fresh link
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const sourceKey = project.source?.key ?? null;
  const expired = isExpired(project.source);

  const fetchPreviewUrl = useCallback(async (): Promise<string> => {
    const res = await adminFetch(`/api/admin/video-text/${initial.id}/source`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || typeof body?.url !== 'string') throw new Error(body?.error || 'Could not load the video.');
    return body.url;
  }, [initial.id]);
  const linkFetchedAt = useRef(0);
  const resumeAt = useRef<number | null>(null);

  useEffect(() => {
    if (!sourceKey || expired || localUrl) return;
    let cancelled = false;
    setPreviewError(null);
    fetchPreviewUrl().then(
      (url) => {
        if (cancelled) return;
        linkFetchedAt.current = Date.now();
        setRemoteUrl(url);
      },
      (err) => !cancelled && setPreviewError(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      cancelled = true;
    };
  }, [sourceKey, expired, localUrl, fetchPreviewUrl]);

  // The link lasts an hour and timing 40 lines can take longer: once it
  // expires every seek fails. Fetch a new link and carry on from the same
  // spot. An error on a link under a minute old is not an expiry — say so.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !remoteUrl || localUrl) return;
    let cancelled = false;
    const onError = () => {
      if (Date.now() - linkFetchedAt.current < LINK_RETRY_AFTER_MS) {
        setPreviewError(UNPLAYABLE);
        return;
      }
      linkFetchedAt.current = Date.now();
      const at = v.currentTime;
      fetchPreviewUrl().then(
        (url) => {
          if (cancelled) return;
          resumeAt.current = at;
          setPreviewError(null);
          setRemoteUrl(url);
        },
        (err) => !cancelled && setPreviewError(err instanceof Error ? err.message : String(err)),
      );
    };
    const onLoaded = () => {
      if (resumeAt.current === null) return;
      v.currentTime = resumeAt.current;
      resumeAt.current = null;
    };
    v.addEventListener('error', onError);
    v.addEventListener('loadedmetadata', onLoaded);
    return () => {
      cancelled = true;
      v.removeEventListener('error', onError);
      v.removeEventListener('loadedmetadata', onLoaded);
    };
  }, [remoteUrl, localUrl, fetchPreviewUrl]);

  useEffect(() => () => {
    if (localUrl) URL.revokeObjectURL(localUrl);
  }, [localUrl]);

  // ---- upload
  const [upload, setUpload] = useState<UploadState>({ phase: 'idle' });
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState<string | null>(null);
  const [movedNote, setMovedNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const uploadBusy = useRef(false);
  const uploadedFile = useRef<File | null>(null);
  const uploadAbort = useRef(new AbortController());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const abort = uploadAbort.current;
    return () => {
      mounted.current = false;
      abort.abort(); // leaving the project stops its upload
    };
  }, []);

  /** Ask the worker to read the uploaded file; on success the project takes the new length. */
  const confirmSource = useCallback(
    async (key: string) => {
      setUpload({ phase: 'checking' });
      setRetryKey(null);
      const res = await adminFetch(`/api/admin/video-text/${initial.id}/source`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.source) {
        // Busy or a server blip: the file is already uploaded, so offer a retry
        // that only re-checks it. A 4xx (unreadable video) needs a new file.
        if (res.status >= 500) setRetryKey(key);
        throw new Error(body?.error || `Could not check the video (HTTP ${res.status}).`);
      }
      const source = body.source as SourceInfo;
      if (!mounted.current) return;
      setProject((p) => ({
        ...p,
        source,
        // Text typed while the file uploaded is newer than what the server fitted.
        blocks: syncTextToBlocks(body.blocks as TextBlock[], p, source.durationSec),
        version: body.version,
      }));
      const moved = Number(body.moved) || 0;
      setMovedNote(
        moved === 1
          ? '1 line was past the new end and was moved inside the video.'
          : moved > 1
            ? `${moved} lines were past the new end and were moved inside the video.`
            : null,
      );
      const file = uploadedFile.current;
      if (file) {
        setLocalUrl(URL.createObjectURL(file));
        setRemoteUrl(null);
      }
      setPlayhead(0);
    },
    [initial.id],
  );

  const runUpload = useCallback(
    async (work: () => Promise<void>) => {
      if (uploadBusy.current) return;
      uploadBusy.current = true;
      setUploadError(null);
      try {
        await work();
      } catch (err) {
        if (mounted.current) setUploadError(err instanceof Error ? err.message : String(err));
      } finally {
        uploadBusy.current = false;
        if (mounted.current) setUpload({ phase: 'idle' });
      }
    },
    [],
  );

  const onFile = (file: File | null | undefined) => {
    if (!file || job.running) return;
    void runUpload(async () => {
      setMovedNote(null);
      const contentType = videoTypeOf(file);
      if (!contentType) throw new Error('Upload an MP4 or MOV video.');
      if (file.size > MAX_VIDEO_TEXT_BYTES) throw new Error('Videos up to 1 GB can be used.');
      // The server fits the STORED text to the new length: save first. The
      // saving phase already counts as uploading, so Make video is disabled.
      setUpload({ phase: 'saving' });
      const saved = await autosave.flush();
      if (!saved.ok) throw new Error(saved.error);
      setUpload({ phase: 'uploading', pct: 0 });
      const res = await adminFetch(`/api/admin/video-text/${initial.id}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType, size: file.size }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.url || !body?.key) throw new Error(body?.error || `Could not start the upload (HTTP ${res.status}).`);
      const named = file.type === contentType ? file : new File([file], file.name, { type: contentType });
      await putToS3(
        body.url,
        body.fields ?? {},
        named,
        (loaded, total) => mounted.current && setUpload({ phase: 'uploading', pct: total ? Math.round((loaded / total) * 100) : 0 }),
        uploadAbort.current.signal,
      );
      uploadedFile.current = file;
      setLocalUrl(null); // the effect's cleanup revokes the old one
      await confirmSource(body.key);
    });
  };

  const retryCheck = () => {
    if (!retryKey) return;
    const key = retryKey;
    void runUpload(async () => {
      const saved = await autosave.flush();
      if (!saved.ok) throw new Error(saved.error);
      await confirmSource(key);
    });
  };

  // ---- Make video
  // One saved state is rendered: flush (waits out a save in flight, then
  // PATCHes what is on screen), and draw from exactly what was PATCHed. From
  // here autosave holds until the worker has read the stored blocks.
  const makeVideo = () => {
    const source = project.source;
    if (!source) return;
    void job.start({
      prepare: async () => {
        if (isExpired(source)) return EXPIRED;
        const saved = await autosave.flush();
        if (!saved.ok) return saved.error;
        const { blocks, style } = saved.edits;
        if (blocks.length === 0) return 'Add a title, lyrics or credits first.';
        const problem = validateBlocks(blocks, source.durationSec);
        if (problem) return problem;
        return { blocks, style, frame: { width: source.width, height: source.height }, version: saved.version };
      },
    });
  };

  // ---- Download
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const download = async () => {
    setDownloadError(null);
    setDownloading(true);
    try {
      const res = await adminFetch(`/api/admin/video-text/${initial.id}/download`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok || typeof body?.url !== 'string') throw new Error(body?.error || 'Could not create the download link.');
      // The link is an attachment, so the page stays put — and this is not
      // leaving, so the unsaved-changes warning must not fire for it.
      autosave.skipNextUnloadWarning();
      const a = document.createElement('a');
      a.href = body.url;
      a.download = '';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
    }
  };

  const seek = useCallback((sec: number) => {
    setPlayhead(sec);
    if (videoRef.current) videoRef.current.currentTime = sec;
  }, []);

  const source = project.source;
  const uploading = upload.phase !== 'idle';
  const lockUploadAndRender = uploading || job.running;
  const previewUrl = localUrl ?? remoteUrl;
  const render = job.render;
  // A video uploaded after the render finished makes that output out of date.
  const outputIsStale = Boolean(
    source && render.updatedAt && new Date(source.uploadedAt).getTime() > new Date(render.updatedAt).getTime(),
  );
  // A video too short for every line keeps the lines that fit; say how many do not.
  const unplaced = source ? unplacedLineCount(project.blocks, project) : 0;
  const showDownload = !job.running && render.status === 'done' && Boolean(render.outputKey) && !outputIsStale;

  return (
    <div className="min-w-0 space-y-6">
      <button
        type="button"
        onClick={() => confirmLeave() && onBack()}
        className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All projects
      </button>

      {/* Name */}
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={ids.name} className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            Name
          </label>
        </div>
        <input
          id={ids.name}
          className={`${INPUT} mt-1`}
          value={nameInput}
          maxLength={120}
          onChange={(e) => onName(e.target.value)}
        />
        <div className="mt-1">
          <SaveStatus status={autosave.status} error={autosave.error} announce />
        </div>
      </div>

      {/* Upload */}
      <Section title="Video">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!lockUploadAndRender) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!lockUploadAndRender) onFile(e.dataTransfer?.files?.[0]);
          }}
          className={`rounded-xl border-2 border-dashed p-5 text-center transition-colors ${
            dragging
              ? 'border-orange-400 bg-orange-50 dark:border-orange-500 dark:bg-orange-950/30'
              : 'border-gray-300 bg-gray-50/60 dark:border-gray-700 dark:bg-gray-900/30'
          } ${lockUploadAndRender ? 'opacity-60' : ''}`}
        >
          {upload.phase === 'saving' ? (
            <p className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Saving…
            </p>
          ) : upload.phase === 'uploading' ? (
            <div className="space-y-2">
              <p className="text-sm text-gray-700 dark:text-gray-200">Uploading {upload.pct}%</p>
              <div
                role="progressbar"
                aria-label="Upload progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={upload.pct}
                className="mx-auto h-1.5 max-w-xs overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800"
              >
                <div className="h-full rounded-full bg-orange-500 transition-[width]" style={{ width: `${upload.pct}%` }} />
              </div>
            </div>
          ) : upload.phase === 'checking' ? (
            <p className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Checking the video…
            </p>
          ) : (
            <>
              <UploadCloud className="mx-auto h-7 w-7 text-gray-400" aria-hidden="true" />
              <label
                htmlFor={ids.file}
                className={`mt-2 block text-sm font-medium ${lockUploadAndRender ? 'cursor-not-allowed text-gray-400' : 'cursor-pointer text-orange-600 hover:underline dark:text-orange-400'}`}
              >
                Choose a video
              </label>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">or drag the MP4 here · up to 1 GB</p>
            </>
          )}
          <input
            id={ids.file}
            type="file"
            accept="video/mp4,video/quicktime,.mp4,.mov,.m4v"
            disabled={lockUploadAndRender}
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              // Clear so picking the same file again still fires.
              e.target.value = '';
              onFile(f);
            }}
          />
        </div>
        {source && (
          <p className={`text-sm ${expired ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-300'}`}>
            {expired ? EXPIRED : sourceSummary(source)}
          </p>
        )}
        {movedNote && <p className="text-sm text-amber-700 dark:text-amber-400">{movedNote}</p>}
        <FieldError>{uploadError}</FieldError>
        {retryKey && !uploading && (
          <button
            type="button"
            onClick={retryCheck}
            disabled={job.running}
            className={`${BUTTON} border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800`}
          >
            Try again
          </button>
        )}
      </Section>

      {source && (
        <>
          {/* Text */}
          <div className="min-w-0 space-y-4">
            <div>
              <label htmlFor={ids.title} className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                Title
              </label>
              <input
                id={ids.title}
                className={`${INPUT} mt-1`}
                value={project.titleText}
                maxLength={500}
                onChange={(e) => setTexts({ titleText: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor={ids.credits} className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                Credits
              </label>
              <textarea
                id={ids.credits}
                rows={3}
                className={`${INPUT} mt-1`}
                value={project.creditsText}
                maxLength={500}
                onChange={(e) => setTexts({ creditsText: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor={ids.lyrics} className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                Lyrics
              </label>
              <span id={ids.lyricsHint} className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                one line per lyric line
              </span>
              <textarea
                id={ids.lyrics}
                aria-describedby={ids.lyricsHint}
                rows={8}
                className={`${INPUT} mt-1`}
                value={project.lyricsText}
                maxLength={20000}
                onChange={(e) => setTexts({ lyricsText: e.target.value })}
              />
            </div>
          </div>

          {/* Preview */}
          {!expired && (
            <Section>
              {previewUrl ? (
                <TextPreview
                  ref={videoRef}
                  videoUrl={previewUrl}
                  frame={{ width: source.width, height: source.height }}
                  blocks={project.blocks}
                  style={project.style}
                  onTime={setPlayhead}
                />
              ) : (
                !previewError && <p className="text-sm text-gray-500 dark:text-gray-400">Loading the video…</p>
              )}
              <FieldError>{previewError}</FieldError>
            </Section>
          )}

          {/* Timeline, with the save status beside it */}
          <SaveStatus status={autosave.status} error={autosave.error} announce={false} testId="timeline-save-status" />
          <Timeline
            blocks={project.blocks}
            durationSec={source.durationSec}
            playheadSec={playhead}
            onChange={setBlocks}
            onSeek={seek}
          />
          {unplaced > 0 && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              {unplaced === 1 ? "1 line doesn't" : `${unplaced} lines don't`} fit in this video — it is too short to show
              each for half a second.
            </p>
          )}

          {/* Style */}
          <div className="flex min-w-0 flex-wrap items-center gap-x-8 gap-y-3">
            <div className="flex items-center gap-3">
              <label htmlFor={ids.size} className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                Text size
              </label>
              <input
                id={ids.size}
                type="range"
                min={0.75}
                max={1.5}
                step={0.05}
                value={project.style.sizeScale}
                onChange={(e) => setStyle({ sizeScale: Number(e.target.value) })}
                className="w-32 accent-orange-600"
              />
              <span className="w-10 text-xs tabular-nums text-gray-500 dark:text-gray-400">
                {Math.round(project.style.sizeScale * 100)}%
              </span>
            </div>
            <div role="radiogroup" aria-label="Lyric position" className="flex items-center gap-3">
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-100" aria-hidden="true">
                Lyric position
              </span>
              <div className="inline-flex overflow-hidden rounded-md border border-gray-300 dark:border-gray-700">
                {(['lower', 'middle'] as const).map((pos) => (
                  <button
                    key={pos}
                    type="button"
                    role="radio"
                    aria-checked={project.style.lyricPosition === pos}
                    onClick={() => setStyle({ lyricPosition: pos })}
                    className={`px-3 py-1.5 text-sm ${
                      project.style.lyricPosition === pos
                        ? 'bg-orange-600 text-white'
                        : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800'
                    }`}
                  >
                    {pos === 'lower' ? 'Lower' : 'Middle'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Make video */}
          <div className="min-w-0" data-testid="make-video">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={makeVideo}
                disabled={lockUploadAndRender}
                className={`${BUTTON} bg-orange-600 text-white hover:bg-orange-700`}
              >
                Make video
              </button>
              {job.stage && (
                <span className="inline-flex items-center gap-2 text-sm tabular-nums text-gray-600 dark:text-gray-300" role="status">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {job.stage}
                </span>
              )}
            </div>
            <FieldError>{job.running ? null : job.error}</FieldError>
          </div>

          {/* Download */}
          {showDownload && (
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => void download()}
                disabled={downloading}
                className={`${BUTTON} border border-emerald-600 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500 dark:text-emerald-300 dark:hover:bg-emerald-950/40`}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Download
              </button>
              {render.outputExpiresAt && (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Deleted on {formatDay(render.outputExpiresAt)}</p>
              )}
              <FieldError>{downloadError}</FieldError>
            </div>
          )}
        </>
      )}
    </div>
  );
}
