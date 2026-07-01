'use client';

/**
 * Lyric Generator — the admin UI for POST /api/admin/compose/lyrics
 * (brief → original Tamil lyrics). The inverse of <ComposerForm> (lyrics →
 * brief); the generated lyric is meant to be reviewed, then pasted into the
 * Music Director to produce a production brief.
 *
 * Tamil fields use <TamilInput> (English→Tamil transliteration), matching the
 * rest of the admin authoring surfaces.
 */

import { useState, useEffect, useRef } from 'react';
import { Sparkles, Plus, X, Copy, Check } from 'lucide-react';
import { adminFetch } from '@/lib/client-auth';
import { TamilInput } from '@/components/admin/TamilInput';
import type { Lyrics, LyricRegister } from '@/services/ai/lyricistSchema';

const REGISTERS: LyricRegister[] = ['modern', 'literary', 'village', 'sangam', 'devotional'];
const VOICES = ['Male Baritone', 'Male Tenor', 'Female Adult', 'Young Female', 'Elder Male', 'Child', 'Duet'];
const MAX_EMOTIONS = 5;

/** Format the structured lyric into a plain-text block for copy / paste-to-Composer. */
function lyricToText(l: Lyrics): string {
  const blocks: string[] = [l.title, '', 'பல்லவி', ...l.pallavi];
  if (l.anupallavi.length) blocks.push('', 'அனுபல்லவி', ...l.anupallavi);
  l.charanams.forEach((c, i) => blocks.push('', `சரணம் ${i + 1}`, ...c));
  return blocks.join('\n');
}

