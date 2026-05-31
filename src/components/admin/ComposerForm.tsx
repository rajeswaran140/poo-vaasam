'use client';

/**
 * Lyrics → production brief. Pastes lyrics, calls the admin compose API,
 * renders structured cards (emotion / mood / theme / key / BPM /
 * instruments / titles / SUNO prompt / YouTube description). Each long
 * text block has a copy button so the brief can be pasted straight into
 * SUNO or YouTube Studio.
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

interface Analysis {
  emotion: string;
  mood: string;
  theme: string;
  suggested_key: string;
  suggested_bpm: number;
  suggested_instruments: string[];
  song_titles: string[];
  suno_prompt: string;
  youtube_description: string;
}

const MAX_LYRICS = 8000;
const WARN_AT = 7500;

export function ComposerForm() {
  const [lyrics, setLyrics] = useState('');
  const [result, setResult] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const lyricsId = useId();

  const run = async () => {
    setError(null);
    // NOTE: we intentionally do NOT clear `result` here — keeps the last
    // successful brief on-screen if this call fails.
    setLoading(true);
    try {
      const res = await adminFetch('/api/admin/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lyrics }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
      setResult(body.data as Analysis);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
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
              <span className="text-xs text-gray-500 dark:text-gray-400">~5–10s</span>
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
      </form>

      {error && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={run}
            disabled={!canRun}
            className="inline-flex items-center gap-1 rounded border border-red-300 px-2 py-1 text-xs font-medium hover:bg-red-100 disabled:opacity-50 dark:border-red-700 dark:hover:bg-red-900/30"
          >
            <RotateCw className="h-3 w-3" /> Retry
          </button>
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
          <Results result={result} />
        </section>
      )}
    </div>
  );
}

function Results({ result }: { result: Analysis }) {
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

      {/* Instruments */}
      {result.suggested_instruments.length > 0 && (
        <Card label="Instruments">
          <ul className="flex flex-wrap gap-2">
            {result.suggested_instruments.map((i) => (
              <li key={i} className="rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-800 dark:bg-orange-500/20 dark:text-orange-300">
                {i}
              </li>
            ))}
          </ul>
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

      {/* SUNO prompt */}
      {result.suno_prompt && (
        <Card label="SUNO prompt" copyText={result.suno_prompt}>
          <p className="text-sm text-gray-700 dark:text-gray-300">{result.suno_prompt}</p>
        </Card>
      )}

      {/* YouTube description */}
      {result.youtube_description && (
        <Card label="YouTube description" copyText={result.youtube_description}>
          <p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">{result.youtube_description}</p>
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
