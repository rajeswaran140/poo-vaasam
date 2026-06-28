'use client';

/**
 * Lyric Critic — the admin UI for POST /api/admin/compose/critique
 * (the poet's own draft → structured feedback). The augment-the-craft
 * counterpart to <LyricGeneratorForm>: it never writes or rewrites, it coaches.
 * Paste a draft, optionally steer the focus, get honest feedback to act on.
 */

import { useState, useRef, useEffect } from 'react';
import { SearchCheck, MessageCircleQuestion } from 'lucide-react';
import { adminFetch } from '@/lib/client-auth';
import type { LyricCritique, CritiqueAspect } from '@/services/ai/lyricCriticSchema';

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
      if (mountedRef.current) setLoading(false);
    }
  }

  const inputCls =
    'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-purple-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

  return (
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
