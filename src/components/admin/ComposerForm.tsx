'use client';

/**
 * Lyrics → production brief. Pastes lyrics, calls the admin compose API,
 * renders structured cards (emotion / mood / theme / key / BPM /
 * instruments / titles / style prompt / YouTube description). Each long
 * text block has a copy button so the brief can be pasted straight into
 * the generator or YouTube Studio.
 *
 * UX notes:
 *  - Real <form> so Cmd/Ctrl+Enter submits (browsers don't submit on plain
 *    Enter from a textarea — explicit keydown handler covers that).
 *  - Last successful result is preserved when a subsequent compose fails,
 *    so the admin doesn't lose work to a transient error.
 *  - Results region is aria-live="polite" so screen readers announce when
 *    the brief lands.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { Copy, Check, Sparkles, RotateCw } from 'lucide-react';
import { adminFetch } from '@/lib/client-auth';
import { PromptReadiness } from '@/components/admin/PromptReadiness';
import { PromptExport } from '@/components/admin/PromptExport';
import { WordPalette } from '@/components/admin/WordPalette';
// type-only import — erased at build, so the server-only composer module
// (which pulls the Anthropic SDK) is never bundled into this client component.
import type { ComposerAnalysis } from '@/services/ai/composer';

type Analysis = ComposerAnalysis;

const MAX_LYRICS = 8000;
const WARN_AT = 7500;
// Compose now runs as an async job (the worker Lambda generates the Sonnet brief
// off-Amplify). Poll the job until it's done; the worker caps at 120s.
const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 130_000;

/** Sleep that resolves early if the request is aborted (unmount / supersede). */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

