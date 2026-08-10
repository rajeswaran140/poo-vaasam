'use client';

/**
 * Lyric Critic — the admin UI for POST /api/admin/compose/critique
 * (the poet's own draft → structured feedback). The augment-the-craft
 * counterpart to <LyricGeneratorForm>: it never writes or rewrites, it coaches.
 * Paste a draft, optionally steer the focus, get honest feedback to act on.
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import {
  SearchCheck, MessageCircleQuestion, Copy, Check, Download,
  Save, FolderOpen, History, Plus, ChevronDown, CheckCircle2,
} from 'lucide-react';
import { adminFetch } from '@/lib/client-auth';
import { pollJob } from '@/lib/poll-job';
import { critiqueToMarkdown, confidenceWord } from '@/lib/critique-markdown';
import type { IssueType } from '@/services/ai/lyricCriticSchema';

/** Faults first, deliberate choices last — same order as the exported report. */
const ISSUE_RANK: Record<IssueType, number> = {
  likely_error: 0,
  possible_issue: 1,
  artistic_choice: 2,
};
import { feedbackProgress } from '@/lib/lyric-draft-feedback';
import { LyricDraftEditor } from '@/components/admin/LyricDraftEditor';
import { LyricAssistPanel } from '@/components/admin/LyricAssistPanel';
import { wordAt } from '@/lib/lyric-word-inspect';
import type { LexiconWord } from '@/types/lexicon';
import {
  AUTOSAVE_DEBOUNCE_MS,
  shouldAutosave,
  autosaveStatus,
  shouldOfferRestore,
} from '@/lib/lyric-autosave';
import { TamilProsodyPanel } from '@/components/admin/TamilProsodyPanel';
import { exportFilename } from '@/lib/prompt-export';
import type { LyricCritique, CritiqueAspect } from '@/services/ai/lyricCriticSchema';
import type { LyricDraftSummary, LyricDraftVersion, LyricDraft } from '@/types/lyricDraft';

const ASPECTS: CritiqueAspect[] = ['meter', 'imagery', 'vocabulary', 'emotion', 'originality', 'structure'];

// The critique runs off-Amplify in the worker (~60-90s); the route returns a job
// id and we poll until it's done. Ceiling generously above the worst worker run
// (which is itself bounded by the service's 110s client timeout + the Lambda).
const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 170_000;

