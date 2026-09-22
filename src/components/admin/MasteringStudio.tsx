'use client';

/**
 * Sound Engineering & Mastering — the whole module in one guided page.
 *
 * Pipeline this serves: export the WAV from SUNO -> upload here -> master to a
 * streaming target -> download the mastered WAV -> cut picture in Adobe.
 *
 * Things the UI is deliberately opinionated about, because each is a mistake
 * the API alone can't prevent:
 *  - WAV only. Mastering an MP3 re-levels a file that has already lost detail.
 *  - The master is measured on the way out (`afterLufs`), so "did it work?" is
 *    answered on screen instead of by downloading the file and trusting it.
 *  - Master ONCE. Premiere's "Auto-Match to -14" silently undoes the whole job,
 *    so the hand-off note sits next to the download button, not in a doc.
 *
 * The running job is mirrored into sessionStorage: the worker keeps going
 * whether or not this component is mounted, so navigating away (or a session
 * bounce) must not orphan a master that is about to land in S3.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  SlidersHorizontal, Upload, Download, Loader2, CheckCircle2,
  AlertTriangle, FileAudio, RotateCcw, X, Info, Save, Library, Play, Pause, Pencil, Link2, Film,
  Smartphone,
} from 'lucide-react';
import { adminFetch } from '@/lib/client-auth';
import { putToS3, uploadToWorkspace } from '@/lib/mastering-upload-client';
import { pollJob } from '@/lib/poll-job';
import { statusFor, platformLanding } from '@/lib/loudness-targets';
import { nextRadioIndex, radioTabIndex } from '@/lib/radiogroup-keys';
import { MAX_UPLOAD_BYTES, ACCEPTED_UPLOAD_TYPES, downloadFilename } from '@/lib/mastering-storage';
import { buildMasterReport, reportFilename, sourceInfoLine, dynamicsPreserved, streamingReadiness, joinLine } from '@/lib/master-report';
import { MasteringComparePlayer } from '@/components/admin/MasteringComparePlayer';
import { MasteringPlayer } from '@/components/admin/MasteringPlayer';
import { ShortWindowFields } from '@/components/admin/ShortWindowFields';
import { ReleasePipelineRow } from '@/components/admin/ReleasePipelineRow';
import type { PartComparison } from '@/lib/part-analysis';
import { SHORT_PICK_MIN_SECONDS, SHORT_PICK_MAX_SECONDS } from '@/lib/master-short';
import { formatTime } from '@/lib/waveform';
import { MasteringTrimPanel } from '@/components/admin/MasteringTrimPanel';
import { MasteringJoinPanel } from '@/components/admin/MasteringJoinPanel';
import { DEFAULT_CROSSFADE_CURVE, type MasterJoin } from '@/lib/master-join';
// The SAME constant the enqueue route's planner uses, never a second copy of
// the number: this panel's Retry must become available exactly when the server
// would start accepting a new attempt, not a minute either side of it.
import { UPLOAD_STALE_AFTER_MS } from '@/lib/youtube-upload';
import {
  groupMastersBySong,
  describeGroup,
  filterMasters,
  sortMasters,
  LIBRARY_SORTS,
  type LibrarySort,
} from '@/lib/master-library';
import { buildUploadDescription } from '@/lib/youtube-description';
import {
  ALL_SONGS_PLAYLIST_ID,
  LATEST_PLAYLIST_ID,
  type Finding,
} from '@/lib/release-checklist';
import { FindingRow, groupFindings } from '@/components/admin/ReleaseFindings';

/**
 * Rows per library page. 25 is roughly a screenful of grouped rows and keeps
 * the DynamoDB query well inside one page, so "Show more" is one round trip.
 */
const LIBRARY_PAGE_SIZE = 25;
import type { FadeVerdict, LevelVerdict } from '@/lib/master-analysis';

/** What GET /api/admin/mastering/analyse/[id] returns once it is done. */
interface AnalysisResult {
  leadingSilenceSec: number | null;
  trailingSilenceSec: number | null;
  durationSec: number | null;
  fade: FadeVerdict;
  partBFade: FadeVerdict | null;
  level: LevelVerdict | null;
  trim: { trimStartSec: number; trimEndSec: number | null } | null;
}
import { mp3PeakVerdict } from '@/lib/master-mp3';
import { isPeakMaster, PEAK_CEILING_DBTP, KARAOKE_MP3_BITRATE } from '@/lib/master-peak';
import type { MasterEdit } from '@/lib/master-edit';
import type { MasterJob, MatchingMethod } from '@/types/masterJob';
import { FEATURES } from '@/config/features';

/** Where the platforms normalise playback. */
/**
 * What to master TO. Two loudness targets and one that is not a loudness
 * target at all.
 *
 * ⚠️ KEYED BY `id`, NOT BY `lufs`. The karaoke bed carries -14 because the
 * route requires a target and the job stores one, but nothing aims at it: a bed
 * is normalised by one gain to the ceiling and lands wherever its own level
 * puts it. That means a bed and a -14 master SHARE a loudness number, so every
 * "which one is selected" comparison has to be by id — including the re-arm
 * below, which would otherwise leave a finished bed on screen when the operator
 * switched to mastering the same file for Spotify.
 */
const TARGETS = [
  { id: '-14', mode: 'loudness', lufs: -14, label: '-14 LUFS', for: 'Spotify · YouTube · Amazon · TIDAL' },
  { id: '-16', mode: 'loudness', lufs: -16, label: '-16 LUFS', for: 'Apple Music' },
  {
    id: 'karaoke',
    mode: 'peak',
    lufs: -14,
    label: 'Karaoke bed',
    for: `${KARAOKE_MP3_BITRATE} MP3 · no vocals · headroom for a live voice`,
  },
] as const;

type TargetId = (typeof TARGETS)[number]['id'];

/**
 * How a bed's download is labelled. A bed is named by what it IS — "(Master
 * -14 LUFS)" on a file that lands at -20.2 is how the wrong file gets sent to a
 * buyer, or worse, uploaded as the song.
 */
const bedLabel = `Karaoke bed ${PEAK_CEILING_DBTP} dBTP`;

/** The entry for an id, falling back to -14 so a bad stored value cannot break the page. */
const targetById = (id: string): (typeof TARGETS)[number] =>
  TARGETS.find((t) => t.id === id) ?? TARGETS[0];

/**
 * Which entry produced a finished job. Derived rather than stored, so a job
 * from the library or from sessionStorage lands on the right radio without a
 * second field that could disagree with `normalizationMode`.
 */
const targetIdOf = (job: { target: number; normalizationMode?: MasterJob['normalizationMode'] }): TargetId =>
  isPeakMaster(job) ? 'karaoke' : ((String(job.target) as TargetId));

type Stage = 'idle' | 'uploading' | 'ready' | 'mastering' | 'done';

/** What survives a remount — enough to re-attach to a job still running. */
interface StoredJob {
  jobId: string;
  sourceKey: string;
  name: string;
  size: number;
  target: number;
  /**
   * WHICH radio was chosen. Persisted alongside `target` rather than derived
   * from it, because a karaoke bed and a -14 master share a target number: a
   * remount mid-run would otherwise re-attach to a bed as if it were a -14
   * master and show a red off-target verdict on a file that was exactly right.
   * Optional so a job stored before beds existed still rehydrates.
   */
  targetId?: TargetId;
  /**
   * The two-part assembly, if any. Persisted because the trim degrades
   * gracefully on a remount (the panel reappears empty and the admin sees it)
   * while a lost Part B does not: the join panel would come back collapsed, and
   * re-mastering to the second target would quietly produce Part A alone —
   * a different, shorter song, with nothing on screen saying so.
   */
  partBKey?: string;
  partBName?: string;
  overlapSec?: number;
  partBStartSec?: number;
}
const STORE_KEY = 'mastering-studio-job';

const readStored = (): StoredJob | null => {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as StoredJob) : null;
  } catch {
    return null;
  }
};
const writeStored = (j: StoredJob | null) => {
  try {
    if (j) sessionStorage.setItem(STORE_KEY, JSON.stringify(j));
    else sessionStorage.removeItem(STORE_KEY);
  } catch {
    /* private mode / quota — resume is a nicety, never a requirement */
  }
};

/**
 * True when a rejection is just our own AbortController firing — the admin
 * pressing "Cancel upload" / "Stop watching", or the component unmounting.
 *
 * These reached the shared `catch` and were rendered as red `role="alert"`
 * banners, so a deliberate cancel reported itself as a failure ("Upload
 * cancelled.") and stopping the watch could announce "Mastering failed." with a
 * raw "signal is aborted without reason" — for a job that was, in fact, still
 * running perfectly well server-side. A cancel is an outcome, not an error.
 */
const isAbort = (err: unknown): boolean =>
  (err instanceof DOMException && err.name === 'AbortError') ||
  (err instanceof Error && (err.name === 'AbortError' || /abort|cancel/i.test(err.message)));

const MB = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const lufs = (v: number | null | undefined) => (typeof v === 'number' ? `${v.toFixed(1)} LUFS` : '—');
const dbtp = (v: number | null | undefined) => (typeof v === 'number' ? `${v.toFixed(2)} dBTP` : '—');
const lu = (v: number | null | undefined) => (typeof v === 'number' ? `${v.toFixed(1)} LU` : '—');

/**
 * pollJob wants a Response but only ever reads `ok`, `status` and `json()`.
 * Building a real `new Response(...)` would tie this component to a Fetch
 * global that isn't guaranteed everywhere it runs, so hand back the minimal
 * shape instead.
 */
const asResponse = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body }) as Response;

/** Upload straight to S3 with progress. fetch() can't report upload progress. */

/**
 * The join payload for a run: the two fields the panel owns, over whatever the
 * re-opened recipe carried.
 *
 * Rebuilding a seam from scratch is what would silently drop a saved non-default
 * curve or a fade on Part B — neither of which the panel can show, and both of
 * which change the audio. `trimStartSec` is always the panel's, including 0,
 * because clearing the head trim is a real instruction.
 */
export function buildJoinPayload(p: {
  partBKey: string;
  overlapSec: number;
  partBStartSec: number;
  seed: MasterJoin | null;
}): MasterJoin {
  const seedEditB = p.seed?.editB ?? null;
  const editB =
    p.partBStartSec > 0 || seedEditB
      ? {
          trimEndSec: null,
          fadeInSec: 0,
          fadeOutSec: 0,
          curve: DEFAULT_CROSSFADE_CURVE,
          ...(seedEditB ?? {}),
          trimStartSec: p.partBStartSec,
        }
      : null;
  return {
    partBKey: p.partBKey,
    overlapSec: p.overlapSec,
    curve: p.seed?.curve ?? DEFAULT_CROSSFADE_CURVE,
    editB,
  };
}

/**
 * What `GET /api/admin/youtube/release-check` returns. `stored` is the
 * READ-BACK: the values YouTube is actually holding, off the same videos.list
 * call the findings were graded from. Everything in it is optional-by-type
 * because a response from a deploy predating the read-back must degrade to
 * "not available" rather than crash the panel.
 */
interface ReleaseCheckResult {
  videoId: string;
  title: string;
  blockers: number;
  gaps: number;
  notes: number;
  notChecked: number;
  ready: boolean;
  findings: Finding[];
  captionsChecked?: boolean;
  stored?: {
    duration: string | null;
    durationSeconds: number;
    definition: string | null;
    privacyStatus: string | null;
    categoryId: string | null;
    tagCount: number;
    defaultLanguage: string | null;
    defaultAudioLanguage: string | null;
    thumbnail: { name: string; url: string; width: number; height: number } | null;
    playlistIds: string[];
  };
  quota?: { used: number; limit: number; spent: number };
}

/**
 * Playlists an upload can be added to. The two the release checklist grades
 * every song against — imported from it rather than re-typed, so a playlist
 * that moves cannot leave the panel adding songs to a dead id while the
 * checker keeps reporting them missing.
 */
const UPLOAD_PLAYLISTS = [
  { id: ALL_SONGS_PLAYLIST_ID, label: 'All Songs' },
  { id: LATEST_PLAYLIST_ID, label: 'Latest' },
] as const;

/**
 * Comma/newline-separated text → YouTube tags. Exported for its own unit test:
 * the upload route caps the list at 60 and rejects the whole body with a
 * generic "A title and description are required." if it is longer, so an
 * over-long list must be trimmed HERE, where the operator can see it, rather
 * than turning into an unexplained 400.
 */
export function parseTagList(input: string): string[] {
  const seen = new Set<string>();
  for (const raw of (input ?? '').split(/[,\n]/)) {
    const tag = raw.trim().replace(/\s+/g, ' ');
    if (tag) seen.add(tag);
  }
  return [...seen].slice(0, 60);
}

/**
 * Free text → hashtags, as `buildUploadDescription` wants them: DATA, not
 * text pasted into the body and hoped to survive.
 *
 * A hashtag cannot contain a space, so each entry is split on whitespace and
 * commas and given exactly one leading `#`. YouTube shows only the first three
 * above the title, but the rest are still indexed, so the cap is generous
 * rather than three.
 */