export function ComposerForm() {
  const [lyrics, setLyrics] = useState('');
  // The lyrics the CURRENT result was composed from — snapshotted on success so
  // the readiness/export/save reflect the brief, not later textarea edits.
  const [composedLyrics, setComposedLyrics] = useState('');
  const [result, setResult] = useState<Analysis | null>(null);
  // The single "going with this variant" choice, shared by the variant cards,
  // the the generator export and Save brief. Reset to the first variant per compose.
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Whether the last error is worth retrying. Auth / not-configured failures are
  // not — retrying just fails again, so we hide the Retry control for them.
  const [retryable, setRetryable] = useState(true);
  const [loading, setLoading] = useState(false);
  // Bumped on every successful compose; used to key <SaveBrief> so it remounts
  // fresh per brief (otherwise its "Saved ✓" / chosen-style state leaks across
  // a Regenerate and the new brief can't be saved).
  const [runId, setRunId] = useState(0);
  const lyricsId = useId();

  // Abort an in-flight compose on unmount (the call is ~30s) and guard against
  // setState-after-unmount in the finally/catch.
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  // The lyrics textarea, so the word palette can insert at the caret.
  const lyricsRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const run = async () => {
    setError(null);
    setRetryable(true);
    // NOTE: we intentionally do NOT clear `result` here — keeps the last
    // successful brief on-screen if this call fails.
    setLoading(true);
    abortRef.current?.abort(); // supersede any prior in-flight call
    const controller = new AbortController();
    abortRef.current = controller;
    // Snapshot the lyrics being composed so the result is tied to these exact
    // lyrics even if the textarea is edited afterwards.
    const sent = lyrics;
    try {
      // 1. Enqueue the job. Auth/validation failures come back as a normal
      //    non-ok JSON response; success returns a job id to poll.
      const res = await adminFetch('/api/admin/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lyrics: sent }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const { jobId } = (await res.json()) as { jobId?: string };
      if (!jobId) throw new Error('The server did not start the job.');

      // 2. Poll until the worker finishes (Sonnet generates ~30-40s off-platform).
      //    Poll immediately, then wait between polls — so an already-finished job
      //    resolves at once.
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      let data: Analysis | undefined;
      for (;;) {
        if (controller.signal.aborted || !mountedRef.current) return;
        const sres = await adminFetch(`/api/admin/compose/${jobId}`, { signal: controller.signal });
        if (!sres.ok) {
          const body = await sres.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${sres.status}`);
        }
        const body = (await sres.json()) as {
          status?: string;
          result?: Analysis;
          error?: { code?: string; message?: string };
        };
        if (body.status === 'done' && body.result) {
          data = body.result;
          break;
        }
        if (body.status === 'error') {
          throw Object.assign(new Error(body.error?.message || 'Compose failed'), { code: body.error?.code });
        }
        if (Date.now() > deadline) {
          throw new Error('Composing is taking longer than expected. Please try again.');
        }
        await delay(POLL_INTERVAL_MS, controller.signal);
      }

      if (!mountedRef.current) return;
      setResult(data);
      setComposedLyrics(sent); // tie the brief to the exact lyrics it used
      setSelectedIdx(0); // default to the first variant for the new brief
      setRunId((n) => n + 1); // fresh <SaveBrief> for the new brief
    } catch (err) {
      // A superseded/unmounted request isn't a user-facing error.
      if (controller.signal.aborted || !mountedRef.current) return;
      const code = (err as { code?: string })?.code;
      setRetryable(code !== 'auth' && code !== 'not_configured');
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current && abortRef.current === controller) setLoading(false);
    }
  };

  const canRun = lyrics.trim().length > 0 && !loading;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canRun) run();
  };

  // Cmd/Ctrl+Enter submits without the user mousing to the button.
  const onTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canRun) {
      e.preventDefault();
      run();
    }
  };

  // Insert a palette word at the caret (or append), keeping focus + caret sane.
  const insertWord = (word: string) => {
    const el = lyricsRef.current;
    if (!el) {
      setLyrics((p) => (p ? `${p} ${word}` : word).slice(0, MAX_LYRICS));
      return;
    }
    const start = el.selectionStart ?? lyrics.length;
    const end = el.selectionEnd ?? lyrics.length;
    // Pad with a space when butting up against an existing word.
    const before = lyrics.slice(0, start);
    const needsLead = before.length > 0 && !/\s$/.test(before);
    const insert = (needsLead ? ' ' : '') + word;
    const next = (before + insert + lyrics.slice(end)).slice(0, MAX_LYRICS);
    setLyrics(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = Math.min(start + insert.length, next.length);
      el.setSelectionRange(pos, pos);
    });
  };

  const charsClass =
    lyrics.length >= MAX_LYRICS
      ? 'text-red-600 dark:text-red-400'
      : lyrics.length >= WARN_AT
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-gray-500 dark:text-gray-400';

  return (
    <div className="space-y-6">
      {/* Input */}
      <form
        onSubmit={onSubmit}
        className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900"
      >
        <label htmlFor={lyricsId} className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-200">
          Tamil lyrics
        </label>
        <textarea
          id={lyricsId}
          ref={lyricsRef}
          value={lyrics}
          maxLength={MAX_LYRICS}
          onChange={(e) => setLyrics(e.target.value)}
          onKeyDown={onTextareaKeyDown}
          placeholder="இங்கே பாடல் வரிகளை ஒட்டவும் (Paste Tamil lyrics here)… Cmd/Ctrl+Enter to compose."
          rows={10}
          className="w-full rounded-lg border border-gray-300 px-4 py-3 font-tamil text-sm leading-relaxed focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className={`text-xs tabular-nums ${charsClass}`}>
            {lyrics.length.toLocaleString()} / {MAX_LYRICS.toLocaleString()} chars
          </p>
          <div className="flex items-center gap-3">
            {loading && (
              <span className="text-xs text-gray-500 dark:text-gray-400">~30–45s</span>
            )}
            <button
              type="submit"
              disabled={!canRun}
              className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                <Sparkles className="h-4 w-4" aria-hidden />
              )}
              {loading ? 'Composing…' : 'Compose brief'}
            </button>
          </div>
        </div>
        <WordPalette lyrics={lyrics} onInsertWord={insertWord} />
      </form>

      {error && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
          <span className="flex-1">{error}</span>
          {retryable && (
            <button
              type="button"
              onClick={run}
              disabled={!canRun}
              className="inline-flex items-center gap-1 rounded border border-red-300 px-2 py-1 text-xs font-medium hover:bg-red-100 disabled:opacity-50 dark:border-red-700 dark:hover:bg-red-900/30"
            >
              <RotateCw className="h-3 w-3" /> Retry
            </button>
          )}
        </div>
      )}

      {result && (
        <section
          aria-label="Composer results"
          aria-live="polite"
          data-testid="composer-results"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Result
            </h2>
            <button
              type="button"
              onClick={run}
              disabled={!canRun}
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <RotateCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Regenerate
            </button>
          </div>
          <Results result={result} lyrics={composedLyrics} selectedIdx={selectedIdx} onSelectIdx={setSelectedIdx} />
          <SaveBrief
            key={`${runId}-${selectedIdx}`}
            lyrics={composedLyrics}
            result={result}
            chosenStyle={result.suno_prompts[selectedIdx]?.style ?? result.suno_prompts[0]?.style ?? ''}
          />
        </section>
      )}
    </div>
  );
}

/**
 * Persist the brief as the durable source of truth (Phase 2). Captures the
 * admin's decision — which style they're going with — as a signal for the
 * catalogue/taste knowledge base. Idempotent-ish: each click saves a new brief.
 */
function SaveBrief({ lyrics, result, chosenStyle }: { lyrics: string; result: Analysis; chosenStyle: string }) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setState('saving');
    setError(null);
    try {
      const res = await adminFetch('/api/admin/briefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lyrics,
          analysis: result,
          decision: chosenStyle ? { chosenSunoStyle: chosenStyle } : {},
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
      setState('saved');
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/60">
      <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Save this brief</span>
      {chosenStyle && (
        <span className="text-xs text-gray-500 dark:text-gray-400">
          going with: <strong className="font-medium text-gray-700 dark:text-gray-200">{chosenStyle}</strong>
        </span>
      )}
      <button
        type="button"
        onClick={save}
        disabled={state === 'saving' || state === 'saved'}
        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved ✓' : 'Save brief'}
      </button>
      {state === 'error' && (
        <span role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</span>
      )}
    </div>
  );
}

function Chips({ items, tamil }: { items: string[]; tamil?: boolean }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((it, i) => (
        <li
          key={`${i}-${it}`}
          className={`rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-800 dark:bg-orange-500/20 dark:text-orange-300 ${tamil ? 'font-tamil' : ''}`}
        >
          {it}
        </li>
      ))}
    </ul>
  );
}

function Results({ result, lyrics, selectedIdx, onSelectIdx }: { result: Analysis; lyrics: string; selectedIdx: number; onSelectIdx: (i: number) => void }) {
  const reelCopy = [result.reel.hook, result.reel.caption, result.reel.hashtags.join(' ')]
    .filter(Boolean)
    .join('\n\n');

  return (
    <div className="space-y-4">
      {/* Quick-stat grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Emotion" value={result.emotion} tamil />
        <Stat label="Mood" value={result.mood} />
        <Stat label="Theme" value={result.theme} />
        <Stat label="Key" value={result.suggested_key} />
        <Stat label="BPM" value={String(result.suggested_bpm)} />
      </div>

      {/* Emotional breakdown — ranked, most→least present (no scores: an LLM
          can't produce calibrated probabilities, so we never show fake %). */}
      {result.emotion_breakdown.length > 1 && (
        <Card label="Emotional breakdown (ranked)">
          <ol className="flex flex-wrap items-center gap-2">
            {result.emotion_breakdown.map((e, i) => (
              <li key={`${i}-${e}`} className="flex items-center gap-2">
                {i > 0 && <span aria-hidden className="text-gray-400">›</span>}
                <span className="rounded-full bg-orange-100 px-3 py-1 font-tamil text-xs font-medium text-orange-800 dark:bg-orange-500/20 dark:text-orange-300">
                  {e}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {/* Instruments — grounded in the India/Sri Lanka catalog */}
      {result.suggested_instruments.length > 0 && (
        <Card label="Instruments">
          <Chips items={result.suggested_instruments} />
        </Card>
      )}

      {/* Suggested ragas (ranked) — grounded in the Carnatic/Hindustani catalog */}
      {result.suggested_ragas && result.suggested_ragas.length > 0 && (
        <Card label="Suggested ragas (ranked)">
          <ol className="flex flex-wrap items-center gap-2">
            {result.suggested_ragas.map((r, i) => (
              <li key={`${i}-${r}`} className="flex items-center gap-2">
                {i > 0 && <span aria-hidden className="text-gray-400">›</span>}
                <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-800 dark:bg-orange-500/20 dark:text-orange-300">
                  {r}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {/* Recommended voice — ranked best fit first */}
      {result.recommended_voice.length > 0 && (
        <Card label="Recommended voice (ranked)">
          <Chips items={result.recommended_voice} />
        </Card>
      )}

      {/* Title suggestions */}
      {result.song_titles.length > 0 && (
        <Card label="Title suggestions">
          <ul className="space-y-2">
            {result.song_titles.map((t, i) => (
              <li key={`${i}-${t}`} className="flex items-center justify-between gap-3 rounded-md bg-gray-50 px-3 py-2 dark:bg-gray-800/60">
                <span className="font-tamil text-sm text-gray-900 dark:text-gray-100">{t}</span>
                <CopyButton text={t} ariaLabel={`Copy title: ${t}`} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Style-variant prompts (generator-format under the hood) — one card each */}
      {result.suno_prompts.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Tamilagaval prompts — {result.suno_prompts.length} styles
          </h3>
          {result.suno_prompts.map((v, i) => {
            const selected = i === selectedIdx;
            return (
              <div key={`${i}-${v.style}`} className={`rounded-xl ${selected ? 'ring-2 ring-orange-500' : ''}`}>
                <Card label={`🎵 ${v.style}`} copyText={v.prompt}>
                  <label className="mb-2 flex w-fit cursor-pointer items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-300">
                    <input
                      type="radio"
                      name="suno-variant"
                      checked={selected}
                      onChange={() => onSelectIdx(i)}
                      className="accent-orange-600"
                    />
                    {selected ? 'Going with this ✓' : 'Use this variant'}
                  </label>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{v.prompt}</p>
                  <PromptReadiness style={v.prompt} lyrics={lyrics} />
                </Card>
              </div>
            );
          })}
          <PromptExport result={result} lyrics={lyrics} selectedIdx={selectedIdx} onSelectIdx={onSelectIdx} />
        </div>
      )}

      {/* Thumbnail (image-gen) prompt */}
      {result.thumbnail_prompt && (
        <Card label="Thumbnail prompt (image-gen)" copyText={result.thumbnail_prompt}>
          <p className="text-sm text-gray-700 dark:text-gray-300">{result.thumbnail_prompt}</p>
        </Card>
      )}

      {/* YouTube description — Tamil */}
      {result.youtube_description_tamil && (
        <Card label="YouTube description — தமிழ்" copyText={result.youtube_description_tamil}>
          <p className="whitespace-pre-wrap font-tamil text-sm text-gray-700 dark:text-gray-300">{result.youtube_description_tamil}</p>
        </Card>
      )}

      {/* YouTube description — English */}
      {result.youtube_description_english && (
        <Card label="YouTube description — English" copyText={result.youtube_description_english}>
          <p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">{result.youtube_description_english}</p>
        </Card>
      )}

      {/* Reel / Short idea */}
      {(result.reel.hook || result.reel.caption || result.reel.hashtags.length > 0) && (
        <Card label="Reel / Short" copyText={reelCopy}>
          <div className="space-y-2">
            {result.reel.hook && (
              <p className="font-tamil text-base font-medium text-gray-900 dark:text-gray-100">{result.reel.hook}</p>
            )}
            {result.reel.caption && (
              <p className="text-sm text-gray-700 dark:text-gray-300">{result.reel.caption}</p>
            )}
            {result.reel.hashtags.length > 0 && <Chips items={result.reel.hashtags} />}
          </div>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, tamil }: { label: string; value: string; tamil?: boolean }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100 ${tamil ? 'font-tamil' : ''}`}>
        {value || '—'}
      </p>
    </div>
  );
}

function Card({ label, children, copyText }: { label: string; children: React.ReactNode; copyText?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</h3>
        {copyText && <CopyButton text={copyText} ariaLabel={`Copy ${label.toLowerCase()}`} />}
      </div>
      {children}
    </div>
  );
}

function CopyButton({ text, ariaLabel }: { text: string; ariaLabel: string }) {
  const [copied, setCopied] = useState(false);
  // Track the timeout so we can cancel on unmount — avoids a setState
  // after-unmount warning in dev + the tiny memory leak in prod.
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — silently ignore */ }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={ariaLabel}
      className="inline-flex h-7 w-7 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-orange-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}