export function LyricCriticForm() {
  const [lyrics, setLyrics] = useState('');
  const [focus, setFocus] = useState<CritiqueAspect[]>([]);
  const [notes, setNotes] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LyricCritique | null>(null);
  const [copied, setCopied] = useState(false);

  // ---- Draft management (lazy: nothing fetches until the panel is opened) ----
  const [draftId, setDraftId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [versions, setVersions] = useState<LyricDraftVersion[]>([]);
  const [drafts, setDrafts] = useState<LyricDraftSummary[]>([]);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [draftsLoaded, setDraftsLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  // The exact text that produced `result` — only then do we file the critique
  // with the saved version (so an edited-after-critique save doesn't mislabel).
  const [critiquedText, setCritiquedText] = useState<string | null>(null);

  // ---- Flow & words assist (pure, no LLM on the render path) ----
  const [selectedWord, setSelectedWord] = useState('');
  const [lexicon, setLexicon] = useState<LexiconWord[]>([]);

  /**
   * Lexicon, fetched the first time the assist panel is opened — best-effort.
   * Lazy for the same reason the drafts panel is: nothing should fetch until
   * looked at. The panel degrades to singability-only without it, so a failure
   * must never block writing.
   */
  async function loadLexicon() {
    try {
      const res = await adminFetch('/api/admin/lexicon');
      const json = (await res.json().catch(() => ({}))) as { success?: boolean; data?: LexiconWord[] };
      if (res.ok && json.success) setLexicon(json.data ?? []);
    } catch {
      /* assist panel still works without it */
    }
  }

  /** Replace the word under the caret with a chosen one. Never automatic. */
  function useWord(replacement: string) {
    const el = document.getElementById('critic-lyrics') as HTMLTextAreaElement | null;
    const caret = el ? el.selectionStart : lyrics.length;
    const target = wordAt(lyrics, caret);
    if (!target) return;
    const start = lyrics.lastIndexOf(target, caret);
    if (start < 0) return;
    setLyrics(lyrics.slice(0, start) + replacement + lyrics.slice(start + target.length));
    setSelectedWord(replacement);
  }

  // ---- Autosave (working copy; versions stay an explicit act) ----
  const [savedWorking, setSavedWorking] = useState<string | null>(null);
  const [autosaving, setAutosaving] = useState(false);
  const [autosaveFailed, setAutosaveFailed] = useState(false);
  const [restorable, setRestorable] = useState<string | null>(null);

  // One-click "add to lexicon" on word ideas — grow the personal atlas from drafting.
  const [addedWords, setAddedWords] = useState<Set<string>>(new Set());
  const [addingWord, setAddingWord] = useState<string | null>(null);

  // Feedback loop: the latest saved version's critique vs. the current text.
  const priorCritique = versions.length ? versions[versions.length - 1].critique : null;
  const progress = useMemo(() => feedbackProgress(priorCritique, lyrics), [priorCritique, lyrics]);

  // Abort an in-flight critique on unmount / supersede (the job is ~50-70s) and
  // guard against setState-after-unmount.
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const canSubmit = lyrics.trim().length > 0 && !loading;

  function toggleFocus(a: CritiqueAspect) {
    setFocus((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));
  }

  async function copyMarkdown() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(critiqueToMarkdown(result));
      setCopied(true);
      setTimeout(() => { if (mountedRef.current) setCopied(false); }, 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  function downloadMarkdown() {
    if (!result) return;
    const blob = new Blob([critiqueToMarkdown(result)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFilename('lyric-critique', 'md');
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleSubmit() {
    setError(null);
    setResult(null);
    setLoading(true);
    abortRef.current?.abort(); // supersede any prior in-flight critique
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const payload = {
        lyrics: lyrics.trim(),
        focus,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };
      // 1. Enqueue the job — returns 202 { jobId } (or a non-ok JSON error).
      const res = await adminFetch('/api/admin/compose/critique', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const enq = (await res.json().catch(() => ({}))) as { success?: boolean; jobId?: string; error?: string };
      if (!res.ok || !enq.success || !enq.jobId) {
        throw new Error(enq.error || `Critique failed (${res.status})`);
      }

      // 2. Poll until the worker finishes (off-Amplify, ~50-70s).
      const critique = await pollJob<LyricCritique>({
        fetchStatus: (signal) => adminFetch(`/api/admin/compose/critique/${enq.jobId}`, { signal }),
        signal: controller.signal,
        isMounted: () => mountedRef.current,
        intervalMs: POLL_INTERVAL_MS,
        timeoutMs: POLL_TIMEOUT_MS,
        timeoutMessage: 'The critique is taking longer than expected. Please try again.',
      });
      if (critique === undefined || !mountedRef.current) return; // superseded / unmounted
      setResult(critique);
      setCritiquedText(payload.lyrics); // the text this critique belongs to
    } catch (err) {
      if (controller.signal.aborted || !mountedRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      // Only clear loading if THIS run is still the current one — a superseded
      // run must not flip the spinner off under a newer in-flight critique.
      if (mountedRef.current && abortRef.current === controller) setLoading(false);
    }
  }

  // ---- Draft actions ----
  async function loadDraftsList() {
    try {
      const res = await adminFetch('/api/admin/lyric-drafts');
      const json = (await res.json().catch(() => ({}))) as { success?: boolean; drafts?: LyricDraftSummary[] };
      if (res.ok && json.success) setDrafts(json.drafts ?? []);
      setDraftsLoaded(true);
    } catch {
      setDraftsLoaded(true);
    }
  }

  function toggleDrafts() {
    setDraftsOpen((open) => {
      if (!open && !draftsLoaded) void loadDraftsList();
      return !open;
    });
  }

  const autosaveInput = { draftId, text: lyrics, savedWorking, saving: saving || autosaving };
  const saveStatus = autosaveStatus(autosaveInput, autosaveFailed);

  /**
   * Debounced autosave into the draft's WORKING COPY.
   *
   * PATCH, not a new version: versions are deliberate and carry the critique
   * they were judged against, so autosaving into them would bury real revisions
   * under keystroke snapshots. Only fires on an existing draft — a new one needs
   * a title, and inventing one would fill the library with "Untitled".
   */
  useEffect(() => {
    if (!shouldAutosave(autosaveInput)) return;
    const t = setTimeout(async () => {
      setAutosaving(true);
      try {
        const res = await adminFetch(`/api/admin/lyric-drafts/${draftId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workingLyrics: lyrics }),
        });
        if (!res.ok) throw new Error('autosave failed');
        setSavedWorking(lyrics);
        setAutosaveFailed(false);
      } catch {
        // Never surface as a blocking error — the text is still in the editor.
        setAutosaveFailed(true);
      } finally {
        setAutosaving(false);
      }
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lyrics, draftId, savedWorking, saving, autosaving]);

  /** Warn before losing text that autosave has not yet written. */
  useEffect(() => {
    if (saveStatus !== 'dirty') return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [saveStatus]);

  /** Load a version's snapshot into the editor (text + steering + its critique). */
  function applyVersion(v: LyricDraftVersion) {
    setLyrics(v.lyrics);
    setFocus(v.focus ?? []);
    setNotes(v.notes ?? '');
    setResult(v.critique);
    setCritiquedText(v.critique ? v.lyrics : null);
    setError(null);
  }

  async function openDraft(id: string) {
    setDraftError(null);
    try {
      const res = await adminFetch(`/api/admin/lyric-drafts/${id}`);
      const json = (await res.json().catch(() => ({}))) as { success?: boolean; draft?: LyricDraft; error?: string };
      if (!res.ok || !json.success || !json.draft) throw new Error(json.error || 'Could not open draft');
      const d = json.draft;
      setDraftId(d.id);
      setTitle(d.title);
      setVersions(d.versions);
      setSaveMsg(null);
      const latest = d.versions[d.versions.length - 1];
      if (latest) applyVersion(latest);
      // A working copy newer than the last filed version = unsaved work from a
      // previous sitting. Offer it rather than silently overwriting either way.
      setSavedWorking(d.workingLyrics ?? null);
      setAutosaveFailed(false);
      setRestorable(shouldOfferRestore(d.workingLyrics, latest?.lyrics ?? '') ? d.workingLyrics! : null);
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : 'Could not open draft');
    }
  }

  function newDraft() {
    setDraftId(null);
    setTitle('');
    setVersions([]);
    setLyrics('');
    setFocus([]);
    setNotes('');
    setResult(null);
    setCritiquedText(null);
    setSaveMsg(null);
    setDraftError(null);
    setError(null);
  }

  async function saveDraft() {
    if (!lyrics.trim() || saving) return;
    if (!draftId && !title.trim()) {
      setDraftError('Give the draft a title before saving.');
      return;
    }
    setSaving(true);
    setDraftError(null);
    setSaveMsg(null);
    // Only file the critique with this version if it matches the current text.
    const critique = result && critiquedText === lyrics.trim() ? result : undefined;
    const payload = { lyrics: lyrics.trim(), focus, ...(notes.trim() ? { notes: notes.trim() } : {}), ...(critique ? { critique } : {}) };
    try {
      const url = draftId ? `/api/admin/lyric-drafts/${draftId}/versions` : '/api/admin/lyric-drafts';
      const res = await adminFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftId ? payload : { ...payload, title: title.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as { success?: boolean; draft?: LyricDraft; error?: string };
      if (!res.ok || !json.success || !json.draft) throw new Error(json.error || 'Could not save draft');
      const d = json.draft;
      setDraftId(d.id);
      setVersions(d.versions);
      setSaveMsg(`Saved v${d.latestVersion}`);
      // Keep the drafts list fresh (newest first) if it's been loaded.
      setDrafts((prev) => {
        const summary: LyricDraftSummary = {
          id: d.id, title: d.title, theme: d.theme, status: d.status,
          latestVersion: d.latestVersion, snippet: lyrics.trim().split('\n')[0] ?? '', updatedAt: d.updatedAt,
        };
        return [summary, ...prev.filter((x) => x.id !== d.id)];
      });
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : 'Could not save draft');
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }

  /** Capture a suggested word into the personal lexicon (gloss/register refined
   *  later in /admin/lexicon). 409 (already there) counts as success. */
  async function addToLexicon(word: string) {
    const w = word.trim();
    if (!w || addedWords.has(w) || addingWord) return;
    setAddingWord(w);
    try {
      const res = await adminFetch('/api/admin/lexicon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: w, gloss: '—', register: 'literary', usage: 'fresh', themes: [] }),
      });
      if (res.ok || res.status === 409) setAddedWords((prev) => new Set(prev).add(w));
    } catch {
      /* best-effort — leave the + so the poet can retry */
    } finally {
      if (mountedRef.current) setAddingWord(null);
    }
  }

  const inputCls =
    'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-purple-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

  const nextVersion = (versions.length ? versions[versions.length - 1].version : 0) + 1;

  return (
    <div className="space-y-5">
      {/* ---- Draft workspace toolbar ---- */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900/40">
        <input
          aria-label="Draft title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          placeholder={draftId ? 'Draft title' : 'Title this draft to save it…'}
          className={`min-w-[12rem] flex-1 ${inputCls}`}
        />
        <button
          type="button"
          onClick={saveDraft}
          disabled={!lyrics.trim() || saving}
          className="flex items-center gap-1.5 rounded-lg bg-gray-800 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-white"
        >
          <Save className="h-4 w-4" /> {saving ? 'Saving…' : draftId ? `Save v${nextVersion}` : 'Save draft'}
        </button>
        {draftId && (
          <button
            type="button"
            onClick={newDraft}
            className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <Plus className="h-4 w-4" /> New
          </button>
        )}
        <button
          type="button"
          onClick={toggleDrafts}
          aria-expanded={draftsOpen}
          className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          <FolderOpen className="h-4 w-4" /> Saved drafts
          <ChevronDown className={`h-4 w-4 transition-transform ${draftsOpen ? 'rotate-180' : ''}`} />
        </button>
        {saveMsg && (
          <span className="flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> {saveMsg}
          </span>
        )}
        {draftError && <span role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">{draftError}</span>}
      </div>

      {/* ---- Drafts + version history (lazy-loaded) ---- */}
      {draftsOpen && (
        <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900/40">
          {!draftsLoaded ? (
            <p className="text-sm text-gray-400">Loading drafts…</p>
          ) : drafts.length === 0 ? (
            <p className="text-sm text-gray-400">No saved drafts yet — title a draft above and hit Save.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {drafts.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => openDraft(d.id)}
                    className={`rounded-lg border px-3 py-1.5 text-left text-sm transition-colors ${
                      draftId === d.id
                        ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/30'
                        : 'border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'
                    }`}
                    title={d.snippet}
                  >
                    <span className="font-medium text-gray-900 dark:text-gray-100">{d.title}</span>
                    <span className="ml-1.5 text-xs text-gray-400">v{d.latestVersion} · {d.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {draftId && versions.length > 0 && (
            <div className="border-t border-gray-100 pt-2.5 dark:border-gray-800">
              <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <History className="h-3.5 w-3.5" /> Versions of “{title}”
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {versions.map((v) => (
                  <li key={v.version}>
                    <button
                      type="button"
                      onClick={() => applyVersion(v)}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                      title={v.critique ? 'Has a saved critique' : 'No critique saved'}
                    >
                      v{v.version}
                      {v.critique && <span className="ml-1 text-green-600 dark:text-green-400">✓</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ---- Feedback loop: did the rework address the last critique? ---- */}
      {progress && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800/60 dark:bg-amber-900/15">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            Feedback loop · you’ve reworked {progress.addressed} of {progress.total} flagged line
            {progress.total === 1 ? '' : 's'} from the last saved critique
            {progress.remaining.length === 0 && ' — all addressed 🎉'}
          </p>
          {progress.remaining.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {progress.remaining.map((r, i) => (
                <li key={i} className="text-xs text-amber-800 dark:text-amber-300">
                  <span className="font-tamil">{r.line}</span> — {r.issue}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

    <div className="grid gap-6 lg:grid-cols-2">
      {/* ---- Draft input ---- */}
      <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900/40">
        <div>
          {restorable && (
            <div className="mb-2 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
              <span>Unsaved work from a previous sitting was found.</span>
              <button
                type="button"
                onClick={() => { setLyrics(restorable); setRestorable(null); }}
                className="rounded bg-amber-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-amber-700"
              >
                Restore it
              </button>
              <button
                type="button"
                onClick={() => setRestorable(null)}
                className="text-xs underline"
              >
                Keep the saved version
              </button>
            </div>
          )}
          <label htmlFor="critic-lyrics" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Your draft <span className="text-red-500">*</span>
            <span className="ml-1 text-xs font-normal text-gray-400">(paste your own lyric — feedback only, never rewritten)</span>
          </label>
          <LyricDraftEditor
            id="critic-lyrics"
            value={lyrics}
            onChange={setLyrics}
            onCaret={(caret) => setSelectedWord(wordAt(lyrics, caret))}
            rows={14}
            maxLength={8000}
            placeholder={'பல்லவி\nஉங்கள் சொந்த வரிகளை இங்கே எழுதுங்கள்…'}
            status={saveStatus}
          />
          <div className="mt-3">
            <LyricAssistPanel
              lyrics={lyrics}
              selectedWord={selectedWord}
              lexicon={lexicon}
              onUseWord={useWord}
              onFirstOpen={loadLexicon}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Focus <span className="text-xs font-normal text-gray-400">(optional — weight the feedback)</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {ASPECTS.map((a) => {
              const on = focus.includes(a);
              return (
                <button
                  key={a}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleFocus(a)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors ${
                    on
                      ? 'border-purple-500 bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-200'
                      : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
                  }`}
                >
                  {a}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label htmlFor="critic-notes" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Notes <span className="text-xs font-normal text-gray-400">(optional — what do you want feedback on?)</span>
          </label>
          <textarea
            id="critic-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="e.g. Does the charanam carry the same ache as the pallavi?"
            className={`mt-1 ${inputCls}`}
          />
        </div>

        {/* Deterministic meter & rhyme — live, no AI call needed. */}
        <TamilProsodyPanel lyrics={lyrics} />

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SearchCheck className="h-4 w-4" /> {loading ? 'Reading…' : 'Critique my draft'}
        </button>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{error}</p>
        )}
      </div>

      {/* ---- Critique ---- */}
      <div aria-live="polite" className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900/40">
        {!result ? (
          <p className="text-sm text-gray-400">
            The feedback will appear here — an honest read, strengths, slack lines (with the reason, not a rewrite), word
            ideas to weigh, and questions to push your thinking. Your words stay yours.
          </p>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={copyMarkdown}
                className="flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copied' : 'Copy Markdown'}
              </button>
              <button
                type="button"
                onClick={downloadMarkdown}
                className="flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <Download className="h-3.5 w-3.5" /> .md
              </button>
            </div>
            <p className="text-sm text-gray-800 dark:text-gray-200">{result.overall}</p>

            {result.strengths.length > 0 && (
              <CritiqueBlock title="Strengths">
                <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700 dark:text-gray-300">
                  {result.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </CritiqueBlock>
            )}

            {result.observations.length > 0 && (
              <CritiqueBlock title="Observations">
                <ul className="space-y-2">
                  {result.observations.map((o, i) => (
                    <li key={i} className="text-sm text-gray-700 dark:text-gray-300">
                      <span className="mr-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium capitalize text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                        {o.aspect}
                      </span>
                      {o.note}
                    </li>
                  ))}
                </ul>
              </CritiqueBlock>
            )}

            {result.slackLines.length > 0 && (
              <CritiqueBlock title="Lines worth a second look">
                <ul className="space-y-2">
                  {/* Faults first, deliberate choices last — an artistic_choice
                      note must not read with the weight of an error. */}
                  {[...result.slackLines]
                    .sort((a, b) => ISSUE_RANK[a.issueType] - ISSUE_RANK[b.issueType])
                    .map((l, i) => (
                      <li
                        key={i}
                        className={`border-l-2 pl-3 text-sm ${
                          l.issueType === 'artistic_choice'
                            ? 'border-purple-300 dark:border-purple-700'
                            : l.issueType === 'likely_error'
                              ? 'border-red-300 dark:border-red-700'
                              : 'border-amber-300 dark:border-amber-700'
                        }`}
                      >
                        <p className="font-tamil text-gray-900 dark:text-gray-100">{l.line}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {l.issue}{' '}
                          <span className="whitespace-nowrap text-gray-400 dark:text-gray-500">
                            ({confidenceWord(l.confidence)} confidence)
                          </span>
                        </p>
                        {l.issueType === 'artistic_choice' && (
                          <p className="mt-0.5 text-xs font-medium text-purple-700 dark:text-purple-300">
                            🎨 reads deliberate — noted, not faulted
                          </p>
                        )}
                        {l.requiresMelodyValidation && (
                          <p className="mt-0.5 text-xs text-blue-700 dark:text-blue-300">
                            🎵 needs the melody to settle — line length alone cannot decide this
                          </p>
                        )}
                        {l.questionForWriter && (
                          <p className="mt-0.5 font-tamil text-xs text-gray-700 dark:text-gray-300">
                            ❓ {l.questionForWriter}
                          </p>
                        )}
                      </li>
                    ))}
                </ul>
              </CritiqueBlock>
            )}

            {result.wordIdeas.length > 0 && (
              <CritiqueBlock title="Word ideas to consider">
                <ul className="space-y-2">
                  {result.wordIdeas.map((w, i) => (
                    <li key={i} className="text-sm text-gray-700 dark:text-gray-300">
                      <span className="font-tamil text-gray-900 dark:text-gray-100">{w.instead_of}</span>
                      <span className="mx-1 text-gray-400">→</span>
                      <span className="inline-flex flex-wrap items-center gap-1.5 align-middle">
                        {w.consider.map((c, j) => {
                          const added = addedWords.has(c.trim());
                          return (
                            <span key={j} className="inline-flex items-center gap-1 rounded-md bg-purple-50 py-0.5 pl-2 pr-1 dark:bg-purple-900/30">
                              <span className="font-tamil text-purple-700 dark:text-purple-300">{c}</span>
                              <button
                                type="button"
                                onClick={() => addToLexicon(c)}
                                disabled={added || addingWord === c.trim()}
                                aria-label={added ? `${c} is in your lexicon` : `Add ${c} to your lexicon`}
                                title={added ? 'In your lexicon' : 'Add to your lexicon'}
                                className="rounded p-0.5 text-purple-500 hover:bg-purple-100 disabled:cursor-default dark:hover:bg-purple-800/40"
                              >
                                {added ? <Check className="h-3 w-3 text-green-600 dark:text-green-400" /> : <Plus className="h-3 w-3" />}
                              </button>
                            </span>
                          );
                        })}
                      </span>
                      <span className="block text-xs text-gray-500 dark:text-gray-400">{w.why}</span>
                      {/* Never hidden behind a toggle: an alternative shown
                          without its cost is how a critic sands originality off
                          a line. */}
                      <span className="mt-0.5 block text-xs text-gray-600 dark:text-gray-400">
                        ⚖️ {w.tradeoff}
                      </span>
                    </li>
                  ))}
                </ul>
              </CritiqueBlock>
            )}

            {result.questions.length > 0 && (
              <CritiqueBlock title="Questions for you">
                <ul className="space-y-1.5">
                  {result.questions.map((q, i) => (
                    <li key={i} className="flex gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-purple-500" /> {q}
                    </li>
                  ))}
                </ul>
              </CritiqueBlock>
            )}
          </div>
        )}
      </div>
    </div>
    </div>
  );
}

function CritiqueBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-purple-600 dark:text-purple-300">{title}</p>
      {children}
    </div>
  );
}
