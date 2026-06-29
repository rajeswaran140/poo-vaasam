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
import { critiqueToMarkdown } from '@/lib/critique-markdown';
import { feedbackProgress } from '@/lib/lyric-draft-feedback';
import { exportFilename } from '@/lib/prompt-export';
import type { LyricCritique, CritiqueAspect } from '@/services/ai/lyricCriticSchema';
import type { LyricDraftSummary, LyricDraftVersion, LyricDraft } from '@/types/lyricDraft';

const ASPECTS: CritiqueAspect[] = ['meter', 'imagery', 'vocabulary', 'emotion', 'originality', 'structure'];

// The critique runs off-Amplify in the worker (~60-90s); the route returns a job
// id and we poll until it's done. Ceiling generously above the worst worker run
// (which is itself bounded by the service's 110s client timeout + the Lambda).
const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 170_000;

/** Sleep that resolves early if the request is aborted (unmount / supersede). */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

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
      setTimeout(() => setCopied(false), 1500);
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
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      for (;;) {
        if (controller.signal.aborted || !mountedRef.current) return;
        const sres = await adminFetch(`/api/admin/compose/critique/${enq.jobId}`, { signal: controller.signal });
        const body = (await sres.json().catch(() => ({}))) as {
          status?: string;
          result?: LyricCritique;
          error?: { code?: string; message?: string };
        };
        if (!sres.ok) throw new Error((body as { error?: string }).error || `HTTP ${sres.status}`);
        if (body.status === 'done' && body.result) {
          if (!mountedRef.current) return;
          setResult(body.result);
          setCritiquedText(payload.lyrics); // the text this critique belongs to
          break;
        }
        if (body.status === 'error') {
          throw new Error(body.error?.message || 'Critique failed');
        }
        if (Date.now() > deadline) {
          throw new Error('The critique is taking longer than expected. Please try again.');
        }
        await delay(POLL_INTERVAL_MS, controller.signal);
      }
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
          <label htmlFor="critic-lyrics" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Your draft <span className="text-red-500">*</span>
            <span className="ml-1 text-xs font-normal text-gray-400">(paste your own lyric — feedback only, never rewritten)</span>
          </label>
          <textarea
            id="critic-lyrics"
            value={lyrics}
            onChange={(e) => setLyrics(e.target.value)}
            rows={14}
            maxLength={8000}
            dir="auto"
            placeholder={'பல்லவி\nஉங்கள் சொந்த வரிகளை இங்கே ஒட்டுங்கள்…'}
            className={`mt-1 font-tamil ${inputCls}`}
          />
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
      <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900/40">
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
              <CritiqueBlock title="Lines that go slack">
                <ul className="space-y-2">
                  {result.slackLines.map((l, i) => (
                    <li key={i} className="border-l-2 border-amber-300 pl-3 text-sm dark:border-amber-700">
                      <p className="font-tamil text-gray-900 dark:text-gray-100">{l.line}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{l.issue}</p>
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
                      <span className="font-tamil text-purple-700 dark:text-purple-300">{w.consider.join('、 ')}</span>
                      <span className="block text-xs text-gray-500 dark:text-gray-400">{w.why}</span>
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