export function parseHashtags(input: string): string[] {
  const seen = new Set<string>();
  for (const raw of (input ?? '').split(/[\s,]+/)) {
    const bare = raw.replace(/^#+/, '').trim();
    if (bare) seen.add(`#${bare}`);
  }
  return [...seen].slice(0, 15);
}

/** Seconds → m:ss, for the read-back duration. */
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

export function MasteringStudio() {
  const inputId = useId();
  const [stage, setStage] = useState<Stage>('idle');
  /** Name/size only — survives a remount, unlike a File handle. */
  const [source, setSource] = useState<{ name: string; size: number } | null>(null);
  const [sourceKey, setSourceKey] = useState<string | null>(null);
  const [sent, setSent] = useState({ loaded: 0, total: 0 });
  /**
   * The SELECTED radio, which is the single source of truth: `target` and the
   * normalization mode are derived from it, never stored separately. Two fields
   * would need updating together at nine call sites, and one of them would
   * eventually be missed.
   */
  const [targetId, setTargetId] = useState<TargetId>('-14');
  const selectedTarget = targetById(targetId);
  const target = selectedTarget.lufs;
  /** True when the next run makes a karaoke bed rather than a streaming master. */
  const isBed = selectedTarget.mode === 'peak';
  /** Arrow keys move focus as well as selection — the radiogroup pattern. */
  const targetRefs = useRef<Array<HTMLButtonElement | null>>([]);
  /**
   * The picked File, kept only so the trim panel can draw a waveform without a
   * round trip. Deliberately a ref-like state that is NOT persisted: `source`
   * above stores name/size precisely because a File handle cannot survive a
   * remount, and the trim panel degrades to numeric entry when this is null.
   */
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  /** Trim/fade for the next run; null means master the whole file. */
  const [edit, setEdit] = useState<MasterEdit | null>(null);
  /** Part B of a two-part assembly, once uploaded. Null = single-source master. */
  const [partB, setPartB] = useState<{ key: string; name: string } | null>(null);
  const [partBUploading, setPartBUploading] = useState(false);
  const [partBSent, setPartBSent] = useState({ loaded: 0, total: 0 });
  const [overlapSec, setOverlapSec] = useState(3);
  /** Head trim on Part B — how its entry is nudged onto the beat. */
  const [partBStartSec, setPartBStartSec] = useState(0);
  /**
   * The seam preview. Held as ONE object so the URL and the note it belongs to
   * can never be shown together from different renders — a level reading
   * describing settings the audio no longer matches is worse than no reading.
   */
  const [seamPreview, setSeamPreview] = useState<{
    url: string;
    note: string;
    mismatched: boolean;
    /** The two parts measured against each other, when the worker managed it. */
    comparison: PartComparison | null;
  } | null>(null);
  const [seamBusy, setSeamBusy] = useState(false);
  const [job, setJob] = useState<MasterJob | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  // Reference-matched mastering (Phase 1C UI). All three pieces of state are
  // gated on FEATURES.ADMIN.MASTERING_REFERENCE_MATCHING at the render site;
  // when the flag is off the picker never shows, the fetch never fires, and
  // the enqueue body stays byte-identical to the loudnorm-only shape.
  const [references, setReferences] = useState<{ id: string; key: string }[]>([]);
  const [referencesLoading, setReferencesLoading] = useState(false);
  const [referencesError, setReferencesError] = useState<string | null>(null);
  const [selectedReferenceKey, setSelectedReferenceKey] = useState<string | null>(null);
  const [matchingMethod, setMatchingMethod] = useState<Exclude<MatchingMethod, 'loudnorm'>>('both');
  // Optional human title for the export. Storage stays UUID-based; this only
  // shapes the download filename and the saved report. Empty ⇒ de-noised default.
  const [masterName, setMasterName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [announce, setAnnounce] = useState('');
  const [dragging, setDragging] = useState(false);
  /** A job we stopped watching but which is still running — offers a way back. */
  const [paused, setPaused] = useState<StoredJob | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  /** Cover art for the YouTube render, once uploaded. */
  const [cover, setCover] = useState<{ key: string; name: string } | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const [videoHeight, setVideoHeight] = useState<number>(1440);
  const [rendering, setRendering] = useState(false);
  /** The vertical hook clip for Reels/Shorts — a separate render from the video. */
  const [shorting, setShorting] = useState(false);
  /**
   * The window for the short, when the operator chose one.
   *
   * `null` means "let it pick the loudest stretch" — the original behaviour and
   * still the default. It is deliberately ONE piece of state shared by the
   * inline panel and the library rows: the region is chosen in the audition
   * player at the bottom of the library, and a per-row copy would mean the
   * player had to know which row it was feeding.
   */
  const [shortWindow, setShortWindow] =
    useState<{ jobId: string; startSec: number; seconds: number } | null>(null);

  /**
   * The window for THIS master, or null — never another master's.
   *
   * ⚠️ The first cut of this was a bare {startSec, seconds} shared by every
   * row, so a window set while listening to one song silently applied to
   * whichever row was rendered next: a clip cut from the wrong part of a
   * different song, with nothing on screen saying so. Scoping it to an id makes
   * that impossible.
   */
  const windowFor = useCallback(
    (id: string | null) =>
      id && shortWindow?.jobId === id
        ? { startSec: shortWindow.startSec, seconds: shortWindow.seconds }
        : null,
    [shortWindow]
  );
  /**
   * YouTube upload panel. The title is `null` until the operator types in it —
   * NOT '' — so an untouched field can mirror `masterName` (the name already
   * given to this master) while a deliberately cleared one stays cleared. A
   * plain '' could not tell those two apart, and an effect that copied
   * `masterName` in would fight whatever was being typed.
   */
  const [uploadTitle, setUploadTitle] = useState<string | null>(null);
  const [uploadBody, setUploadBody] = useState('');
  const [uploadTagsText, setUploadTagsText] = useState('');
  const [uploadHashtagsText, setUploadHashtagsText] = useState('');
  const [uploadPlaylistIds, setUploadPlaylistIds] = useState<string[]>(
    UPLOAD_PLAYLISTS.map((p) => p.id)
  );
  const [uploadingToYoutube, setUploadingToYoutube] = useState(false);
  /**
   * Presigned URL for the cover the video was built from — the picture, on
   * screen, BEFORE the upload. A bad render reaching YouTube unseen is the
   * whole reason this panel exists.
   */
  const [framePreviewUrl, setFramePreviewUrl] = useState<string | null>(null);
  /** The release check + read-back for the uploaded video. */
  const [releaseCheck, setReleaseCheck] = useState<ReleaseCheckResult | null>(null);
  const [releaseChecking, setReleaseChecking] = useState(false);
  const [releaseCheckError, setReleaseCheckError] = useState<string | null>(null);
  /**
   * Rendering a video for a master saved in an EARLIER session, from the
   * library. The inline panel above cannot do this: it is gated on `savedAt`,
   * which is set only by clicking Save in the current session and is cleared by
   * `reopenMaster`. So a master saved yesterday had a masterKey in S3 and a
   * videoKey column in DynamoDB that nothing on this page could reach — the
   * same defect the MP3 row button already fixed for the web file.
   */
  const [rowRender, setRowRender] = useState<{ id: string; cover: { key: string; name: string } | null } | null>(null);
  /**
   * Bumped whenever a saved recipe is loaded. Used as a `key` on the edit
   * panels so they remount and re-seed: they hold their own state, so without a
   * remount a re-opened trim would be read once and then ignored.
   */
  const [recipeNonce, setRecipeNonce] = useState(0);
  /** The edit a re-opened master arrived with, seeding the trim panel. */
  const [seedEdit, setSeedEdit] = useState<MasterEdit | null>(null);
  /**
   * The re-opened source's duration, from the job that recorded it.
   *
   * Held separately because `reopenMaster` clears `job` — a re-open is a NEW
   * run, so presenting the old job's result would be wrong — and reading the
   * duration off `job` therefore always yielded 0. Without it the panel cannot
   * tell a saved "ends at 365" on a 365s source from a real tail trim, and
   * re-sends a redundant edit that costs a pre-pass copying the file for nothing.
   */
  const [seedDurationSec, setSeedDurationSec] = useState(0);
  /**
   * The full seam a re-opened master arrived with.
   *
   * The panel exposes only the overlap and Part B's head trim, but the API
   * accepts a richer recipe — a non-default curve, a tail trim or fades on Part
   * B. Rebuilding the seam from the two visible fields would silently discard
   * the rest and re-master a DIFFERENT song, so anything not on screen is
   * carried through untouched.
   *
   * Applied only while Part B is still the file it came from: swapping in
   * another Part B must not inherit the previous one's edit.
   */
  const [seedJoin, setSeedJoin] = useState<MasterJoin | null>(null);
  /** Pre-master analysis of the uploaded source: measurements + verdicts. */
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analysing, setAnalysing] = useState(false);
  /** Where the web MP3 landed on the site's audio path, once staged. */
  const [published, setPublished] = useState<{ key: string; replaced: boolean } | null>(null);
  const [library, setLibrary] = useState<MasterJob[] | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  /** Opaque next-page cursor from the API; null = no more pages. */
  const [libraryCursor, setLibraryCursor] = useState<string | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [librarySearch, setLibrarySearch] = useState('');
  const [librarySort, setLibrarySort] = useState<LibrarySort>('newest');
  /** Which saved master is loaded in the library player, and its presigned URL. */
  const [playing, setPlaying] = useState<{ id: string; url: string; sourceUrl: string | null } | null>(null);
  /** Which row is being renamed, and the draft text. */
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  /**
   * A library row's failure, scoped to the row that caused it.
   *
   * ⚠️ WHY THIS EXISTS. Every row action used to call `setError`, which paints
   * the banner under the page header — ~1,600 lines of JSX above the button
   * that was clicked. The operator saw "Working…" appear, then nothing, and the
   * app looked broken while it was in fact reporting the refusal off-screen.
   * That is how the 2026-09-19 இன்னுமொரு கருவறையில் short was lost: the message
   * was never read, so the real cause was never known.
   *
   * Keyed by job id so one row's failure can never be attributed to another.
   */
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  /** Report a row failure where the row can see it. Mirrors the shared catch. */
  const failRow = useCallback((id: string, err: unknown) => {
    setRowError({ id, message: err instanceof Error ? err.message : String(err) });
  }, []);

  const mounted = useRef(true);
  const abort = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Elapsed counter while the worker runs — silence with no clock reads as stuck.
  useEffect(() => {
    if (stage !== 'mastering') return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [stage]);

  /** Attach to a job (new or recovered) and follow it to a terminal state. */
  const watch = useCallback(async (id: string, stored: StoredJob) => {
    setJobId(id);
    setPaused(null);
    setStage('mastering');
    setElapsed(0);
    setAnnounce('Mastering started.');
    abort.current = new AbortController();
    const signal = abort.current.signal;
    try {
      const done = await pollJob<MasterJob>({
        // The status route returns the job flattened; pollJob's contract is
        // {status, result, error}. Reshape rather than duplicating its loop.
        fetchStatus: async (s) => {
          const r = await adminFetch(`/api/admin/music-lab/master/${id}`, { signal: s });
          if (!r.ok) return r;
          const j = (await r.json()) as MasterJob;
          return asResponse({ status: j.status, result: j, error: j.error });
        },
        signal,
        isMounted: () => mounted.current,
        intervalMs: 3000,
        timeoutMs: 16 * 60 * 1000, // the worker's own ceiling is 15 min
        timeoutMessage: `Still running after 16 minutes. The job keeps going server-side — reload this page to re-attach to it.`,
      });
      if (!mounted.current) return;
      if (!done) {
        // Superseded/aborted while still mounted: never strand the UI in
        // "mastering" with no control — fall back to a state with a way out.
        setStage(sourceKey || stored.sourceKey ? 'ready' : 'idle');
        return;
      }
      setJob(done);
      setStage('done');
      writeStored(null);
      setAnnounce(
        typeof done.afterLufs === 'number'
          ? `Mastering complete. Landed at ${done.afterLufs.toFixed(1)} LUFS.`
          : 'Mastering complete.'
      );
    } catch (err) {
      if (!mounted.current) return;
      // An abort landing mid-poll is a cancel, not a failed master — the job is
      // still running and still recoverable. stopWatching has already set the
      // stage and said so; don't overwrite that with a red alert.
      if (isAbort(err)) return;
      setError(err instanceof Error ? err.message : String(err));
      setStage('ready');
      setAnnounce('Mastering failed.');
    }
  }, [sourceKey]);

  // Re-attach to a job left running by a previous mount (navigation, reload,
  // session bounce). Without this the worker still writes the master to S3 and
  // the UI has no way to reach it.
  useEffect(() => {
    mounted.current = true;
    const stored = readStored();
    if (stored) {
      setSource({ name: stored.name, size: stored.size });
      setSourceKey(stored.sourceKey);
      setTargetId(stored.targetId ?? (String(stored.target) as TargetId));
      if (stored.partBKey) {
        setPartB({ key: stored.partBKey, name: stored.partBName ?? 'Part B' });
        if (typeof stored.overlapSec === 'number') setOverlapSec(stored.overlapSec);
        if (typeof stored.partBStartSec === 'number') setPartBStartSec(stored.partBStartSec);
      }
      void watch(stored.jobId, stored);
    }
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
    // Mount-only: re-running this on `watch` identity change would re-attach.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Lazy fetch of the reference bank (Phase 1C UI). Fires the first time the
   * admin focuses / clicks the reference-picker dropdown — NOT on mount.
   * A mount-time fetch adds an adminFetch call before any user action, which
   * breaks the many pre-existing tests that assert exact call counts
   * ("reject a non-WAV WITHOUT calling the API") and positional URLs ("first
   * call is /upload"). Fire-on-focus keeps those assertions correct AND
   * avoids a wasted request when the admin never uses reference-matching.
   */
  const referencesRequested = useRef(false);
  const fetchReferencesIfNeeded = useCallback(() => {
    if (referencesRequested.current) return;
    if (!FEATURES.ADMIN.MASTERING_REFERENCE_MATCHING) return;
    referencesRequested.current = true;
    setReferencesLoading(true);
    setReferencesError(null);
    // Promise.resolve wrapper so a test-fixture adminFetch that returns
    // undefined (unmocked route) becomes a resolved undefined instead of
    // throwing 'Cannot read properties of undefined (reading then)'.
    // Production adminFetch always returns a Promise.
    Promise.resolve(adminFetch('/api/admin/mastering/references'))
      .then(async (res) => {
        if (!res) return;
        const body = await res.json();
        if (!res.ok || !body.success) {
          setReferencesError(body.error || `Could not load references (HTTP ${res.status}).`);
          setReferences([]);
        } else {
          setReferences(body.references ?? []);
        }
      })
      .catch((err: unknown) => {
        setReferencesError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setReferencesLoading(false);
      });
  }, []);

  /**
   * Forget the YouTube upload draft.
   *
   * Called wherever the SONG changes — start over, a new source file, a master
   * re-opened from the library. Carrying a title, a lyric description or a
   * preflight report from one song into another is the same class of mistake as
   * carrying the cover, except it publishes the wrong words rather than the
   * wrong picture.
   */
  const clearUploadDraft = useCallback(() => {
    setUploadTitle(null);
    setUploadBody('');
    setUploadTagsText('');
    setUploadHashtagsText('');
    setUploadPlaylistIds(UPLOAD_PLAYLISTS.map((p) => p.id));
    setFramePreviewUrl(null);
    setReleaseCheck(null);
    setReleaseCheckError(null);
  }, []);

  const reset = useCallback(() => {
    abort.current?.abort();
    writeStored(null);
    setPaused(null);
    setStage('idle');
    setSource(null);
    setSourceKey(null);
    setSent({ loaded: 0, total: 0 });
    setJob(null);
    setJobId(null);
    setError(null);
    setAnnounce('');
    setSavedAt(null);
    setPublished(null);
    setPartB(null);
    setPartBUploading(false);
    setPartBStartSec(0);
    setSeedEdit(null);
    setSeedDurationSec(0);
    setSeedJoin(null);
    // The song's IDENTITY and its artwork. `masterName` is not cosmetic: it
    // becomes the saved title, which becomes the archive key AND the public
    // filename on the site. Carrying it into a different song publishes that
    // song under this one's name.
    setMasterName('');
    setCover(null);
    setAnalysis(null);
    clearUploadDraft();
    if (fileInput.current) fileInput.current.value = '';
  }, [clearUploadDraft]);

  /**
   * Stop following, but leave the job running and recoverable. The stored job is
   * deliberately NOT cleared — it is what `resumeWatching` (and a reload)
   * re-attach to.
   */
  const stopWatching = useCallback(() => {
    abort.current?.abort();
    setPaused(readStored());
    setStage('ready');
    setAnnounce('Stopped watching. The master is still being produced.');
  }, []);

  /**
   * Re-attach to the job we stopped watching. Before this the only way back to a
   * running master was a full page reload — the copy even said so — which is a
   * poor answer when the job is one poll away from done.
   */
  const resumeWatching = useCallback(() => {
    const stored = paused ?? readStored();
    if (!stored) return;
    setPaused(null);
    setError(null);
    void watch(stored.jobId, stored);
  }, [paused, watch]);

  /**
   * Measure the source before anything is decided about it.
   *
   * Read-only and advisory: it proposes a trim and reports whether the tail is
   * already fading, which is the one finding that changes what you DO (a
   * baked-in fade is a re-roll, not something to fix in post). Nothing is
   * applied automatically — a wrong automatic trim would be worse than none.
   */
  const runAnalysis = useCallback(async (sourceKeyToRead: string, partBKeyToRead: string | null) => {
    setAnalysing(true);
    setAnalysis(null);
    try {
      const res = await adminFetch('/api/admin/mastering/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ s3Key: sourceKeyToRead, ...(partBKeyToRead ? { partBKey: partBKeyToRead } : {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) return; // advisory — never block mastering
      const deadline = Date.now() + 5 * 60 * 1000;
      for (;;) {
        const r = await adminFetch(`/api/admin/mastering/analyse/${body.analysisId}`);
        const j = await r.json().catch(() => ({}));
        if (!mounted.current) return;
        if (j?.analysis?.status === 'done' && j.verdicts) {
          setAnalysis({
            leadingSilenceSec: j.analysis.leadingSilenceSec,
            trailingSilenceSec: j.analysis.trailingSilenceSec,
            durationSec: j.analysis.durationSec,
            ...j.verdicts,
          });
          return;
        }
        if (j?.analysis?.status === 'error' || Date.now() > deadline) return;
        await new Promise((r2) => setTimeout(r2, 3000));
      }
    } catch {
      // An analysis that fails must never stop a master — it is advice.
    } finally {
      if (mounted.current) setAnalysing(false);
    }
  }, []);

  /**
   * Presign + PUT one WAV into the mastering workspace, returning its key.
   * Shared by Part A and Part B so a second source cannot drift onto a
   * different upload path (or skip the WAV guard).
   */

  /**
   * Part B of a two-part assembly. Same WAV-only rule as Part A: an MP3 here is
   * worse than usual, because encoder padding adds silent frames at the head and
   * tail that misalign the overlap.
   */
  const onPickPartB = useCallback(async (file: File) => {
    setError(null);
    const extOk = /\.wave?$/i.test(file.name);
    const typeOk = (ACCEPTED_UPLOAD_TYPES as readonly string[]).includes(file.type);
    if (!typeOk && !extOk) {
      setError('Part B must be a WAV. MP3 padding adds silent frames that misalign the crossfade.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`Part B is ${MB(file.size)}, over the ${MB(MAX_UPLOAD_BYTES)} limit.`);
      return;
    }
    setPartBUploading(true);
    setPartBSent({ loaded: 0, total: file.size });
    const controller = new AbortController();
    try {
      const key = await uploadToWorkspace(
        file,
        (loaded, total) => mounted.current && setPartBSent({ loaded, total }),
        controller.signal,
      );
      if (!mounted.current) return;
      setPartB({ key, name: file.name });
      // A new Part B must not inherit the previous seam's edit.
      setSeedJoin(null);
      setAnnounce('Part B uploaded.');
      // Re-measure with both parts so the level comparison becomes available.
      if (sourceKey) void runAnalysis(sourceKey, key);
    } catch (err) {
      if (!mounted.current) return;
      if (!isAbort(err)) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setPartBUploading(false);
    }
  }, [sourceKey, runAnalysis]);

  const onPick = useCallback(async (picked: File | null) => {
    if (!picked) return;
    setError(null);
    setJob(null);
    // Allow re-picking the same path after a rejection (no change event otherwise).
    if (fileInput.current) fileInput.current.value = '';

    const extOk = /\.wave?$/i.test(picked.name);
    const typeOk = (ACCEPTED_UPLOAD_TYPES as readonly string[]).includes(picked.type);
    if (!typeOk && !extOk) {
      setError('That is not a WAV. Export the lossless WAV from SUNO — mastering an MP3 only re-levels a file that has already lost detail.');
      return;
    }
    if (picked.size > MAX_UPLOAD_BYTES) {
      setError(`That file is ${MB(picked.size)}, over the ${MB(MAX_UPLOAD_BYTES)} limit.`);
      return;
    }

    setSource({ name: picked.name, size: picked.size });
    setPickedFile(picked);
    setEdit(null);
    // …and the join. `edit` was already cleared here because a trim placed on
    // one song is meaningless on the next; a Part B is worse, because it would
    // silently crossfade an unrelated section onto the new source and master
    // cleanly while doing it.
    setPartB(null);
    setPartBStartSec(0);
    setSeedEdit(null);
    setSeedDurationSec(0);
    setSeedJoin(null);
    // Same reasoning as reset(): a different file is a different song, so the
    // title, the cover and the previous file's measurements all go with it.
    setMasterName('');
    setCover(null);
    setAnalysis(null);
    clearUploadDraft();
    setRecipeNonce((n) => n + 1);
    setStage('uploading');
    setSent({ loaded: 0, total: picked.size });
    setAnnounce(`Uploading ${picked.name}.`);
    abort.current = new AbortController();

    try {
      const res = await adminFetch('/api/admin/mastering/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: picked.name,
          // Trust our own extension check over a browser MIME guess: some
          // systems report audio/vnd.wave etc., which the API allow-list rejects.
          contentType: typeOk ? picked.type : 'audio/wav',
          size: picked.size,
        }),
        signal: abort.current.signal,
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error || `Could not start the upload (HTTP ${res.status}).`);

      await putToS3(
        body.uploadUrl, body.fields, picked,
        (loaded, total) => mounted.current && setSent({ loaded, total }),
        abort.current.signal
      );
      if (!mounted.current) return;
      setSourceKey(body.key);
      setStage('ready');
      setAnnounce('Upload complete. Ready to master.');
      void runAnalysis(body.key, null);
    } catch (err) {
      if (!mounted.current) return;
      // "Cancel upload" already reset the UI to idle; surfacing its own abort as
      // an error banner told the admin something had gone wrong when they had
      // simply changed their mind.
      if (isAbort(err)) {
        setAnnounce('Upload cancelled.');
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
      setStage('idle');
      setSource(null);
    }
  }, [runAnalysis, clearUploadDraft]);

  const startMastering = useCallback(async () => {
    if (!sourceKey || !source) return;
    setError(null);
    setJob(null);
    // Per-job state, not per-session. `savedAt` was set on the first save and
    // never cleared, so mastering a SECOND file in the same visit met a
    // disabled "Saved to library" button belonging to the previous job — the
    // new master could not be saved at all without a page reload.
    setSavedAt(null);
    setPublished(null);
    try {
      const res = await adminFetch('/api/admin/music-lab/master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // `edit` is omitted entirely when null, so a plain run sends the exact
        // body it always did.
        // `edit` and `join` are omitted entirely when unused, so a plain run
        // sends the exact body it always did.
        body: JSON.stringify({
          s3Key: sourceKey,
          target,
          // Spread ONLY for a bed, so a loudness enqueue sends the exact body
          // it always did — byte-identical, which is what makes "nothing
          // changed for ordinary masters" checkable rather than asserted.
          ...(isBed ? { normalizationMode: 'peak' as const } : {}),
          ...(edit ? { edit } : {}),
          ...(partB
            ? {
                join: buildJoinPayload({
                  partBKey: partB.key,
                  overlapSec,
                  partBStartSec,
                  // Only the seam this Part B actually came from.
                  seed: seedJoin?.partBKey === partB.key ? seedJoin : null,
                }),
              }
            : {}),
          // Reference-matched mastering (Phase 1C UI). Spread only when a
          // reference is selected; loudnorm-only enqueues stay byte-identical
          // to before. The route rejects a referenceKey without a valid
          // matchingMethod, so both fields go out together.
          // ...and never for a bed: reference matching shapes a second output
          // by another master's loudness and tone, which is the opposite of
          // leaving a bed alone. The route refuses the combination with a 400,
          // so sending it would only produce an error the operator cannot act
          // on. The picker is hidden in that mode for the same reason.
          ...(FEATURES.ADMIN.MASTERING_REFERENCE_MATCHING && selectedReferenceKey && !isBed
            ? {
                referenceKey: selectedReferenceKey,
                referenceId: selectedReferenceKey
                  .replace(/^audio\/references\//, '')
                  .replace(/\.wav$/i, ''),
                matchingMethod,
              }
            : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error || `Could not start mastering (HTTP ${res.status}).`);
      const stored: StoredJob = {
        jobId: body.jobId, sourceKey, name: source.name, size: source.size, target, targetId,
        ...(partB ? { partBKey: partB.key, partBName: partB.name, overlapSec, partBStartSec } : {}),
      };
      writeStored(stored);
      await watch(body.jobId, stored);
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : String(err));
      setStage('ready');
    }
  }, [sourceKey, source, target, targetId, isBed, edit, partB, overlapSec, partBStartSec, seedJoin, watch, selectedReferenceKey, matchingMethod]);

  /**
   * Presign + open one workspace WAV. Shared by the result panel and the saved
   * library so both get the same friendly filename and the same auth — the
   * route replies with JSON, not a redirect, so a plain <a href> would render
   * the JSON instead of downloading, and would carry no bearer token.
   */
  const downloadKey = useCallback(async (
    key: string,
    title: string,
    targetLufs: number,
    /**
     * Overrides the "(Master -14 LUFS)" suffix. A short is not a master, and
     * labelling it one is how the wrong file gets uploaded as the full song.
     */
    label?: string,
  ) => {
    setError(null);
    try {
      // Present a friendly filename ("<title> (Master -14 LUFS).wav") when the
      // admin has named the master; the server sanitises it. Storage key is
      // untouched. No name ⇒ the route falls back to a de-noised default.
      const suffix = label ?? `Master ${targetLufs} LUFS`;
      const nameParam = title ? `&name=${encodeURIComponent(`${title} (${suffix})`)}` : '';
      const res = await adminFetch(
        `/api/admin/mastering/download?key=${encodeURIComponent(key)}${nameParam}`
      );
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not create the download link.');
      // A new tab, not window.location — the response is Content-Disposition:
      // attachment, but a failed/expired presign would otherwise replace this
      // page with an S3 error document and destroy the result panel.
      window.open(body.url, '_blank', 'noopener');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const download = useCallback(() => {
    if (!job?.masterKey) return;
    void downloadKey(job.masterKey, masterName.trim(), job.target, isPeakMaster(job) ? bedLabel : undefined);
  }, [job, masterName, downloadKey]);

  /** The web MP3 — what the site serves (or, for a bed, what the buyer receives). */
  const downloadMp3 = useCallback(() => {
    if (!job?.mp3Key) return;
    void downloadKey(job.mp3Key, masterName.trim(), job.target, isPeakMaster(job) ? bedLabel : undefined);
  }, [job, masterName, downloadKey]);

  /**
   * Is the delivered MP3 peak-safe? This is the only check anywhere on the file
   * listeners actually receive — the catalogue sweep found two served MP3s over
   * the ceiling that no earlier step would have caught.
   */
  const mp3Verdict = job?.mp3Key
    ? mp3PeakVerdict({ mp3Tp: job.mp3Tp, wavTp: job.afterTp })
    : null;

  /** Save the loudness summary as a text file that travels with the WAV. */
  /**
   * Keep this master. Unsaved jobs expire after 24h — the WAV survives in S3 but
   * the record explaining it does not, leaving an orphaned machine-named file.
   */
  /**
   * Load a page of the library.
   *
   * `append` distinguishes "open the library" from "show me more": the first
   * replaces the list, the second grows it. The cursor is opaque and comes
   * straight back from the API, so paging never re-reads what is already shown.
   */
  /**
   * The rows actually rendered: this page's masters, searched and sorted.
   * Both operations are LOCAL to what has been loaded — see `sortMasters`.
   */
  const visibleMasters = useMemo(
    () => sortMasters(filterMasters(library ?? [], librarySearch), librarySort),
    [library, librarySearch, librarySort]
  );

  /**
   * The masters either side of the one playing, in the order shown on screen.
   *
   * Deliberately walks `visibleMasters` rather than the raw library: if he has
   * searched for "பூபாளம்", Next should move to the next பூபாளம் master, not to
   * whatever happens to sit beside it in the unfiltered list.
   */
  const neighbours = useMemo(() => {
    if (!playing) return { prev: null as MasterJob | null, next: null as MasterJob | null };
    const i = visibleMasters.findIndex((m) => m.id === playing.id);
    return {
      prev: i > 0 ? visibleMasters[i - 1] : null,
      next: i >= 0 && i < visibleMasters.length - 1 ? visibleMasters[i + 1] : null,
    };
  }, [playing, visibleMasters]);


  const loadLibrary = useCallback(async (cursor?: string) => {
    setLibraryLoading(true);
    try {
      const qs = new URLSearchParams({ limit: String(LIBRARY_PAGE_SIZE) });
      if (cursor) qs.set('cursor', cursor);
      const res = await adminFetch(`/api/admin/music-lab/masters?${qs}`);
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.success) {
        const page = body.masters as MasterJob[];
        setLibrary((prev) => (cursor && prev ? [...prev, ...page] : page));
        setLibraryCursor((body.nextCursor as string | null) ?? null);
      }
    } catch {
      // A library that fails to load must never block mastering — the list is
      // supplementary, the job in front of the user is the point.
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  const saveToLibrary = useCallback(async () => {
    if (!jobId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/music-lab/master/${jobId}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: masterName.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not save this master.');
      setSavedAt(new Date().toISOString());
      setAnnounce('Master saved to the library.');
      setLibraryOpen(true);
      void loadLibrary();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [jobId, masterName, loadLibrary]);


  /**
   * Stage the web MP3 at the site's own audio path.
   *
   * The destination is canonical per song and CDN-served, so an occupied key
   * comes back as a 409 conflict rather than being replaced — the admin is the
   * only one who knows whether the file already there is the same song. Only an
   * explicit confirm retries with `overwrite`.
   */
  const publishToSite = useCallback(async (overwrite = false) => {
    if (!jobId) return;
    setPublishing(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/music-lab/master/${jobId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(overwrite ? { overwrite: true } : {}),
      });
      const body = await res.json().catch(() => ({}));

      if (res.status === 409 && body.conflict) {
        // Ask before replacing what the site currently serves. The bucket is
        // versioned, so a confirmed overwrite is recoverable — but it is still
        // a change to a live song, and must be chosen rather than defaulted.
        if (window.confirm(`${body.error}\n\nReplace it?`)) {
          await publishToSite(true);
        }
        return;
      }
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not publish this master.');

      setPublished({ key: body.key as string, replaced: Boolean(body.replaced) });
      setAnnounce(body.replaced ? 'Web MP3 replaced on the site path.' : 'Web MP3 staged on the site path.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPublishing(false);
    }
  }, [jobId]);

  /** Cover art for the render. Same workspace, same guards, image allow-list. */
  const onPickCover = useCallback(async (file: File) => {
    setError(null);
    setCoverUploading(true);
    const controller = new AbortController();
    try {
      const key = await uploadToWorkspace(file, () => {}, controller.signal, 'cover');
      if (!mounted.current) return;
      setCover({ key, name: file.name });
      setAnnounce('Cover uploaded.');
    } catch (err) {
      if (!mounted.current) return;
      if (!isAbort(err)) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setCoverUploading(false);
    }
  }, []);

  /**
   * Render the upload-ready MP4 and wait for it.
   *
   * The encode runs in the worker, so this polls the same status route the
   * mastering flow does until `videoRenderedAt` (or `videoError`) CHANGES.
   * Bounded: a render that has not landed in ten minutes is reported rather
   * than spun on forever, and the job keeps the result either way.
   */
  /**
   * POST the render and poll until the MP4 lands. Shared by the inline panel
   * and the library row, so both wait the same way and time out the same way.
   * Resolves with the finished job, or null if the component unmounted.
   *
   * `videoKey` is NOT a safe "done" signal: the render route never clears the
   * job's existing `videoKey`/`videoError` on enqueue, it just re-invokes the
   * worker to overwrite the same S3 key. On a RE-render, attempt 0 would see
   * the *previous* render's leftovers and declare success (or failure)
   * instantly, before the new encode has done anything. `videoRenderedAt` is
   * the one field the worker only ever writes on completion, so the caller
   * captures its value (and `videoError`'s) BEFORE the POST and this polls
   * until either one actually CHANGES. A first render has
   * `videoRenderedAt === null`, so "changed from null to a timestamp" covers
   * that case with the same logic — no special-casing needed.
   */
  const startRender = useCallback(
    async (
      targetId: string,
      coverKey: string,
      height: number,
      priorVideoRenderedAt: string | null,
      priorVideoError: string | null
    ): Promise<MasterJob | null> => {
      const res = await adminFetch(`/api/admin/music-lab/master/${targetId}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coverKey, height }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not start the render.');
      setAnnounce('Rendering the video.');

      // Check IMMEDIATELY, then settle into an interval. A short render can be
      // finished before the first tick would have elapsed, and waiting anyway
      // would show a spinner for a file that already exists.
      const deadline = Date.now() + 10 * 60 * 1000;
      for (let attempt = 0; ; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 4000));
        if (!mounted.current) return null;
        const s = await adminFetch(`/api/admin/music-lab/master/${targetId}`);
        const fresh = (await s.json()) as MasterJob;
        if (fresh.videoRenderedAt && fresh.videoRenderedAt !== priorVideoRenderedAt) {
          setAnnounce('Video ready.');
          return fresh;
        }
        // A stale error from a previous attempt can also be sitting on the job
        // at attempt 0 (the route does not clear `videoError` either) — only a
        // DIFFERENT error belongs to this render.
        if (fresh.videoError && fresh.videoError !== priorVideoError) throw new Error(fresh.videoError);
        if (Date.now() > deadline) {
          throw new Error('The render is taking longer than expected — reload to check on it.');
        }
      }
    },
    []
  );

  const renderVideo = useCallback(async () => {
    if (!jobId || !cover) return;
    setRendering(true);
    setError(null);
    try {
      // Capture the job's CURRENT videoRenderedAt/videoError before the POST,
      // so a re-render can tell its own completion apart from the leftovers
      // of a previous one.
      const fresh = await startRender(
        jobId,
        cover.key,
        videoHeight,
        job?.videoRenderedAt ?? null,
        job?.videoError ?? null
      );
      if (fresh) setJob(fresh);
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setRendering(false);
    }
  }, [jobId, cover, videoHeight, job, startRender]);

  /**
   * POST the short and poll until the clip lands.
   *
   * Same completion rule as `startRender`, for the same reason: the route never
   * clears the job's existing `shortKey`/`shortError` on enqueue, so on a SECOND
   * short attempt 0 would read the previous clip's leftovers and declare the new
   * one finished before the encode had started. `shortRenderedAt` is the field
   * the worker only writes on completion, so the caller captures it (and
   * `shortError`) BEFORE the POST and this polls until one of them CHANGES.
   *
   * The deadline is shorter than the video's: a 30s clip from a composed still
   * is under a minute of work, so three minutes without a result means something
   * is wrong rather than slow.
   */
  const startShort = useCallback(
    async (
      targetId: string,
      coverKey: string,
      priorShortRenderedAt: string | null,
      priorShortError: string | null
    ): Promise<MasterJob | null> => {
      const res = await adminFetch(`/api/admin/music-lab/master/${targetId}/short`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // A window is sent only when one was chosen, and only ever the one
        // belonging to THIS master. Sending zeroes would read as "start at
        // 0:00 for 0s" rather than "you decide".
        body: JSON.stringify({ coverKey, ...(windowFor(targetId) ?? {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not start the short.');
      setAnnounce('Cutting the short.');

      const deadline = Date.now() + 3 * 60 * 1000;
      for (let attempt = 0; ; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 4000));
        if (!mounted.current) return null;
        const s = await adminFetch(`/api/admin/music-lab/master/${targetId}`);
        const fresh = (await s.json()) as MasterJob;
        if (fresh.shortRenderedAt && fresh.shortRenderedAt !== priorShortRenderedAt) {
          setAnnounce('Short ready.');
          return fresh;
        }
        if (fresh.shortError && fresh.shortError !== priorShortError) throw new Error(fresh.shortError);
        if (Date.now() > deadline) {
          throw new Error('The short is taking longer than expected — reload to check on it.');
        }
      }
    },
    [windowFor]
  );

  const makeShort = useCallback(async () => {
    if (!jobId || !cover) return;
    setShorting(true);
    setError(null);
    try {
      const fresh = await startShort(jobId, cover.key, job?.shortRenderedAt ?? null, job?.shortError ?? null);
      if (fresh) setJob(fresh);
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setShorting(false);
    }
  }, [jobId, cover, job, startShort]);

  /**
   * Render ~20 seconds around the crossfade and play it.
   *
   * Enqueue, then poll the preview key. The key is a fingerprint of the exact
   * settings, so the route answers `ready` immediately for a seam already
   * rendered — nudging a value back to one already heard costs one request.
   *
   * The previous preview is cleared FIRST. Leaving it on screen while the new
   * one renders is the way a preview lies: the operator hears the old settings,
   * decides they are fine, and masters something else.
   */
  const previewSeam = useCallback(async () => {
    if (!partB || !sourceKey) return;
    setSeamBusy(true);
    setSeamPreview(null);
    setError(null);
    try {
      const join = buildJoinPayload({
        partBKey: partB.key,
        overlapSec,
        partBStartSec,
        seed: seedJoin?.partBKey === partB.key ? seedJoin : null,
      });
      const res = await adminFetch('/api/admin/mastering/seam-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partAKey: sourceKey, editA: edit, join }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not render the seam.');
      const previewKey = body.previewKey as string;

      // Short renders, short deadline: this is ~20s of audio from two files
      // that are already in the workspace. A minute without a result is a
      // failure, not slowness.
      const deadline = Date.now() + 60 * 1000;
      for (let attempt = 0; ; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 2000));
        if (!mounted.current) return;
        const poll = await adminFetch(
          `/api/admin/mastering/seam-preview?key=${encodeURIComponent(previewKey)}`
        );
        const state = await poll.json().catch(() => ({}));
        if (state?.status === 'ready' && state.url) {
          setSeamPreview({
            url: state.url as string,
            note: (state.levelsNote as string) ?? '',
            mismatched: Boolean(state.levels?.mismatched),
            // Absent on previews rendered before the analysis existed, and on
            // any whose analysis failed — the clip still plays either way.
            comparison: (state.analysis as PartComparison | null) ?? null,
          });
          setAnnounce('The seam is ready, looping.');
          return;
        }
        if (Date.now() > deadline) {
          throw new Error('The seam preview did not arrive — check the crossfade values and try again.');
        }
      }
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setSeamBusy(false);
    }
  }, [partB, sourceKey, overlapSec, partBStartSec, seedJoin, edit]);

  /**
   * The picture the video was built from. `job.coverKey` is what the worker
   * actually encoded (it survives a reload); `cover.key` covers the moment
   * between uploading a cover and the job coming back with it.
   */
  const frameKey = job?.coverKey ?? cover?.key ?? null;
  /**
   * The upload panel exists only once there is a rendered MP4 to upload.
   *
   * ⚠️ GATED ON THE JOB ROW'S OWN `savedAt` FIRST, not on the session-local
   * flag. `savedAt` (the state) is set only by a Save in THIS session and is
   * cleared by `reset`, `onPickFile` and `reopenMaster` — so gating on it
   * alone meant that any remount hid the panel, taking the upload's resume
   * path (`uploadSessionUri`, `UPLOAD_STALE_AFTER_MS`) off screen with it. The
   * persisted value survives, so a job re-attached after a remount reopens the
   * panel on its own. The session flag stays as the fallback for the one case
   * the row cannot cover: the moments right after a Save, which writes
   * `savedAt` server-side but does not re-fetch the job.
   */
  const uploadPanelOpen = Boolean((job?.savedAt ?? savedAt) && job?.videoKey);

  /**
   * Is the row's `queued`/`uploading` status still believable?
   *
   * ⚠️ THE OTHER HALF OF THE REACHABILITY BUG. The Upload button was disabled
   * for `queued`/`uploading` unconditionally, so a worker that died mid-upload
   * left the job pinned at `queued` and the ONLY control that could resume it
   * permanently greyed out — `UPLOAD_STALE_AFTER_MS` and `uploadSessionUri`
   * were unreachable from the browser no matter what the panel's gate said.
   *
   * The same rule the server applies: past the worker's own ceiling plus
   * margin, the status can only be a crash artifact, so the button comes back
   * as Retry. Pressing it re-enqueues, and the worker RESUMES the stored
   * session rather than inserting a second video — the duplicate guard does
   * not depend on this window (see planUpload's doc comment).
   */
  const uploadRunning = job?.uploadStatus === 'queued' || job?.uploadStatus === 'uploading';
  const uploadStale =
    uploadRunning &&
    (() => {
      const age = Date.now() - (job?.updatedAt ? Date.parse(job.updatedAt) : NaN);
      // An unparseable timestamp cannot PROVE staleness, so it reads as still
      // running — the same direction the planner takes on missing evidence.
      return Number.isFinite(age) && age > UPLOAD_STALE_AFTER_MS;
    })();
  /** Genuinely in flight: running, and not old enough to be a crash artifact. */
  const uploadInFlight = uploadRunning && !uploadStale;
  const UPLOAD_STALE_MINUTES = Math.round(UPLOAD_STALE_AFTER_MS / 60000);

  /**
   * `uploadStale` reads the clock during render, and a panel parked on a
   * `queued` row has nothing left re-rendering it — the master's own poll ended
   * at `done`, and the upload poll only runs inside `uploadToYoutube`. Without
   * this nudge Retry would never appear on its own, and the amber note below
   * promises exactly that it will. Same shape as the elapsed counter above, and
   * it runs only while an upload is actually believed to be in flight.
   */
  const [, tickUploadClock] = useState(0);
  useEffect(() => {
    if (!uploadInFlight) return;
    const t = setInterval(() => tickUploadClock((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [uploadInFlight]);

  /**
   * Presign the cover so the operator can SEE it before pressing Upload.
   *
   * Fired only when the upload panel is actually on screen, never on mount:
   * a fetch on the plain done-state path would change the call sequence every
   * other test in this module asserts against, which is the same reason the
   * reference bank loads on focus rather than on mount.
   *
   * Cleared first, so a re-render with a different cover can never show the
   * previous song's artwork while the new URL is still being minted — showing
   * the wrong picture confidently is the exact failure this panel prevents.
   */
  useEffect(() => {
    if (!uploadPanelOpen || !frameKey) return;
    let cancelled = false;
    setFramePreviewUrl(null);
    void (async () => {
      try {
        const res = await adminFetch(
          `/api/admin/mastering/download?key=${encodeURIComponent(frameKey)}&mode=play`
        );
        const body = await res.json().catch(() => ({}));
        if (cancelled || !mounted.current) return;
        if (res.ok && body.success && body.url) setFramePreviewUrl(body.url as string);
      } catch {
        // The preview is evidence, not a gate. A presign that fails leaves the
        // picture unshown and says so; it must never block an upload.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uploadPanelOpen, frameKey]);

  const uploadTags = useMemo(() => parseTagList(uploadTagsText), [uploadTagsText]);
  const uploadHashtags = useMemo(() => parseHashtags(uploadHashtagsText), [uploadHashtagsText]);
  /**
   * THE string that will be uploaded — not a preview of a different string.
   * The operator owns `body` and the hashtags; the credit block, the site link,
   * the commission CTA and the three playlist links are assembled by
   * `buildUploadDescription` and are not theirs to edit. Rendering anything
   * else here would re-open the hand-built-description hole that kept putting a
   * retired credit line on new videos.
   */
  const uploadDescription = useMemo(
    () => buildUploadDescription({ body: uploadBody, hashtags: uploadHashtags }),
    [uploadBody, uploadHashtags]
  );
  /** Untouched title mirrors the master's name; see `uploadTitle`'s null state. */
  const uploadTitleValue = uploadTitle ?? masterName;

  /**
   * Grade the uploaded video against the release checklist, and read back what
   * YouTube actually stored (the same route returns both — one videos.list, no
   * extra quota).
   *
   * Only ever runs against a video that EXISTS on YouTube: the route needs an
   * 11-character id, and grading the form we are about to submit would be
   * grading our own claim. Findings never gate the Upload button — this is a
   * "warn, don't block" panel by design.
   */
  const runReleaseCheck = useCallback(async (videoId: string) => {
    setReleaseChecking(true);
    setReleaseCheckError(null);
    try {
      const res = await adminFetch(`/api/admin/youtube/release-check?videoId=${videoId}`);
      const body = await res.json().catch(() => ({}));
      if (!mounted.current) return;
      if (!res.ok) {
        setReleaseCheckError(body?.error?.message ?? `The release check failed (HTTP ${res.status}).`);
        return;
      }
      setReleaseCheck(body as ReleaseCheckResult);
    } catch (err) {
      if (mounted.current) setReleaseCheckError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setReleaseChecking(false);
    }
  }, []);

  /**
   * Upload the rendered MP4 to YouTube as a PRIVATE draft, then follow it.
   *
   * ⚠️ THE POLL DISCRIMINATES ON A VALUE THAT CHANGES, NOT ONE THAT EXISTS —
   * the same trap the render poll was fixed for. A retry after a failed attempt
   * arrives with `uploadStatus: 'failed'` and the previous `uploadError`
   * ALREADY on the row, so "poll until the status is terminal" would announce
   * the OLD failure instantly, before the worker had done anything. `updatedAt`
   * is stamped by `markUploadQueued`, which the route completes before it
   * returns its 202, so capturing `updatedAt` BEFORE the POST and requiring it
   * to move is a reliable "this attempt, not the last one" test. Success
   * additionally requires a `youtubeVideoId` and a moved `uploadedToYoutubeAt`:
   * the id is the only proof a video exists, and the timestamp tells this
   * upload's id apart from one left by an earlier run.
   */
  const uploadToYoutube = useCallback(async () => {
    if (!jobId || !job) return;
    const title = uploadTitleValue.trim();
    if (!title) return;
    setUploadingToYoutube(true);
    setError(null);
    setReleaseCheck(null);
    setReleaseCheckError(null);
    const priorUpdatedAt = job.updatedAt ?? null;
    const priorUploadedAt = job.uploadedToYoutubeAt ?? null;
    try {
      const res = await adminFetch(`/api/admin/music-lab/master/${jobId}/youtube`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description: uploadDescription,
          tags: uploadTags,
          playlistIds: uploadPlaylistIds,
        }),
      });
      const body = await res.json().catch(() => ({}));
      // A 409 is the planner refusing (already uploaded, an upload in flight,
      // no video, not saved). Its message IS the answer — there is nothing to
      // poll for.
      if (!res.ok || !body.success) throw new Error(body.error || `Could not start the upload (HTTP ${res.status}).`);
      setAnnounce('Uploading to YouTube.');

      // The worker's own ceiling is 900s; allow for a queued invoke on top.
      const deadline = Date.now() + 20 * 60 * 1000;
      for (let attempt = 0; ; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 4000));
        if (!mounted.current) return;
        const s = await adminFetch(`/api/admin/music-lab/master/${jobId}`);
        const fresh = (await s.json()) as MasterJob;
        const moved = fresh.updatedAt !== priorUpdatedAt;
        if (
          moved &&
          fresh.uploadStatus === 'uploaded' &&
          fresh.youtubeVideoId &&
          fresh.uploadedToYoutubeAt !== priorUploadedAt
        ) {
          setJob(fresh);
          setAnnounce('Uploaded to YouTube as a private draft.');
          // Read back what YouTube stored, rather than trusting what we sent.
          void runReleaseCheck(fresh.youtubeVideoId);
          return;
        }
        if (moved && fresh.uploadStatus === 'failed') {
          setJob(fresh);
          throw new Error(fresh.uploadError || 'The upload failed.');
        }
        if (Date.now() > deadline) {
          // Same rule as the panel's amber note: a reload does NOT pick this
          // up, it loses the panel. Stay put; Retry re-enables on staleness.
          throw new Error(
            'The upload is taking longer than expected. It keeps going server-side — stay on this page and use Retry upload once it becomes available.',
          );
        }
      }
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setUploadingToYoutube(false);
    }
  }, [jobId, job, uploadTitleValue, uploadDescription, uploadTags, uploadPlaylistIds, runReleaseCheck]);

  /** Cover for a library row's render. Same upload path as the inline panel. */
  const onPickRowCover = useCallback(
    async (id: string, file: File) => {
      setRowError(null);
      setRowBusy(id);
      const controller = new AbortController();
      try {
        const key = await uploadToWorkspace(file, () => {}, controller.signal, 'cover');
        if (!mounted.current) return;
        setRowRender({ id, cover: { key, name: file.name } });
        setAnnounce('Cover uploaded.');
      } catch (err) {
        if (mounted.current && !isAbort(err)) failRow(id, err);
      } finally {
        if (mounted.current) setRowBusy(null);
      }
    },
    [failRow]
  );

  /**
   * Render from the library. On success the row is patched in place rather than
   * the whole list reloaded — the only thing that changed is this master's
   * videoKey, and a reload would lose the reader's scroll position.
   */
  const renderRowVideo = useCallback(async () => {
    if (!rowRender?.cover) return;
    const { id, cover: rowCover } = rowRender;
    setRowBusy(id);
    setRowError(null);
    try {
      // Same discriminator as the inline panel: capture this row's CURRENT
      // videoRenderedAt/videoError from the loaded library before the POST.
      const row = library?.find((x) => x.id === id);
      const fresh = await startRender(
        id,
        rowCover.key,
        videoHeight,
        row?.videoRenderedAt ?? null,
        row?.videoError ?? null
      );
      if (!fresh) return;
      setLibrary((prev) =>
        prev
          ? prev.map((x) =>
              x.id === id
                ? { ...x, videoKey: fresh.videoKey, videoRenderedAt: fresh.videoRenderedAt, videoError: fresh.videoError }
                : x
            )
          : prev
      );
      setRowRender(null);
    } catch (err) {
      if (mounted.current) failRow(id, err);
    } finally {
      if (mounted.current) setRowBusy(null);
    }
  }, [rowRender, videoHeight, library, startRender, failRow]);

  /**
   * Cut a short from the library, for the same reason renderRowVideo exists:
   * the inline panel is gated on `savedAt`, which only this session's Save
   * sets. Most songs that want a short are the surplus ones — masters finished
   * days ago — so without this the feature would be reachable only in the one
   * session that produced the master.
   */
  const makeRowShort = useCallback(async () => {
    if (!rowRender?.cover) return;
    const { id, cover: rowCover } = rowRender;
    setRowBusy(id);
    setRowError(null);
    try {
      const row = library?.find((x) => x.id === id);
      const fresh = await startShort(id, rowCover.key, row?.shortRenderedAt ?? null, row?.shortError ?? null);
      if (!fresh) return;
      setLibrary((prev) =>
        prev
          ? prev.map((x) =>
              x.id === id
                ? {
                    ...x,
                    shortKey: fresh.shortKey,
                    shortRenderedAt: fresh.shortRenderedAt,
                    shortStartSec: fresh.shortStartSec,
                    shortSeconds: fresh.shortSeconds,
                    shortError: fresh.shortError,
                  }
                : x
            )
          : prev
      );
      setRowRender(null);
    } catch (err) {
      if (mounted.current) failRow(id, err);
    } finally {
      if (mounted.current) setRowBusy(null);
    }
  }, [rowRender, library, startShort, failRow]);

  /**
   * Deliberately NOT loaded on mount: listing scans the table, and most visits
   * to this page are to master a file, not to browse history. Load on first
   * open, and after a save (which is when the list has actually changed).
   */
  /**
   * Audition a saved master in place.
   *
   * The bucket is private, so this mints a presigned URL via the SAME download
   * route the compare player uses — `mode=play` deliberately omits the
   * Content-Disposition filename so the browser streams it instead of
   * downloading. The URL lasts an hour, long enough to seek around a full song.
   */
  const playSaved = useCallback(async (m: MasterJob) => {
    if (!m.masterKey) return;
    if (playing?.id === m.id) {
      // Same row again = stop. Clearing `playing` unmounts MasteringPlayer,
      // whose cleanup pauses the element — this used to call pause() on a ref
      // that was never attached to anything, so it stopped nothing and the
      // master kept playing with its controls gone.
      setPlaying(null);
      return;
    }
    setRowBusy(m.id);
    setRowError(null);
    try {
      const res = await adminFetch(
        `/api/admin/mastering/download?key=${encodeURIComponent(m.masterKey)}&mode=play`
      );
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not open that master.');
      // The unmastered take, for A/B. Optional: an older job may not have a
      // reachable source, and a missing comparison must not block playback.
      let sourceUrl: string | null = null;
      if (m.s3Key) {
        try {
          const sr = await adminFetch(
            `/api/admin/mastering/download?key=${encodeURIComponent(m.s3Key)}&mode=play`
          );
          const sb = await sr.json();
          if (sr.ok && sb.success) sourceUrl = sb.url as string;
        } catch {
          /* A/B simply stays unavailable. */
        }
      }
      setPlaying({ id: m.id, url: body.url as string, sourceUrl });
    } catch (err) {
      failRow(m.id, err);
    } finally {
      setRowBusy(null);
    }
  }, [playing, failRow]);

  /**
   * Commit a rename. The server sanitises the title (it also drives the
   * download filename) and returns the cleaned value, so the row is updated
   * from the RESPONSE rather than from what was typed — otherwise the list
   * would show a name the file will never have.
   */
  const commitRename = useCallback(async () => {
    if (!renaming) return;
    const { id, value } = renaming;
    const next = value.trim();
    if (!next) { setRenaming(null); return; }
    // Enter commits, and the input then unmounts — which can also fire onBlur
    // with the pre-commit closure still holding `renaming`. Without this the
    // same rename is PATCHed twice.
    if (rowBusy === id) return;
    // Closing an editor without changing anything must not cost a write.
    if (next === (library?.find((x) => x.id === id)?.title ?? '')) {
      setRenaming(null);
      return;
    }
    setRowBusy(id);
    setRowError(null);
    try {
      const res = await adminFetch(`/api/admin/music-lab/master/${id}/rename`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: next }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not rename that master.');
      setLibrary((prev) =>
        prev ? prev.map((x) => (x.id === id ? { ...x, title: body.title as string } : x)) : prev
      );
      setRenaming(null);
    } catch (err) {
      failRow(id, err);
    } finally {
      setRowBusy(null);
    }
  }, [renaming, rowBusy, library, failRow]);

  /**
   * Re-open a saved master for another pass.
   *
   * The point of the module's ordering is that an edit is a RECIPE over an
   * untouched source, so a saved job already carries everything needed to run
   * again: the source key, the trim, the seam. Before this, coming back the next
   * day meant re-uploading the WAV to change a fade by half a second.
   *
   * This deliberately does NOT re-run anything. It restores the recipe and
   * hands control back at the "ready" stage, so the admin adjusts and presses
   * Master — the same path a fresh upload takes, and the same validation.
   */
  const reopenMaster = useCallback((m: MasterJob) => {
    if (!m.s3Key) return;
    abort.current?.abort();
    setError(null);
    setJob(null);
    setJobId(null);
    // A re-opened master is a NEW job: it has not been saved or published, and
    // showing yesterday's state against it would offer to publish a file this
    // run has not produced.
    setSavedAt(null);
    setPublished(null);
    setCover(null);
    clearUploadDraft();

    setSourceKey(m.s3Key);
    // Name only — the File itself cannot survive, so the trim panel falls back
    // to numeric entry, which is exactly what it does after any remount.
    setSource({ name: downloadFilename(m.s3Key), size: 0 });
    setPickedFile(null);
    setTargetId(targetIdOf(m));
    setMasterName(m.title ?? '');
    setEdit(m.edit);
    setSeedEdit(m.edit);
    setSeedDurationSec(m.source?.durationSec ?? 0);

    if (m.join) {
      setPartB({ key: m.join.partBKey, name: downloadFilename(m.join.partBKey) });
      setOverlapSec(m.join.overlapSec);
      setPartBStartSec(m.join.editB?.trimStartSec ?? 0);
      setSeedJoin(m.join);
    } else {
      setPartB(null);
      setPartBStartSec(0);
      setSeedJoin(null);
    }
    // A stopped-watch affordance from a previous job would otherwise sit over
    // this one, offering to resume something unrelated.
    setPaused(null);

    setRecipeNonce((n) => n + 1);
    setStage('ready');
    setLibraryOpen(false);
    setAnnounce(`Re-opened ${m.title ?? 'master'}. Adjust and master again.`);
  }, [clearUploadDraft]);

  const toggleLibrary = useCallback(() => {
    setLibraryOpen((open) => {
      if (!open && library === null) void loadLibrary();
      return !open;
    });
  }, [library, loadLibrary]);


  const downloadReport = useCallback(() => {
    if (!job?.masterKey) return;
    const blob = new Blob([buildMasterReport(job, masterName)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = reportFilename(masterName);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [job, masterName]);

  /**
   * Selecting a different target after a run re-arms rather than dead-ending.
   *
   * Compared by ID, not by LUFS. A karaoke bed and a -14 master share a target
   * number, so the old comparison would have judged them the same entry and
   * left a finished bed's result panel on screen — verdict, downloads and all —
   * while the Studio was armed to produce a streaming master.
   */
  const pickTarget = useCallback((id: TargetId) => {
    setTargetId(id);
    setStage((s) => (s === 'done' ? 'ready' : s));
    setJob((j) => (j && targetIdOf(j) !== id ? null : j));
  }, []);

  // Verdict. Tolerance is the repo's 1 LU (loudness-targets), not a hair-fine
  // 0.1 — two-pass loudnorm lands within a few tenths and a good master must
  // not be flagged. `afterLufs` can legitimately be null (the worker's
  // measurement pass failed on a master that is otherwise fine), which is a
  // third state, not a failure.
  const verdict: 'on-target' | 'off-target' | 'unmeasured' =
    typeof job?.afterLufs !== 'number'
      ? 'unmeasured'
      : statusFor(job.afterLufs - job.target) === 'ok'
        ? 'on-target'
        : 'off-target';
  /**
   * The FINISHED job's mode, which is not always the armed one: the operator
   * can switch the radio while a result is on screen. Everything the result
   * panel says has to follow the job, not the selection.
   */
  const isBedJob = job ? isPeakMaster(job) : false;
  const readiness = job ? streamingReadiness(job) : { ok: false, headline: '', facts: '', checks: [] };
  const movedLu =
    typeof job?.beforeLufs === 'number' && typeof job?.afterLufs === 'number'
      ? Math.abs(job.afterLufs - job.beforeLufs)
      : null;

  const pct = sent.total ? Math.round((sent.loaded / sent.total) * 100) : 0;
  const busy = stage === 'uploading' || stage === 'mastering';

  /**
   * A release check belongs to ONE video, and is shown only against that video.
   *
   * `job` can be replaced without the panel unmounting in between (mastering the
   * same source to the second target clears and re-creates it), and a report
   * graded against yesterday's upload rendered under today's would be evidence
   * about the wrong video — which is precisely the confusion this panel exists
   * to remove. Matching on the id makes that impossible rather than unlikely.
   */
  const videoCheck =
    releaseCheck && job?.youtubeVideoId && releaseCheck.videoId === job.youtubeVideoId
      ? releaseCheck
      : null;
  // Findings, split by the SHARED helper /admin/release uses — one definition of
  // what each severity means, so the two screens cannot drift apart. A
  // `not-checked` finding is kept out of both other groups: it is not a problem
  // to fix and not an opinion the rule reached — it is the rule saying it never
  // ran, and it must never read as either.
  const {
    actionable: checkActionable,
    notes: checkNotes,
    notChecked: checkNotChecked,
  } = groupFindings(videoCheck?.findings);
  const stored = videoCheck?.stored;
  /**
   * YouTube reports `duration: P0D` and `definition: sd` on a perfectly good
   * upload until processing finishes, so neither is evidence of anything yet.
   * Say that, instead of showing a freshly uploaded 1440p master as "sd".
   */
  const storedStillProcessing = Boolean(stored && (stored.durationSeconds === 0 || stored.definition === 'sd'));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
          <SlidersHorizontal className="h-6 w-6 text-orange-600" aria-hidden="true" />
          Sound Engineering &amp; Mastering
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-500 dark:text-gray-400">
          Export the WAV from SUNO, master it to a streaming target here, then take the mastered WAV into Adobe.
          This is <strong>loudness</strong> mastering — level and true-peak only, never EQ, compression or tone.
        </p>
      </header>

      {/* Announced to screen readers at every stage change. */}
      <p role="status" aria-live="polite" className="sr-only">{announce}</p>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-300"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* 1 — source */}
      <section aria-busy={stage === 'uploading'} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          1 · Source WAV from SUNO
        </h2>

        {stage === 'idle' && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              // Without this the browser navigates the tab to the dropped file —
              // the most natural gesture on a dashed box was the worst outcome.
              e.preventDefault();
              setDragging(false);
              void onPick(e.dataTransfer.files?.[0] ?? null);
            }}
          >
            <input
              ref={fileInput}
              id={inputId}
              type="file"
              accept=".wav,audio/wav,audio/x-wav"
              className="peer sr-only"
              onChange={(e) => onPick(e.target.files?.[0] ?? null)}
            />
            <label
              htmlFor={inputId}
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition peer-focus-visible:ring-2 peer-focus-visible:ring-orange-500 peer-focus-visible:ring-offset-2 dark:peer-focus-visible:ring-offset-gray-900 ${
                dragging
                  ? 'border-orange-500 bg-orange-50/60 dark:border-orange-500 dark:bg-orange-500/10'
                  : 'border-gray-300 hover:border-orange-400 hover:bg-orange-50/40 dark:border-gray-700 dark:hover:border-orange-500 dark:hover:bg-orange-500/5'
              }`}
            >
              <Upload className="h-6 w-6 text-gray-400" aria-hidden="true" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                Drop a WAV here, or click to choose
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                WAV only · up to {MB(MAX_UPLOAD_BYTES)} · uploads straight to S3
              </span>
            </label>
          </div>
        )}

        {stage === 'uploading' && source && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span className="truncate">Uploading {source.name}</span>
              <span className="ml-auto shrink-0 tabular-nums text-gray-500 dark:text-gray-400">
                {MB(sent.loaded)} / {MB(sent.total)} · {pct}%
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Upload progress"
              className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800"
            >
              <div className="h-full rounded-full bg-orange-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <X className="h-3 w-3" aria-hidden="true" /> Cancel upload
            </button>
          </div>
        )}

        {(stage === 'ready' || stage === 'mastering' || stage === 'done') && source && (
          <div className="flex items-center gap-3 text-sm">
            <FileAudio className="h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" />
            <div className="min-w-0">
              <p className="truncate font-medium text-gray-900 dark:text-gray-100">{source.name}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {source.size > 0 ? `${MB(source.size)} · uploaded` : 'from the library · source unchanged'}
              </p>
            </div>
            {stage !== 'mastering' && (
              <button
                type="button"
                onClick={reset}
                className="ml-auto inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" /> Start over
              </button>
            )}
          </div>
        )}
      </section>

      {/* 2 — target + run */}
      <section aria-busy={stage === 'mastering'} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          2 · Target &amp; master
        </h2>

        {/* "Master target", not "Streaming loudness target": one of these is
            neither streaming nor a loudness target. */}
        <div role="radiogroup" aria-label="Master target" className="flex flex-wrap gap-2">
          {TARGETS.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => { targetRefs.current[i] = el; }}
              type="button"
              role="radio"
              aria-checked={targetId === t.id}
              disabled={stage === 'mastering'}
              tabIndex={radioTabIndex(i, TARGETS.findIndex((x) => x.id === targetId), TARGETS.length)}
              onKeyDown={(e) => {
                // Arrow keys select as they move — the radiogroup pattern. Any
                // other key (Tab, Space) must pass through untouched.
                const from = TARGETS.findIndex((x) => x.id === targetId);
                const to = nextRadioIndex(e.key, from, TARGETS.length);
                if (to === null) return;
                e.preventDefault();
                pickTarget(TARGETS[to].id);
                targetRefs.current[to]?.focus();
              }}
              onClick={() => pickTarget(t.id)}
              className={`flex items-start gap-2 rounded-lg border px-4 py-2 text-left transition disabled:opacity-50 ${
                targetId === t.id
                  ? 'border-orange-500 bg-orange-50 dark:border-orange-500 dark:bg-orange-500/10'
                  : 'border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'
              }`}
            >
              <CheckCircle2
                className={`mt-0.5 h-4 w-4 shrink-0 ${targetId === t.id ? 'text-orange-600' : 'text-transparent'}`}
                aria-hidden="true"
              />
              <span>
                <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">{t.label}</span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">{t.for}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          {isBed
            ? `One static gain to ${PEAK_CEILING_DBTP} dBTP — no loudness normalisation, no compression, no limiting. The bed keeps its range, which is the headroom the voice sings into.`
            : 'Each target writes its own file, so you can master the same song for both without one overwriting the other.'}
        </p>

        {sourceKey && (
          <div className="mt-4">
            {/*
              Mounted for as long as a source is loaded — including while the
              worker runs. Unmounting it mid-run would tear down its region and
              fade state, and its remount would push `null` back up, so the
              second target in the dual-target flow would quietly master the
              UNTRIMMED file. Disabled rather than removed.
            */}
            {/* Pre-master analysis — advisory. It measures the source and
                proposes; nothing is applied without a click, because a wrong
                automatic trim is worse than no trim. */}
            {(analysing || analysis) && (
              <div className="mt-4 rounded-lg border border-gray-200 p-4 text-sm dark:border-gray-800">
                <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <Info className="h-3.5 w-3.5" aria-hidden="true" /> Source analysis
                </h3>
                {analysing && !analysis && (
                  <p className="mt-2 flex items-center gap-2 text-gray-600 dark:text-gray-300">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Measuring the source…
                  </p>
                )}
                {analysis && (
                  <div className="mt-2 space-y-1.5">
                    <p className={analysis.fade.state === 'fading'
                      ? 'font-medium text-amber-700 dark:text-amber-400'
                      : 'text-gray-600 dark:text-gray-300'}>
                      {analysis.fade.state === 'fading' && (
                        <AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      {analysis.fade.message}
                    </p>
                    {analysis.partBFade && (
                      <p className={analysis.partBFade.state === 'fading'
                        ? 'font-medium text-amber-700 dark:text-amber-400'
                        : 'text-gray-600 dark:text-gray-300'}>
                        Part B — {analysis.partBFade.message}
                      </p>
                    )}
                    {analysis.level && (
                      <p className={analysis.level.matched
                        ? 'text-gray-600 dark:text-gray-300'
                        : 'font-medium text-amber-700 dark:text-amber-400'}>
                        {analysis.level.message}
                      </p>
                    )}
                    <p className="tabular-nums text-gray-500 dark:text-gray-400">
                      Silence — head {(analysis.leadingSilenceSec ?? 0).toFixed(2)}s · tail {(analysis.trailingSilenceSec ?? 0).toFixed(2)}s
                    </p>
                    {analysis.trim && (
                      <button
                        type="button"
                        onClick={() => {
                          setSeedEdit({
                            trimStartSec: analysis.trim!.trimStartSec,
                            trimEndSec: analysis.trim!.trimEndSec,
                            fadeInSec: 0,
                            fadeOutSec: 0,
                            curve: DEFAULT_CROSSFADE_CURVE,
                          });
                          setSeedDurationSec(analysis.durationSec ?? 0);
                          setRecipeNonce((n) => n + 1);
                          setAnnounce('Suggested trim applied.');
                        }}
                        className="mt-1 inline-flex items-center gap-2 rounded-lg border border-orange-300 px-3 py-1.5 text-xs font-medium text-orange-700 transition hover:bg-orange-50 dark:border-orange-800 dark:text-orange-300 dark:hover:bg-orange-900/20"
                      >
                        Apply suggested trim ({analysis.trim.trimStartSec}s
                        {analysis.trim.trimEndSec !== null ? ` – ${analysis.trim.trimEndSec}s` : ' – end'})
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            <MasteringTrimPanel
              key={`trim-${recipeNonce}`}
              file={pickedFile}
              onChange={setEdit}
              disabled={stage === 'mastering'}
              initialEdit={seedEdit}
              knownDurationSec={seedDurationSec}
            />

            {/* Both panels edit the SAME pre-pass, upstream of every
                measurement — which is what makes "master the assembled song
                once" the only available order. */}
            <MasteringJoinPanel
              key={`join-${recipeNonce}`}
              partB={partB}
              onPick={(f) => void onPickPartB(f)}
              onClear={() => { setPartB(null); setPartBStartSec(0); setSeedJoin(null); }}
              overlapSec={overlapSec}
              onOverlapChange={setOverlapSec}
              partBStartSec={partBStartSec}
              onPartBStartChange={setPartBStartSec}
              uploading={partBUploading}
              progressPct={partBSent.total ? Math.round((partBSent.loaded / partBSent.total) * 100) : 0}
              disabled={stage === 'mastering'}
              onPreviewSeam={() => void previewSeam()}
              previewBusy={seamBusy}
              previewUrl={seamPreview?.url ?? null}
              previewNote={seamPreview?.note ?? null}
              previewMismatched={seamPreview?.mismatched ?? false}
              comparison={seamPreview?.comparison ?? null}
              onApplySuggestion={({ partBStartSec, overlapSec }) => {
                setPartBStartSec(partBStartSec);
                setOverlapSec(overlapSec);
                setAnnounce(`Set Part B to start at ${partBStartSec}s with a ${overlapSec}s crossfade.`);
              }}
            />
          </div>
        )}

        {/* Reference-matched mastering picker (Phase 1C UI). Only rendered
            when the feature flag is on AND we are not mid-master — and never
            for a karaoke bed, which the route refuses with a 400: matching
            shapes an output by another master's tone, the opposite of leaving
            a bed alone. */}
        {FEATURES.ADMIN.MASTERING_REFERENCE_MATCHING && stage !== 'mastering' && !isBed && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-gray-50/50 p-3 text-sm dark:border-gray-800 dark:bg-gray-900/40">
            <label className="flex items-center gap-2 text-gray-700 dark:text-gray-200">
              <span className="font-medium">Reference:</span>
              <select
                value={selectedReferenceKey ?? ''}
                onChange={(e) => setSelectedReferenceKey(e.target.value || null)}
                onFocus={fetchReferencesIfNeeded}
                onMouseDown={fetchReferencesIfNeeded}
                disabled={referencesLoading}
                className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800"
              >
                <option value="">— none (loudnorm only) —</option>
                {references.map((r) => (
                  <option key={r.key} value={r.key}>{r.id}</option>
                ))}
              </select>
            </label>
            {selectedReferenceKey && (
              <fieldset className="flex items-center gap-3">
                <legend className="sr-only">Matching method</legend>
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="matching-method"
                    value="matched"
                    checked={matchingMethod === 'matched'}
                    onChange={() => setMatchingMethod('matched')}
                  />
                  Matched only
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="matching-method"
                    value="both"
                    checked={matchingMethod === 'both'}
                    onChange={() => setMatchingMethod('both')}
                  />
                  Both (loudnorm + matched)
                </label>
              </fieldset>
            )}
            {referencesLoading && (
              <span className="text-xs text-gray-500">Loading references…</span>
            )}
            {referencesRequested.current && !referencesLoading && references.length === 0 && !referencesError && (
              <span className="text-xs text-gray-500">
                No references yet. Seed via <code>aws s3 cp &lt;file.wav&gt; s3://tamil-web-media/audio/references/</code>.
              </span>
            )}
            {referencesError && (
              <span className="text-xs text-red-600 dark:text-red-400">Error loading references: {referencesError}</span>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={startMastering}
            disabled={!(stage === 'ready' || stage === 'done')}
            className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {stage === 'mastering'
              ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              : <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />}
            {stage === 'mastering'
              ? `${isBed ? 'Making the bed' : 'Mastering'}… ${elapsed}s`
              : isBed
                ? 'Make the karaoke bed'
                : `Master to ${target} LUFS`}
          </button>
          {stage === 'mastering' && (
            <button
              type="button"
              onClick={stopWatching}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <X className="h-3 w-3" aria-hidden="true" /> Stop watching
            </button>
          )}
          {stage === 'idle' && (
            <span className="text-xs text-gray-500 dark:text-gray-400">Upload a WAV first.</span>
          )}
          {stage === 'ready' && paused && (
            <button
              type="button"
              onClick={resumeWatching}
              className="inline-flex items-center gap-1 rounded-lg border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-800 hover:bg-orange-100 dark:border-orange-500/40 dark:bg-orange-500/10 dark:text-orange-300 dark:hover:bg-orange-500/20"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" /> Resume watching job{' '}
              <code>{paused.jobId.slice(0, 8)}</code>
            </button>
          )}
        </div>
        {stage === 'ready' && paused && (
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            That master is still being produced. Resume to pick it up where it is — mastering again would start a
            second, duplicate job.
          </p>
        )}
        {stage === 'mastering' && (
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Two-pass loudnorm — measure, then correct. Usually well under a minute; long sources take a few.
            This keeps running if you leave the page, and re-attaches when you come back.
            {jobId && <> Job <code className="rounded bg-gray-100 px-1 dark:bg-gray-800">{jobId.slice(0, 8)}</code>.</>}
          </p>
        )}
      </section>

      {/* 3 — result + hand-off */}
      {stage === 'done' && job && (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            3 · Result
            {readiness.ok && <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />}
          </h2>

          {/* One glanceable verdict, driven by the SAME rules as the saved .txt
              report so the screen and the file cannot disagree. Requires all
              three: on target, peak-safe, dynamics preserved. */}
          <div
            className={`mb-3 rounded-lg border p-3 text-sm ${
              readiness.ok
                ? 'border-emerald-300 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-900/10'
                : 'border-amber-300 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-900/10'
            }`}
          >
            <p className={`font-semibold ${readiness.ok ? 'text-emerald-800 dark:text-emerald-300' : 'text-amber-800 dark:text-amber-300'}`}>
              {readiness.ok ? '✓' : '⚠'} {readiness.headline}
            </p>
            <p className="mt-0.5 tabular-nums text-gray-700 dark:text-gray-200">{readiness.facts}</p>

            <dl className="mt-2 grid gap-x-4 gap-y-1 border-t border-black/5 pt-2 text-xs dark:border-white/10 sm:grid-cols-2">
              {readiness.checks.map((c) => (
                <div key={c.label} className="flex items-baseline gap-1.5">
                  <span
                    aria-hidden="true"
                    className={
                      c.ok === true
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : c.ok === false
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-gray-400'
                    }
                  >
                    {c.ok === true ? '✓' : c.ok === false ? '✗' : '·'}
                  </span>
                  <dt className="font-medium text-gray-700 dark:text-gray-200">{c.label}</dt>
                  <dd className="tabular-nums text-gray-500 dark:text-gray-400">{c.detail}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* overflow-x-auto, NOT overflow-hidden. This page is an installable
              PWA meant to live on a phone, and four columns of LUFS/dBTP figures
              do not fit a 360px screen — hidden would clip them with no way to
              reach the numbers. min-w keeps the columns legible and lets the
              table scroll instead of crushing itself. */}
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
            <table className="w-full min-w-[26rem] text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left font-semibold">Stage</th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">Integrated</th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">True peak</th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">Range (LRA)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 text-gray-800 dark:divide-gray-800 dark:text-gray-200">
                <tr>
                  <th scope="row" className="px-4 py-2 text-left font-normal">
                    Source
                    {sourceInfoLine(job) && (
                      <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
                        {sourceInfoLine(job)}
                      </span>
                    )}
                  </th>
                  <td className="px-4 py-2 text-right tabular-nums">{lufs(job.beforeLufs)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{dbtp(job.beforeTp)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{lu(job.beforeLra)}</td>
                </tr>
                <tr className="bg-emerald-50/40 dark:bg-emerald-500/5">
                  <th scope="row" className="px-4 py-2 text-left font-medium">
                    Streaming Master
                    <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
                      24-bit · 48 kHz
                    </span>
                  </th>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">{lufs(job.afterLufs)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{dbtp(job.afterTp)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {lu(job.afterLra)}
                    {dynamicsPreserved(job) && (
                      <span className="ml-1 text-xs font-normal text-emerald-600 dark:text-emerald-400">
                        unchanged
                      </span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {joinLine(job) && (
            <p className="mt-3 flex items-start gap-2 text-xs text-gray-600 dark:text-gray-300">
              <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {/* Same string as the saved .txt — otherwise a master whose length
                  nobody can account for is explained on screen and nowhere else. */}
              <span>{joinLine(job)}</span>
            </p>
          )}

          {/* Reference-matched mastering progress (Phase 1C UI). Rendered only
              when the job carries a matchingStage — loudnorm-only jobs never
              set it, so this stays invisible for the legacy path. Falls back
              to text for stages the Python worker patches; a completed match
              shows the matched output key so the admin can grab it while the
              3-way A/B player (Phase 1C PR 3) is still being built. */}
          {job.matchingStage && (
            <p className="mt-3 flex items-start gap-2 text-xs text-gray-600 dark:text-gray-300">
              <SlidersHorizontal className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                Reference-matched output:{' '}
                <strong className="tabular-nums">
                  {job.matchingStage === 'completed'
                    ? 'ready'
                    : job.matchingStage === 'failed'
                      ? 'failed'
                      : `${job.matchingStage}…`}
                </strong>
                {job.matchedMasterKey && (
                  <>
                    {' · '}
                    <button
                      type="button"
                      onClick={() => downloadKey(job.matchedMasterKey!, masterName || 'reference-matched', target)}
                      className="text-orange-700 underline hover:text-orange-800 dark:text-orange-400"
                    >
                      download matched WAV
                    </button>
                  </>
                )}
                {job.matchingError && (
                  <span className="ml-1 text-red-600 dark:text-red-400">
                    ({job.matchingError.code}: {job.matchingError.message})
                  </span>
                )}
              </span>
            </p>
          )}

          <p className="mt-3 flex items-start gap-2 text-xs text-gray-500 dark:text-gray-400">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              <strong>Integrated</strong> is how loud the song plays overall — the number platforms normalise to.
              <strong> True peak</strong> is how close the loudest instant comes to distortion; at or under -1 dBTP is safe.
            </span>
          </p>

          <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">
            {/* A bed has no target to land on. Saying "measured -20.2 against a
                -14 LUFS target" over a correct bed is the defect this whole
                mode exists to remove, and it would have said exactly that. */}
            {isBedJob &&
              (typeof job.peakGainDb === 'number'
                ? `Gain applied ${job.peakGainDb >= 0 ? '+' : ''}${job.peakGainDb.toFixed(2)} dB — the bed sits at ${dbtp(job.afterTp)} and lands at ${lufs(job.afterLufs)}, range unchanged.`
                : `The bed was written at ${dbtp(job.afterTp)}, but the gain it used was not recorded.`)}
            {!isBedJob && verdict === 'on-target' && `Landed on ${job.target} LUFS, peak-safe.`}
            {!isBedJob && verdict === 'off-target' &&
              `Measured ${lufs(job.afterLufs)} against a ${job.target} LUFS target — worth a listen before you use it.`}
            {!isBedJob && verdict === 'unmeasured' &&
              `The master was written, but the check measurement did not come back — download it and verify before use.`}
            {!isBedJob && verdict === 'on-target' && movedLu !== null && movedLu < 1 && (
              <span className="text-gray-500 dark:text-gray-400">
                {' '}The source moved {movedLu.toFixed(2)} LU — below what anyone can hear, which is the correct
                outcome for a song that was already on target.
              </span>
            )}
          </p>

          {/* Nobody streams a karaoke bed, so this table would grade it against
              targets it never had — every row a failure on a correct file. */}
          {typeof job.afterLufs === 'number' && !isBedJob && (
            <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
              <p className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-xs font-medium text-gray-600 dark:border-gray-800 dark:bg-gray-800/40 dark:text-gray-300">
                Streaming readiness — how it lands on each platform
              </p>
              {/* Scroller INSIDE the rounded shell, so the header keeps its
                  corners while the table can still escape a narrow screen. The
                  platform column is a comma-joined list ("Spotify, YouTube,
                  Amazon, TIDAL") — the widest content in the module. */}
              <div className="overflow-x-auto">
              <table className="w-full min-w-[26rem] text-sm">
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                  {platformLanding(job.afterLufs).map((row) => (
                    <tr key={row.target}>
                      <td
                        className={`w-6 pl-4 text-center font-semibold ${
                          row.status === 'ok'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                        aria-hidden="true"
                      >
                        {row.mark}
                      </td>
                      <td className="py-2 pl-2 tabular-nums text-gray-500 dark:text-gray-400">{row.target} LUFS</td>
                      <td className="px-4 py-2 text-gray-800 dark:text-gray-200">{row.platforms.join(', ')}</td>
                      <td
                        className={`px-4 py-2 text-right ${
                          row.status === 'ok'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-amber-700 dark:text-amber-400'
                        }`}
                      >
                        {row.note}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}

          {job.masterKey && job.s3Key && (
            <MasteringComparePlayer
              sourceKey={job.s3Key}
              masterKey={job.masterKey}
              beforeLufs={job.beforeLufs}
              afterLufs={job.afterLufs}
              // Phase 1C UI: 3-way A/B/C when the matchering-worker produced
              // a matched output alongside the loudnorm master. Absent →
              // player renders as it always has.
              matchedKey={job.matchingStage === 'completed' ? job.matchedMasterKey : null}
            />
          )}

          <div className="mt-4">
            <label htmlFor={`${inputId}-name`} className="block text-xs font-medium text-gray-600 dark:text-gray-300">
              Name this master <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              id={`${inputId}-name`}
              type="text"
              value={masterName}
              onChange={(e) => setMasterName(e.target.value)}
              placeholder="e.g. Amma En Agame"
              maxLength={120}
              className="mt-1 w-full max-w-md rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {masterName.trim()
                ? `Downloads as “${masterName.trim()} (${isBedJob ? bedLabel : `Master ${job.target} LUFS`}).wav”. Tamil names work too.`
                : 'Used only for the download filename and report — the stored file keeps its unique id.'}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={download}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
            >
              {/* A bed does not go to Adobe — it goes to the buyer. */}
              <Download className="h-4 w-4" aria-hidden="true" /> {isBedJob ? 'Download the bed (WAV)' : 'Download for Adobe'}
            </button>
            {job.mp3Key && (
              <button
                type="button"
                onClick={downloadMp3}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                <Download className="h-4 w-4" aria-hidden="true" /> {isBedJob ? `Download the ${KARAOKE_MP3_BITRATE} MP3` : 'Download web MP3'}
              </button>
            )}
            <button
              type="button"
              onClick={downloadReport}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <FileAudio className="h-4 w-4" aria-hidden="true" /> Download report
            </button>
            {mp3Verdict && (
              <p
                className={`basis-full text-xs ${
                  mp3Verdict.status === 'hot'
                    ? 'font-medium text-red-600 dark:text-red-400'
                    : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                {mp3Verdict.status === 'hot' && (
                  <AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                )}
                {mp3Verdict.message}
                {mp3Verdict.encodeDeltaDb !== null && (
                  <> Encoding moved the peak by {mp3Verdict.encodeDeltaDb >= 0 ? '+' : ''}
                    {mp3Verdict.encodeDeltaDb.toFixed(2)} dB.</>
                )}
              </p>
            )}
            <button
              type="button"
              onClick={saveToLibrary}
              disabled={saving || !!savedAt}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 px-4 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-60 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-900/20"
            >
              {saving
                ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                : <Save className="h-4 w-4" aria-hidden="true" />}
              {savedAt ? 'Saved to library' : 'Save to library'}
            </button>
          </div>
          {!savedAt && (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Unsaved masters are cleared after 24 hours. The WAV stays in S3, but the loudness
              report and A/B comparison are lost with the record.
            </p>
          )}

          {/* Publish — only once saved, because the title IS the filename and
              save is what persists it. Deliberately a separate step from Save:
              this writes to the CDN-served path the site reads. */}
          {/* Never for a bed: this copies the MP3 into the CDN-served
              catalogue path. A bed belongs to the buyer who paid for it, not
              to the site. */}
          {savedAt && job.mp3Key && !isBedJob && (
            <div className="mt-4 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void publishToSite()}
                  disabled={publishing || !!published}
                  className="inline-flex items-center gap-2 rounded-lg border border-orange-300 px-4 py-2 text-sm font-medium text-orange-700 transition hover:bg-orange-50 disabled:opacity-60 dark:border-orange-800 dark:text-orange-300 dark:hover:bg-orange-900/20"
                >
                  {publishing
                    ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    : <Upload className="h-4 w-4" aria-hidden="true" />}
                  {published ? 'Staged on the site path' : 'Publish web MP3 to site'}
                </button>
                {published && (
                  <code className="min-w-0 truncate rounded bg-gray-100 px-2 py-1 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                    {published.key}
                  </code>
                )}
              </div>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {published ? (
                  <>
                    {published.replaced
                      ? 'Replaced the file that was already there (the bucket is versioned, so the previous one still exists). '
                      : 'Copied into the site’s audio folder. '}
                    <strong>Not live yet</strong> — the song appears on tamilagaval.com once a content
                    record points at this file and the site rebuilds.
                  </>
                ) : (
                  <>
                    Copies the measured MP3 to <code>audio/poem-music/</code> under this master’s name,
                    so it no longer has to be downloaded and re-uploaded by hand. Staging only — the song
                    goes live when a content record points at it and the site rebuilds.
                  </>
                )}
              </p>
            </div>
          )}

          {/* Render for YouTube — cover art over the MASTERED audio, encoded
              once. This is what keeps Premiere out of the audio path: no
              re-export, so nothing can re-level or re-encode the master before
              YouTube receives it. */}
          {/* A bed is a deliverable, not a release — `planRender` and
              `planShort` both refuse one, so this panel would offer two buttons
              whose only outcome is a refusal. */}
          {savedAt && job.masterKey && !isBedJob && (
            <div className="mt-4 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
              <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <Film className="h-3.5 w-3.5" aria-hidden="true" /> Render for YouTube
              </h3>

              <div className="mt-3 flex flex-wrap items-end gap-3">
                <div>
                  <label htmlFor={`${inputId}-cover`} className="block text-xs font-medium text-gray-600 dark:text-gray-300">
                    Cover image
                  </label>
                  <input
                    id={`${inputId}-cover`}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={rendering || coverUploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) void onPickCover(f);
                    }}
                    className="mt-1 block w-full max-w-xs text-xs text-gray-600 file:mr-3 file:rounded-lg file:border file:border-gray-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-gray-700 dark:text-gray-300 dark:file:border-gray-700 dark:file:bg-gray-900 dark:file:text-gray-200"
                  />
                </div>
                <div>
                  <label htmlFor={`${inputId}-height`} className="block text-xs font-medium text-gray-600 dark:text-gray-300">
                    Upload size
                  </label>
                  <select
                    id={`${inputId}-height`}
                    value={videoHeight}
                    disabled={rendering}
                    onChange={(e) => setVideoHeight(Number(e.target.value))}
                    className="mt-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                  >
                    <option value={1080}>1080p</option>
                    <option value={1440}>1440p — better audio on YouTube</option>
                    <option value={2160}>2160p</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => void renderVideo()}
                  disabled={!cover || rendering || coverUploading}
                  className="inline-flex items-center gap-2 rounded-lg border border-orange-300 px-4 py-2 text-sm font-medium text-orange-700 transition hover:bg-orange-50 disabled:opacity-60 dark:border-orange-800 dark:text-orange-300 dark:hover:bg-orange-900/20"
                >
                  {rendering
                    ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    : <Film className="h-4 w-4" aria-hidden="true" />}
                  {rendering ? 'Rendering…' : 'Render video'}
                </button>
                {job.videoKey && (
                  <button
                    type="button"
                    onClick={() => void downloadKey(job.videoKey!, masterName.trim(), job.target)}
                    className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" /> Download MP4
                  </button>
                )}
              </div>

              {/* THE VERTICAL CLIP. A second, independent render from the same
                  cover and the same mastered WAV — not a crop of the video, and
                  not a step on the way to one. It exists because the channel
                  posts 2-3 songs a week to YouTube and the rest goes to Reels
                  and Instagram, which want 9:16. */}
              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-gray-200 pt-4 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => void makeShort()}
                  disabled={!cover || shorting || rendering || coverUploading}
                  className="inline-flex items-center gap-2 rounded-lg border border-indigo-300 px-4 py-2 text-sm font-medium text-indigo-700 transition hover:bg-indigo-50 disabled:opacity-60 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-900/20"
                >
                  {shorting
                    ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    : <Smartphone className="h-4 w-4" aria-hidden="true" />}
                  {shorting ? 'Cutting…' : 'Make a short'}
                </button>
                {job.shortKey && (
                  <button
                    type="button"
                    onClick={() => void downloadKey(job.shortKey!, masterName.trim(), job.target, 'Short')}
                    className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" /> Download short
                  </button>
                )}
                <ShortWindowFields
                  value={windowFor(jobId)}
                  onChange={(w) => setShortWindow(w && jobId ? { jobId, ...w } : null)}
                  disabled={shorting}
                  idPrefix={`${inputId}-short`}
                />
                <p className="w-full text-xs text-gray-500 dark:text-gray-400">
                  1080&times;1920, faded at both ends. No lyrics are burned in — download it and
                  post it to Reels or Instagram by hand.
                  {typeof job.shortStartSec === 'number' && (
                    <>
                      {' '}Last clip: {job.shortSeconds ?? 30}s from {formatTime(job.shortStartSec)}
                      {job.shortPicked === false ? ' (chosen by loudness).' : '.'}
                    </>
                  )}
                </p>
              </div>

              {/* PREFLIGHT — what is about to be encoded, before it is.
                  A leftover cover from the previous song used to render that
                  song's artwork into this song's video, silently; the fix was
                  to clear it, and this makes the remaining risk visible. */}
              {cover && !rendering && (
                <dl className="mt-3 grid gap-x-4 gap-y-1 rounded-lg bg-gray-50 p-3 text-xs dark:bg-gray-800/40 sm:grid-cols-[7rem_1fr]">
                  <dt className="font-medium text-gray-600 dark:text-gray-300">Cover</dt>
                  <dd className="truncate text-gray-800 dark:text-gray-100">{cover.name}</dd>
                  <dt className="font-medium text-gray-600 dark:text-gray-300">Audio</dt>
                  <dd className="text-gray-800 dark:text-gray-100">
                    the mastered WAV{typeof job.afterLufs === 'number' ? ` (${job.afterLufs.toFixed(1)} LUFS)` : ''} → AAC 384k/48 kHz
                  </dd>
                  <dt className="font-medium text-gray-600 dark:text-gray-300">Downloads as</dt>
                  <dd className="truncate text-gray-800 dark:text-gray-100">
                    {masterName.trim()
                      ? `${masterName.trim()} (Master ${job.target} LUFS).mp4`
                      : <span className="text-amber-700 dark:text-amber-400">unnamed — name this master first</span>}
                  </dd>
                </dl>
              )}
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {coverUploading
                  ? 'Uploading cover…'
                  : cover
                    ? `Cover: ${cover.name}. `
                    : 'Add a cover to render. '}
                Encodes the <strong>mastered WAV</strong> at AAC 384k/48&nbsp;kHz — the audio never
                passes through another editor, so nothing can re-level it. 1440p is the default
                because YouTube gives higher-resolution uploads a better audio codec.
                {job.videoKey && ' Upload it below, or download the MP4 and do it by hand.'}
              </p>
            </div>
          )}

          {/*
            UPLOAD TO YOUTUBE — the last step that used to happen outside the
            portal. Four sections in order: the picture, the metadata, the
            preflight, the upload. Only reachable once a video actually exists;
            `planUpload` refuses everything else server-side, and offering a
            button that can only 409 is worse than not offering one.
          */}
          {uploadPanelOpen && (
            <div className="mt-4 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
              <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <Upload className="h-3.5 w-3.5" aria-hidden="true" /> Upload to YouTube
              </h3>

              {/* 1 — THE PICTURE. A bad render reached YouTube unseen once;
                  the whole panel exists so that cannot happen again. */}
              <div className="mt-3">
                <p className="text-xs font-medium text-gray-600 dark:text-gray-300">
                  The picture that will be published
                </p>
                {framePreviewUrl ? (
                  // A short-lived presigned S3 URL: next/image would need the
                  // bucket host in remotePatterns and would proxy a private
                  // object through the SSR function for no benefit.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={framePreviewUrl}
                    alt="Cover art the video was rendered from"
                    className="mt-2 max-h-56 w-auto rounded-lg border border-gray-200 object-contain dark:border-gray-800"
                  />
                ) : (
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    {frameKey ? 'Loading the cover…' : 'No cover recorded for this render.'}
                  </p>
                )}
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  This is the cover the MP4 was encoded from — the frame itself is this image fitted
                  to {videoHeight}p. If it is the wrong picture, re-render above before uploading:
                  YouTube cannot swap a video file, so a wrong frame means deleting the video and
                  starting again.
                </p>
              </div>

              {/* 1b — THE SOUND. The picture above is checked by eye; this is
                  the half nobody could check by eye. The worker measures the
                  finished MP4 against the master it was built from, so a render
                  that resampled, re-levelled or truncated the song says so here
                  instead of on YouTube. See src/lib/master-verify.ts. */}
              {job.videoKey && (
                <div className="mt-4">
                  <p className="text-xs font-medium text-gray-600 dark:text-gray-300">
                    The sound that will be published
                  </p>
                  {job.videoAudioCheck === 'passed' && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-green-700 dark:text-green-400">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>
                        Checked against the master: duration, sample rate, channels, loudness, true
                        peak and dynamics all match. The render did not touch the audio.
                      </span>
                    </p>
                  )}
                  {job.videoAudioCheck === 'failed' && (
                    <div className="mt-2 rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/40">
                      <p className="flex items-start gap-1.5 text-xs font-semibold text-red-800 dark:text-red-300">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>This video&rsquo;s audio does not match its master. Do not upload it.</span>
                      </p>
                      <ul className="mt-2 list-disc space-y-1 pl-7 text-xs text-red-700 dark:text-red-300">
                        {(job.videoAudioFindings ?? []).map((f) => (
                          <li key={f}>{f}</li>
                        ))}
                      </ul>
                      <p className="mt-2 pl-7 text-xs text-red-700 dark:text-red-400">
                        Re-render above. The upload is blocked until the audio matches.
                      </p>
                    </div>
                  )}
                  {job.videoAudioCheck === 'unknown' && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>
                        The audio could not be fully checked against the master — some figure would
                        not read. Not a fault, and the upload is not blocked, but nothing has
                        confirmed the audio either.
                      </span>
                    </p>
                  )}
                  {!job.videoAudioCheck && (
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                      This video was rendered before the audio check existed, so it has not been
                      compared against its master. Re-render to have it checked.
                    </p>
                  )}
                </div>
              )}

              {/* 2 — METADATA. The operator owns the title, the tags and the
                  body text; the description's tail is assembled, not typed. */}
              <div className="mt-4 space-y-3">
                <div>
                  <label htmlFor={`${inputId}-yt-title`} className="block text-xs font-medium text-gray-600 dark:text-gray-300">
                    Video title
                  </label>
                  <input
                    id={`${inputId}-yt-title`}
                    type="text"
                    value={uploadTitleValue}
                    onChange={(e) => setUploadTitle(e.target.value)}
                    // YouTube's own ceiling, and the upload route's zod cap. A
                    // longer title is rejected with a generic error, so it is
                    // stopped here where the operator can see it happening.
                    maxLength={100}
                    placeholder="Tamil title | Romanized title"
                    className="mt-1 w-full max-w-md rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {uploadTitleValue.length}/100 · starts from this master&rsquo;s name; edit it freely.
                  </p>
                </div>

                <div>
                  <label htmlFor={`${inputId}-yt-tags`} className="block text-xs font-medium text-gray-600 dark:text-gray-300">
                    Tags <span className="font-normal text-gray-400">(comma separated)</span>
                  </label>
                  <input
                    id={`${inputId}-yt-tags`}
                    type="text"
                    value={uploadTagsText}
                    onChange={(e) => setUploadTagsText(e.target.value)}
                    placeholder="tamil song, tamil melody, காதல் பாடல்"
                    className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {uploadTags.length} tag{uploadTags.length === 1 ? '' : 's'} · the checklist wants at
                    least 10. Anything past 60 is dropped before sending.
                  </p>
                </div>

                <div>
                  <label htmlFor={`${inputId}-yt-hashtags`} className="block text-xs font-medium text-gray-600 dark:text-gray-300">
                    Hashtags <span className="font-normal text-gray-400">(space separated)</span>
                  </label>
                  <input
                    id={`${inputId}-yt-hashtags`}
                    type="text"
                    value={uploadHashtagsText}
                    onChange={(e) => setUploadHashtagsText(e.target.value)}
                    placeholder="#tamilagaval #tamilsong"
                    className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Kept as data and placed last, where YouTube surfaces them — not typed into the
                    text below. The first three show above the title.
                  </p>
                </div>

                <fieldset>
                  <legend className="text-xs font-medium text-gray-600 dark:text-gray-300">Playlists</legend>
                  <div className="mt-1 flex flex-wrap gap-4">
                    {UPLOAD_PLAYLISTS.map((p) => (
                      <label key={p.id} className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-200">
                        <input
                          type="checkbox"
                          checked={uploadPlaylistIds.includes(p.id)}
                          onChange={(e) =>
                            setUploadPlaylistIds((prev) =>
                              e.target.checked ? [...new Set([...prev, p.id])] : prev.filter((x) => x !== p.id)
                            )
                          }
                        />
                        {p.label}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div>
                  <label htmlFor={`${inputId}-yt-body`} className="block text-xs font-medium text-gray-600 dark:text-gray-300">
                    Your description — lyrics and imagery
                  </label>
                  <textarea
                    id={`${inputId}-yt-body`}
                    value={uploadBody}
                    onChange={(e) => setUploadBody(e.target.value)}
                    rows={6}
                    placeholder="பாடலின் கதை, படிமங்கள்…"
                    className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    This part is yours. The credit block, the site link, the commission line and the
                    playlist links are added below it automatically and are not editable here — that
                    is what stopped a retired credit line reappearing on new uploads.
                  </p>
                </div>

                <div>
                  <p className="text-xs font-medium text-gray-600 dark:text-gray-300">
                    The full description, exactly as it will be sent
                  </p>
                  <pre
                    aria-label="Assembled description preview"
                    className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800 dark:border-gray-800 dark:bg-gray-800/40 dark:text-gray-200"
                  >
                    {uploadDescription}
                  </pre>
                  <p className="mt-1 tabular-nums text-xs text-gray-500 dark:text-gray-400">
                    {uploadDescription.length}/5000 characters
                    {uploadDescription.length >= 5000 && (
                      <span className="ml-1 text-amber-700 dark:text-amber-400">
                        — at the API limit; your text is trimmed before the credit block is.
                      </span>
                    )}
                  </p>
                </div>
              </div>

              {/* 3 — PREFLIGHT. Never gates the button: it grades the video
                  that exists on YouTube, which is why it can only run after the
                  upload. Grading the form would be grading our own claim. */}
              <div className="mt-4 border-t border-gray-100 pt-3 dark:border-gray-800">
                <div className="flex flex-wrap items-center gap-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Release check
                  </h4>
                  <button
                    type="button"
                    onClick={() => job.youtubeVideoId && void runReleaseCheck(job.youtubeVideoId)}
                    disabled={!job.youtubeVideoId || releaseChecking}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                  >
                    {releaseChecking && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
                    {videoCheck ? 'Check again' : 'Run the release check'}
                  </button>
                </div>
                {!job.youtubeVideoId && (
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    Runs once the video exists on YouTube — the checklist grades what the API is
                    holding, not what this form is about to send. It never blocks the upload.
                  </p>
                )}
                {releaseCheckError && (
                  <p className="mt-2 text-xs text-red-600 dark:text-red-400">{releaseCheckError}</p>
                )}
                {videoCheck && (
                  <div className="mt-2">
                    <p className="text-sm font-semibold">
                      {videoCheck.ready ? (
                        <span className="text-emerald-700 dark:text-emerald-400">
                          Nothing mechanical outstanding
                        </span>
                      ) : (
                        <span className="text-amber-800 dark:text-amber-400">
                          {videoCheck.blockers} blocker{videoCheck.blockers === 1 ? '' : 's'},{' '}
                          {videoCheck.gaps} gap{videoCheck.gaps === 1 ? '' : 's'}
                        </span>
                      )}
                    </p>
                    {checkActionable.length > 0 && (
                      <ul className="mt-2 space-y-2">
                        {checkActionable.map((f) => (
                          <FindingRow key={f.id} f={f} />
                        ))}
                      </ul>
                    )}
                    {checkNotes.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-gray-600 dark:text-gray-300">
                          {checkNotes.length} note{checkNotes.length === 1 ? '' : 's'} — nothing to fix
                        </summary>
                        <ul className="mt-2 space-y-2">
                          {checkNotes.map((f) => (
                            <FindingRow key={f.id} f={f} />
                          ))}
                        </ul>
                      </details>
                    )}
                    {/* Kept apart from both lists above, and styled muted +
                        dashed + italic: a check that could not run is not a
                        pass, and showing it as one would launder a known gap. */}
                    {checkNotChecked.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs italic text-slate-400">
                          {checkNotChecked.length} check{checkNotChecked.length === 1 ? '' : 's'} not
                          run — inputs were missing, not clear
                        </summary>
                        <ul className="mt-2 space-y-2">
                          {checkNotChecked.map((f) => (
                            <FindingRow key={f.id} f={f} />
                          ))}
                        </ul>
                      </details>
                    )}
                    {videoCheck.captionsChecked === false && (
                      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                        Caption tracks could not be read — caption findings are absent, not clear.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* 4 — UPLOAD. Private draft; nothing here publishes anything. */}
              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => void uploadToYoutube()}
                  disabled={
                    uploadingToYoutube ||
                    !uploadTitleValue.trim() ||
                    Boolean(job.youtubeVideoId) ||
                    // Not `uploadStatus === 'queued' || 'uploading'`: that form
                    // had no expiry, so a crashed upload disabled its own
                    // recovery forever. See `uploadStale`.
                    uploadInFlight
                  }
                  className="inline-flex items-center gap-2 rounded-lg border border-orange-300 px-4 py-2 text-sm font-medium text-orange-700 transition hover:bg-orange-50 disabled:opacity-60 dark:border-orange-800 dark:text-orange-300 dark:hover:bg-orange-900/20"
                >
                  {uploadingToYoutube
                    ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    : <Upload className="h-4 w-4" aria-hidden="true" />}
                  {uploadingToYoutube
                    ? 'Uploading…'
                    : job.youtubeVideoId
                      ? 'Already uploaded'
                      : job.uploadStatus === 'failed' || uploadStale
                        ? 'Retry upload'
                        : 'Upload to YouTube'}
                </button>
                {!job.youtubeVideoId && !uploadingToYoutube && uploadInFlight && (
                  /* The row says an upload is running but nothing in THIS
                     mount is following it — a remount, or a re-master after
                     navigating away. The button is correctly disabled (a
                     second invoke is exactly what the planner's in-flight
                     guard exists to stop), so the panel must SAY why rather
                     than show a dead grey button with no explanation.

                     ⚠️ IT MUST NOT SAY "reload the page", which is what it
                     said until this was fixed. A reload clears the studio's
                     stored pointer to a finished job, so it does not pick the
                     upload up — it takes this panel away, and with it the only
                     control that can ever retry. The honest instruction is the
                     opposite one, plus when the retry becomes available. */
                  <span className="text-xs text-amber-800 dark:text-amber-400">
                    An upload is already running for this master — it keeps going server-side.
                    Stay on this page: Retry becomes available here if it has not finished within{' '}
                    {UPLOAD_STALE_MINUTES} minutes.
                  </span>
                )}
                {!job.youtubeVideoId && !uploadInFlight && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    Uploads as a <strong>private</strong> draft. Nothing here makes a video public.
                  </span>
                )}
              </div>

              {job.uploadStatus === 'failed' && job.uploadError && !job.youtubeVideoId && (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">{job.uploadError}</p>
              )}

              {job.youtubeVideoId && (
                <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-sm dark:border-emerald-900/40 dark:bg-emerald-900/10">
                  <p className="font-semibold text-emerald-800 dark:text-emerald-300">
                    Uploaded as a private draft —{' '}
                    <code className="rounded bg-white/70 px-1 dark:bg-black/20">{job.youtubeVideoId}</code>
                  </p>
                  {/* An "uploaded" job can still carry an error: the thumbnail
                      or a playlist insert failed AFTER the video landed. The
                      video is real; those steps are not, and saying so is the
                      difference between a report and a claim. */}
                  {job.uploadError && (
                    <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-400">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>{job.uploadError}</span>
                    </p>
                  )}

                  {/* WHAT YOUTUBE IS HOLDING — read back from the API, not
                      echoed from the form. An upload response is a claim. */}
                  <p className="mt-3 text-xs font-medium text-gray-700 dark:text-gray-200">
                    What YouTube stored (read back from the API)
                  </p>
                  {stored ? (
                    <>
                      <dl className="mt-1 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[9rem_1fr]">
                        <dt className="font-medium text-gray-600 dark:text-gray-300">Duration</dt>
                        <dd className="tabular-nums text-gray-800 dark:text-gray-100">
                          {stored.durationSeconds > 0 ? clock(stored.durationSeconds) : '—'}
                        </dd>
                        <dt className="font-medium text-gray-600 dark:text-gray-300">Definition</dt>
                        <dd className="text-gray-800 dark:text-gray-100">{stored.definition ?? '—'}</dd>
                        <dt className="font-medium text-gray-600 dark:text-gray-300">Thumbnail</dt>
                        <dd className="text-gray-800 dark:text-gray-100">
                          {stored.thumbnail
                            ? `${stored.thumbnail.name} · ${stored.thumbnail.width}×${stored.thumbnail.height}`
                            : 'none'}
                        </dd>
                        <dt className="font-medium text-gray-600 dark:text-gray-300">Tags</dt>
                        <dd className="tabular-nums text-gray-800 dark:text-gray-100">{stored.tagCount}</dd>
                        <dt className="font-medium text-gray-600 dark:text-gray-300">Language</dt>
                        <dd className="text-gray-800 dark:text-gray-100">
                          {stored.defaultLanguage ?? '—'} · audio {stored.defaultAudioLanguage ?? '—'}
                        </dd>
                        <dt className="font-medium text-gray-600 dark:text-gray-300">Privacy</dt>
                        <dd className="text-gray-800 dark:text-gray-100">{stored.privacyStatus ?? '—'}</dd>
                        <dt className="font-medium text-gray-600 dark:text-gray-300">Playlists</dt>
                        {/* Every checklist playlist the video was found in —
                            which can legitimately exceed the two this panel
                            adds (Shorts is graded too), so it is reported as a
                            count plus the names that matched, never "2 of 2". */}
                        <dd className="text-gray-800 dark:text-gray-100">
                          <span className="tabular-nums">{stored.playlistIds.length}</span>
                          {' — '}
                          {UPLOAD_PLAYLISTS.filter((p) => stored.playlistIds.includes(p.id))
                            .map((p) => p.label)
                            .join(', ') || 'neither of the two this panel adds'}
                        </dd>
                      </dl>
                      {storedStillProcessing && (
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          YouTube reports a zero duration and <code>sd</code> until it has finished
                          processing an upload, so those two say nothing yet — check again in a few
                          minutes before reading anything into them.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Not read back yet — run the release check above.
                    </p>
                  )}

                  {/* ⚠️ ALWAYS, whether or not the check has run. The panel must
                      never imply a release is finished when it is not: the Data
                      API cannot create a Premiere and cannot pin a comment. */}
                  <p className="mt-3 text-gray-800 dark:text-gray-100">
                    Two steps remain in YouTube Studio — the Data API cannot do either: set the{' '}
                    <strong>Premiere</strong> date and time, and <strong>pin</strong> your comment.
                  </p>
                  <a
                    href={`https://studio.youtube.com/video/${job.youtubeVideoId}/edit`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-orange-700 underline hover:text-orange-800 dark:text-orange-400"
                  >
                    <Link2 className="h-3.5 w-3.5" aria-hidden="true" /> Open in YouTube Studio
                  </a>
                </div>
              )}
            </div>
          )}

          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/60 p-4 text-sm dark:border-amber-900/40 dark:bg-amber-900/10">
            <p className="font-semibold text-amber-800 dark:text-amber-300">Hand-off to Adobe — master once</p>
            <p className="mt-1 text-gray-700 dark:text-gray-200">
              Import this WAV as the audio track and pass it through untouched at 48 kHz. If Essential Sound&rsquo;s
              &ldquo;Auto-Match&rdquo; is on, or the export adds gain, it re-processes the audio and cancels the master
              you just made. Export with PCM or high-bitrate AAC and <strong>no loudness normalisation</strong>.
            </p>
          </div>
        </section>
      )}


      <section className="mt-8">
        <button
          type="button"
          onClick={toggleLibrary}
          aria-expanded={libraryOpen}
          className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <Library className="h-4 w-4" aria-hidden="true" />
          Saved masters
          {library && <span className="font-normal normal-case tracking-normal">({library.length})</span>}
        </button>

        {libraryOpen && library && library.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <input
              value={librarySearch}
              onChange={(e) => setLibrarySearch(e.target.value)}
              placeholder="Search saved masters…"
              aria-label="search saved masters"
              className="min-w-[12rem] flex-1 rounded-md border border-gray-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-900"
            />
            <select
              value={librarySort}
              onChange={(e) => setLibrarySort(e.target.value as LibrarySort)}
              aria-label="sort saved masters"
              className="rounded-md border border-gray-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-900"
            >
              {LIBRARY_SORTS.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
            <span className="text-gray-400">
              {visibleMasters.length} of {library.length} loaded
              {libraryCursor ? ' · more available' : ''}
            </span>
          </div>
        )}

        {libraryOpen && library && library.length === 0 && (
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
            No saved masters yet. Master a file and choose <strong>Save to library</strong> to keep it.
          </p>
        )}

        {/* Grouped by SONG, not by source: no two saved masters share an
            s3Key (a fresh file is uploaded per attempt), so grouping by source
            gives one group per row. Titles are what actually repeat. */}
        {libraryOpen && library && library.length > 0 && groupMastersBySong(visibleMasters).map((group) => (
          <div key={group.song || group.masters[0].id} className="mt-3">
            <p className="flex items-baseline gap-2 px-1 pb-1 text-xs">
              <span className="font-semibold text-gray-800 dark:text-gray-100">
                {group.song || <span className="font-normal text-gray-500">(untitled)</span>}
              </span>
              <span className="text-gray-500 dark:text-gray-400">{describeGroup(group)}</span>
            </p>
          <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
            {group.masters.map((m) => (
              <li key={m.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                {/* Transport gets its own fixed column so every title starts at
                    the same x — with the button inline, a peak master (no play
                    button) used to shift its whole row left of its neighbours. */}
                <div className="flex w-7 shrink-0 justify-center pt-0.5">
                  {m.masterKey && (
                    <button
                      type="button"
                      onClick={() => void playSaved(m)}
                      disabled={rowBusy === m.id}
                      aria-label={playing?.id === m.id ? `Stop ${m.title ?? 'master'}` : `Play ${m.title ?? 'master'}`}
                      className="shrink-0 rounded-full border border-gray-300 p-1.5 text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                    >
                      {rowBusy === m.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : playing?.id === m.id ? (
                        <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <Play className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                    </button>
                  )}
                </div>

                <div className="min-w-0 grow space-y-1.5">
                  {/* 1 — WHICH master this is. Alone on its line: it is the one
                      thing being looked for when scanning 81 of them. */}
                  <div className="flex min-w-0 items-center gap-2">
                    {renaming?.id === m.id ? (
                      <input
                        value={renaming.value}
                        autoFocus
                        aria-label="Master name"
                        maxLength={120}
                        onChange={(e) => setRenaming({ id: m.id, value: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void commitRename();
                          if (e.key === 'Escape') setRenaming(null);
                        }}
                        onBlur={() => void commitRename()}
                        className="min-w-0 grow rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900"
                      />
                    ) : (
                      <span className="flex min-w-0 grow items-center gap-1.5">
                        <span className="min-w-0 truncate font-medium text-gray-900 dark:text-gray-100">
                          {m.title || <span className="text-gray-500 dark:text-gray-400">(untitled)</span>}
                        </span>
                        <button
                          type="button"
                          onClick={() => setRenaming({ id: m.id, value: m.title ?? '' })}
                          aria-label={`Rename ${m.title ?? 'master'}`}
                          className="shrink-0 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </span>
                    )}
                    {m.publishedAt && (
                      <span
                        title={m.publishKey ?? undefined}
                        className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                      >
                        On site
                      </span>
                    )}
                  </div>

                  {/* 2 — what it MEASURES. Deliberately quiet and secondary:
                      read when asked for, never competing with the title. */}
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                    <span className="tabular-nums text-xs text-gray-600 dark:text-gray-300">
                      {lufs(m.afterLufs)}
                    </span>
                    <span className="tabular-nums text-xs text-gray-600 dark:text-gray-300">
                      LRA {lu(m.beforeLra)} → {lu(m.afterLra)}
                      {dynamicsPreserved(m) && (
                        <span className="ml-1 text-emerald-600 dark:text-emerald-400">unchanged</span>
                      )}
                    </span>
                    <span className="tabular-nums text-xs text-gray-500 dark:text-gray-400">
                      {(m.savedAt ?? '').slice(0, 10)}
                    </span>
                  </p>

                  {/* 3 — where it has GOT TO, and the one thing to do next,
                      so the state is read rather than inferred from which
                      download links happen to be present. */}
                  <ReleasePipelineRow job={m} />

                  {/* 4 — what can be DONE with it, ruled off from the facts
                      above so a download link is never mistaken for a number.
                      Files on the left, the two actions that change something
                      pushed right, because those are the ones worth a pause. */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-100 pt-1.5 dark:border-gray-800">
                    {m.masterKey && (
                      <button
                        type="button"
                        onClick={() => void downloadKey(m.masterKey!, m.title ?? '', m.target, isPeakMaster(m) ? bedLabel : undefined)}
                        className="text-xs font-medium text-orange-600 hover:underline dark:text-orange-400"
                      >
                        WAV
                      </button>
                    )}
                    {/* The MP3 was reachable only from the result panel of the run
                        that produced it — so a master saved yesterday had a web
                        file in S3 that nothing on this page could open. */}
                    {m.mp3Key && (
                      <button
                        type="button"
                        onClick={() => void downloadKey(m.mp3Key!, m.title ?? '', m.target, isPeakMaster(m) ? bedLabel : undefined)}
                        className="text-xs font-medium text-orange-600 hover:underline dark:text-orange-400"
                      >
                        MP3
                      </button>
                    )}
                    {/* Same fix as the MP3 button above, for the video: a render
                        that finished in an earlier session had no route back. */}
                    {m.videoKey && (
                      <button
                        type="button"
                        onClick={() => void downloadKey(m.videoKey!, m.title ?? '', m.target)}
                        className="text-xs font-medium text-orange-600 hover:underline dark:text-orange-400"
                      >
                        Video
                      </button>
                    )}
                    {m.shortKey && (
                      <button
                        type="button"
                        onClick={() => void downloadKey(m.shortKey!, m.title ?? '', m.target, 'Short')}
                        className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        Short
                      </button>
                    )}
                    <span className="ml-auto flex flex-wrap items-center gap-x-3">
                      {/* And a way to MAKE one. The inline panel is gated on savedAt,
                          which only this session's Save sets, so without this a master
                          saved yesterday could never be rendered at all. */}
                      {m.masterKey && !isPeakMaster(m) && (
                        <button
                          type="button"
                          disabled={rowBusy === m.id}
                          onClick={() =>
                            // SEEDED FROM THE JOB'S OWN COVER. Opening with `cover: null`
                            // left both buttons disabled on a row that already had one —
                            // so a master saved yesterday, already rendered from that very
                            // image, could not make a short until the operator found the
                            // file again and uploaded a second copy. The only symptom was a
                            // button that did nothing. Reported on இன்னுமொரு கருவறையில்,
                            // 2026-09-19.
                            setRowRender((prev) =>
                              prev?.id === m.id
                                ? null
                                : {
                                    id: m.id,
                                    cover: m.coverKey
                                      ? { key: m.coverKey, name: downloadFilename(m.coverKey) }
                                      : null,
                                  }
                            )
                          }
                          aria-label={`Video or short for ${m.title ?? 'this master'}`}
                          className="text-xs font-medium text-orange-600 hover:underline disabled:opacity-50 dark:text-orange-400"
                        >
                          {m.videoKey || m.shortKey ? 'Video / short' : 'Make video or short'}
                        </button>
                      )}
                      {/* The source is never modified, so re-opening costs nothing and
                          loses nothing — it restores the recipe and hands back
                          control at the "ready" stage. */}
                      {m.s3Key && (
                        <button
                          type="button"
                          onClick={() => reopenMaster(m)}
                          className="text-xs font-medium text-orange-600 hover:underline dark:text-orange-400"
                        >
                          Edit &amp; re-master
                        </button>
                      )}
                    </span>
                  </div>


                  {/* The refusal, in the row that refused. Placed here — not in
                      the render panel below — because play and rename can fail
                      with that panel closed, and an error nobody can see is the
                      same as no error at all. */}
                  {rowError?.id === m.id && (
                    <p
                      role="alert"
                      className="mt-2 flex w-full items-start gap-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800 dark:border-red-900/40 dark:bg-red-900/10 dark:text-red-300"
                    >
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>{rowError.message}</span>
                    </p>
                  )}


                  {rowRender?.id === m.id && (
                    <div className="mt-2 flex w-full flex-wrap items-center gap-2 border-t border-gray-100 pt-2 dark:border-gray-800">
                      <label
                        htmlFor={`${inputId}-rowcover-${m.id}`}
                        className="text-xs font-medium text-gray-600 dark:text-gray-300"
                      >
                        Cover for {m.title || 'this master'}
                      </label>
                      {/* Named, not assumed. Reusing a cover silently would leave
                          the operator unable to tell which image is about to be
                          encoded — and the file input beside it is still the way
                          to replace it. */}
                      {rowRender.cover && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          using <span className="font-medium">{rowRender.cover.name}</span> — replace it here if you want a different one:
                        </span>
                      )}
                      <input
                        id={`${inputId}-rowcover-${m.id}`}
                        type="file"
                        accept="image/*"
                        disabled={rowBusy === m.id}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void onPickRowCover(m.id, f);
                        }}
                        className="text-xs"
                      />
                      {/* "Render" alone did not say WHAT it rendered, and it sat
                          first in a strip opened by a button reading "Render
                          video" — so the whole panel read as being about video
                          and the short button was easy to miss. Both now name
                          their output. */}
                      <button
                        type="button"
                        disabled={!rowRender.cover || rowBusy === m.id}
                        onClick={() => void renderRowVideo()}
                        className="rounded bg-orange-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                      >
                        Render video ({videoHeight}p)
                      </button>
                      {/* The same cover feeds both. A short is not a step on the
                          way to the video and does not need one to exist. */}
                      <button
                        type="button"
                        disabled={!rowRender.cover || rowBusy === m.id}
                        onClick={() => void makeRowShort()}
                        className="rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                      >
                        {m.shortKey ? 'Re-cut vertical short' : 'Make vertical short'}
                      </button>
                      {rowBusy === m.id && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">Working…</span>
                      )}
                      {/* The window, EDITABLE here — not a read-only echo of it.
                          This is where the songs that want a short actually live:
                          the inline panel is gated on savedAt, so from the library
                          the only way to set a window used to be the player's
                          "Use for the short" button, and a timestamp read off a
                          lyric sheet could not be typed at all. */}
                      <ShortWindowFields
                        compact
                        value={windowFor(m.id)}
                        onChange={(w) => setShortWindow(w ? { jobId: m.id, ...w } : null)}
                        disabled={rowBusy === m.id}
                        idPrefix={`${inputId}-rowshort-${m.id}`}
                      />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
          </div>
        ))}

        {/* A search that matches nothing LOADED may still match a later page —
            say so rather than implying the master does not exist. */}
        {libraryOpen && library && library.length > 0 && visibleMasters.length === 0 && (
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
            Nothing here matches &ldquo;{librarySearch}&rdquo;.
            {libraryCursor && ' Older masters have not been loaded yet — try Show more.'}
          </p>
        )}

        {libraryOpen && libraryCursor && (
          <button
            type="button"
            onClick={() => void loadLibrary(libraryCursor)}
            disabled={libraryLoading}
            className="mt-3 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            {libraryLoading ? 'Loading…' : `Show ${LIBRARY_PAGE_SIZE} more`}
          </button>
        )}

        {libraryOpen && playing && (
          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900/40">
            {/* Key on the URL so swapping rows reloads the element rather than
                leaving the previous song's buffer playing. */}
            <MasteringPlayer
              key={playing.url}
              masterUrl={playing.url}
              sourceUrl={playing.sourceUrl}
              title={library?.find((x) => x.id === playing.id)?.title || 'Master'}
              afterTp={library?.find((x) => x.id === playing.id)?.afterTp ?? null}
              onExpired={() => {
                setRowError({
                  id: playing.id,
                  message: 'That playback link expired — press play again to get a fresh one.',
                });
                setPlaying(null);
              }}
              onPrev={neighbours.prev ? () => void playSaved(neighbours.prev!) : undefined}
              onNext={neighbours.next ? () => void playSaved(neighbours.next!) : undefined}
              useRegionLabel="Use for the short"
              onUseRegion={(r) => {
                // Clamped to what a short may be, and reported rather than
                // silently adjusted — a drag is approximate, and a region the
                // operator thinks they set is worse than one they were told
                // about.
                const raw = Math.max(0, r.end - r.start);
                const seconds = Math.min(
                  SHORT_PICK_MAX_SECONDS,
                  Math.max(SHORT_PICK_MIN_SECONDS, Math.round(raw))
                );
                // Stamped with the master being auditioned, so it can never
                // be offered to a different song.
                setShortWindow({ jobId: playing.id, startSec: Math.round(r.start * 10) / 10, seconds });
                setAnnounce(
                  seconds === Math.round(raw)
                    ? `Short window set to ${seconds}s from ${formatTime(r.start)}.`
                    : `Short window set to ${seconds}s from ${formatTime(r.start)} — ` +
                      `a short must be ${SHORT_PICK_MIN_SECONDS}-${SHORT_PICK_MAX_SECONDS}s.`
                );
              }}
            />
          </div>
        )}
      </section>

      {busy && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Leaving this page will not stop the work — it re-attaches when you return.
        </p>
      )}
    </div>
  );
}