export function LyricGeneratorForm() {
  const [theme, setTheme] = useState('');
  const [emotions, setEmotions] = useState<string[]>(['']);
  const [register, setRegister] = useState<LyricRegister>('modern');
  const [voice, setVoice] = useState('');
  const [anupallavi, setAnupallavi] = useState(false);
  const [charanams, setCharanams] = useState(2);
  const [seedWords, setSeedWords] = useState('');
  const [titleHint, setTitleHint] = useState('');
  const [notes, setNotes] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Lyrics | null>(null);
  const [copied, setCopied] = useState(false);

  // Abort an in-flight generation on unmount (~5-15s) and guard setState-after-unmount.
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  // Clear a previously-generated lyric once the brief is edited, so a stale
  // result isn't read as current. (No-op on the initial mount — result is null.)
  useEffect(() => {
    setResult(null);
    setError(null);
  }, [theme, emotions, register, voice, anupallavi, charanams, seedWords, titleHint, notes]);

  const cleanEmotions = emotions.map((e) => e.trim()).filter(Boolean);
  const canSubmit = theme.trim().length > 0 && cleanEmotions.length > 0 && !loading;

  function setEmotionAt(i: number, value: string) {
    setEmotions((prev) => prev.map((e, idx) => (idx === i ? value : e)));
  }
  function addEmotion() {
    setEmotions((prev) => (prev.length < MAX_EMOTIONS ? [...prev, ''] : prev));
  }
  function removeEmotion(i: number) {
    setEmotions((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
  }

  async function handleSubmit() {
    setError(null);
    setResult(null);
    setLoading(true);
    abortRef.current?.abort(); // supersede any prior in-flight generation
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const brief = {
        theme: theme.trim(),
        emotions: cleanEmotions,
        register,
        ...(voice ? { voice } : {}),
        structure: { anupallavi, charanams },
        seedWords: seedWords.split(',').map((w) => w.trim()).filter(Boolean),
        ...(titleHint.trim() ? { titleHint: titleHint.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };
      const res = await adminFetch('/api/admin/compose/lyrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(brief),
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => ({}))) as { success?: boolean; data?: Lyrics; error?: string };
      if (controller.signal.aborted || !mountedRef.current) return; // superseded / unmounted
      if (!res.ok || !body.success || !body.data) {
        throw new Error(body.error || `Generation failed (${res.status})`);
      }
      setResult(body.data);
    } catch (err) {
      if (controller.signal.aborted || !mountedRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current && abortRef.current === controller) setLoading(false);
    }
  }

  async function copyLyric() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(lyricToText(result));
      setCopied(true);
      setTimeout(() => { if (mountedRef.current) setCopied(false); }, 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  const inputCls =
    'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-purple-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* ---- Brief form ---- */}
      <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900/40">
        <TamilInput label="Theme" required value={theme} onChange={setTheme} counterMax={200} placeholder="e.g. Homeland nostalgia / தாய்மண் ஏக்கம்" />

        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Emotions <span className="text-red-500">*</span>
            <span className="ml-1 text-xs font-normal text-gray-400">(ranked most → least)</span>
          </label>
          {emotions.map((emo, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="flex-1">
                <TamilInput value={emo} onChange={(v) => setEmotionAt(i, v)} counterMax={60} placeholder={i === 0 ? 'Dominant emotion, e.g. ஏக்கம்' : 'Next emotion'} />
              </div>
              {emotions.length > 1 && (
                <button type="button" onClick={() => removeEmotion(i)} aria-label={`Remove emotion ${i + 1}`} className="mt-2 rounded p-1 text-gray-400 hover:text-red-500">
                  <X className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>
          ))}
          {emotions.length < MAX_EMOTIONS && (
            <button type="button" onClick={addEmotion} className="flex items-center gap-1 text-xs font-medium text-purple-600 hover:text-purple-700 dark:text-purple-300">
              <Plus className="h-3.5 w-3.5" aria-hidden /> Add emotion
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="lyric-register" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Register</label>
            <select id="lyric-register" value={register} onChange={(e) => setRegister(e.target.value as LyricRegister)} className={`mt-1 ${inputCls}`}>
              {REGISTERS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="lyric-voice" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Voice</label>
            <select id="lyric-voice" value={voice} onChange={(e) => setVoice(e.target.value)} className={`mt-1 ${inputCls}`}>
              <option value="">— any —</option>
              {VOICES.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 items-end gap-3">
          <div>
            <label htmlFor="lyric-charanams" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Charanams</label>
            <input id="lyric-charanams" type="number" min={1} max={5} value={charanams} onChange={(e) => setCharanams(Math.max(1, Math.min(5, Number(e.target.value) || 1)))} className={`mt-1 ${inputCls}`} />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={anupallavi} onChange={(e) => setAnupallavi(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-purple-600" />
            Include anupallavi
          </label>
        </div>

        <div>
          <label htmlFor="lyric-seed" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Seed words <span className="text-xs font-normal text-gray-400">(optional, comma-separated)</span>
          </label>
          <input id="lyric-seed" value={seedWords} onChange={(e) => setSeedWords(e.target.value)} placeholder="மண்வாசம், குருவி, வயல்" className={`mt-1 ${inputCls}`} />
        </div>

        <TamilInput label="Title hint" value={titleHint} onChange={setTitleHint} counterMax={120} placeholder="Optional steer for the title" />

        <div>
          <label htmlFor="lyric-notes" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Notes <span className="text-xs font-normal text-gray-400">(optional)</span></label>
          <textarea id="lyric-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} placeholder="Any extra guidance for the lyric" className={`mt-1 ${inputCls}`} />
        </div>

        <button type="button" onClick={handleSubmit} disabled={!canSubmit} className="flex w-full items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50">
          <Sparkles className="h-4 w-4" aria-hidden /> {loading ? 'Generating…' : 'Generate lyrics'}
        </button>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{error}</p>
        )}
      </div>

      {/* ---- Result ---- */}
      <div aria-live="polite" className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900/40">
        {!result ? (
          <p className="text-sm text-gray-400">The generated lyric will appear here. Review it, then paste into the Music Director to build a production brief.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{result.title}</h3>
              <button type="button" onClick={copyLyric} className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
                {copied ? <Check className="h-3.5 w-3.5 text-green-600" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />} {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <LyricSection heading="பல்லவி" lines={result.pallavi} />
            {result.anupallavi.length > 0 && <LyricSection heading="அனுபல்லவி" lines={result.anupallavi} />}
            {result.charanams.map((c, i) => (
              <LyricSection key={i} heading={`சரணம் ${i + 1}`} lines={c} />
            ))}
            {result.notes && <p className="border-t border-gray-100 pt-3 text-xs italic text-gray-400 dark:border-gray-800">{result.notes}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function LyricSection({ heading, lines }: { heading: string; lines: string[] }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-purple-600 dark:text-purple-300">{heading}</p>
      <div className="mt-1 space-y-0.5">
        {lines.map((line, i) => (
          <p key={i} className="text-sm text-gray-800 dark:text-gray-200">{line}</p>
        ))}
      </div>
    </div>
  );
}
