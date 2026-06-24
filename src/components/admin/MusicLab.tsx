'use client';

/**
 * Music Lab (Phase 1) — log every SUNO/engine generation against its brief and
 * evaluate it, so failed attempts become a research dataset (not deleted MP3s).
 *
 * Workflow: pick a saved brief → log each attempt (audio + settings + 0–10
 * scores + verdict + failure reason + notes). SUNO has no API, so capture is a
 * manual upload+rate; the form pre-fills what it can from the brief (style
 * variants) and the rest is the human's call. Attempts list newest-first.
 */

import { useCallback, useEffect, useId, useState } from 'react';
import { FlaskConical, Loader2, Plus } from 'lucide-react';
import { adminFetch } from '@/lib/client-auth';
import { MediaUploadField } from '@/components/admin/MediaUploadField';
import {
  GENERATION_ENGINES,
  GENERATION_VERDICTS,
  FAILURE_REASONS,
  type Generation,
  type GenerationVerdict,
} from '@/types/generation';
import type { SavedBrief } from '@/types/brief';

function briefLabel(b: SavedBrief): string {
  const title = b.analysis?.song_titles?.[0];
  const firstLyric = b.lyrics?.split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 36);
  const date = b.createdAt?.slice(0, 10) ?? '';
  return `${title || firstLyric || 'Untitled brief'}${date ? ` · ${date}` : ''}`;
}

const VERDICT_BADGE: Record<GenerationVerdict, string> = {
  success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300',
  partial: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
};

export function MusicLab() {
  const [briefs, setBriefs] = useState<SavedBrief[]>([]);
  const [loadingBriefs, setLoadingBriefs] = useState(true);
  const [selectedId, setSelectedId] = useState('');
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [loadingGens, setLoadingGens] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await adminFetch('/api/admin/briefs?limit=200');
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
        if (alive) setBriefs(body.data ?? []);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (alive) setLoadingBriefs(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const loadGenerations = useCallback(async (briefId: string) => {
    if (!briefId) {
      setGenerations([]);
      return;
    }
    setLoadingGens(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/generations?briefId=${encodeURIComponent(briefId)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
      setGenerations(body.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingGens(false);
    }
  }, []);

  useEffect(() => {
    loadGenerations(selectedId);
  }, [selectedId, loadGenerations]);

  const selectedBrief = briefs.find((b) => b.id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
          <FlaskConical className="h-6 w-6 text-orange-600" aria-hidden /> Music Lab
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-500 dark:text-gray-400">
          Log every generation against its brief — keepers <em>and</em> failures — with audio, engine settings, 0–10
          scores, a verdict, and what went wrong. Over time this becomes a Tamil-music dataset: which emotion × raga ×
          voice combinations actually work, and why the rest don&apos;t.
        </p>
      </header>

      {/* Brief picker */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <label htmlFor="ml-brief" className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-200">
          Brief
        </label>
        {loadingBriefs ? (
          <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading briefs…</p>
        ) : briefs.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No saved briefs yet. Create one in the <strong>Music Director</strong>, save it, then log generations here.
          </p>
        ) : (
          <select
            id="ml-brief"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
          >
            <option value="">— Select a brief —</option>
            {briefs.map((b) => (
              <option key={b.id} value={b.id} className="font-tamil">
                {briefLabel(b)}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
          {error}
        </div>
      )}

      {selectedBrief && (
        <>
          <LogGenerationForm
            brief={selectedBrief}
            onSaved={(gen) => setGenerations((prev) => [gen, ...prev])}
          />

          <section aria-label="Logged generations">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Attempts {loadingGens ? '' : `(${generations.length})`}
            </h2>
            {loadingGens ? (
              <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
            ) : generations.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No generations logged for this brief yet.</p>
            ) : (
              <ul className="space-y-3">
                {generations.map((g) => (
                  <GenerationCard key={g.id} g={g} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function GenerationCard({ g }: { g: Generation }) {
  const scoreEntries = Object.entries(g.scores ?? {}).filter(([, v]) => typeof v === 'number');
  return (
    <li className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${VERDICT_BADGE[g.verdict]}`}>{g.verdict}</span>
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{g.engine}</span>
        {g.chosenStyle && <span className="text-xs text-gray-500 dark:text-gray-400">· {g.chosenStyle}</span>}
        {g.failureReason && (
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            {g.failureReason.replace(/_/g, ' ')}
          </span>
        )}
        <span className="ml-auto text-xs text-gray-400">{g.createdAt?.slice(0, 16).replace('T', ' ')}</span>
      </div>

      {scoreEntries.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-600 dark:text-gray-300">
          {scoreEntries.map(([k, v]) => (
            <span key={k}>
              <span className="capitalize text-gray-400">{k}</span> <strong className="tabular-nums">{v}/10</strong>
            </span>
          ))}
        </div>
      )}

      {(g.settings?.weirdness != null || g.settings?.styleInfluence != null || g.settings?.engineModel) && (
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400">
          {g.settings?.engineModel && <span>{g.settings.engineModel}</span>}
          {g.settings?.weirdness != null && <span>weirdness {g.settings.weirdness}</span>}
          {g.settings?.styleInfluence != null && <span>style {g.settings.styleInfluence}</span>}
        </div>
      )}

      {g.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">{g.notes}</p>}
      {g.audioUrl && (
        <audio controls preload="none" src={g.audioUrl} className="mt-3 w-full">
          <track kind="captions" />
        </audio>
      )}
    </li>
  );
}

/** Parse a number input; '' → undefined so empties aren't sent as 0. */
function numOrUndef(v: string): number | undefined {
  if (v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function LogGenerationForm({ brief, onSaved }: { brief: SavedBrief; onSaved: (g: Generation) => void }) {
  const idp = useId();
  const styles = brief.analysis?.suno_prompts?.map((p) => p.style) ?? [];

  const [engine, setEngine] = useState<string>('suno');
  const [chosenStyle, setChosenStyle] = useState<string>(styles[0] ?? '');
  const [audioUrl, setAudioUrl] = useState('');
  const [weirdness, setWeirdness] = useState('');
  const [styleInfluence, setStyleInfluence] = useState('');
  const [engineModel, setEngineModel] = useState('');
  const [melody, setMelody] = useState('');
  const [vocals, setVocals] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [mix, setMix] = useState('');
  const [verdict, setVerdict] = useState<GenerationVerdict>('failed');
  const [failureReason, setFailureReason] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Reset the form when the brief changes (don't leak one brief's draft into another).
  useEffect(() => {
    setChosenStyle((brief.analysis?.suno_prompts?.[0]?.style) ?? '');
    setEngine('suno');
    setAudioUrl(''); setWeirdness(''); setStyleInfluence(''); setEngineModel('');
    setMelody(''); setVocals(''); setLyrics(''); setMix('');
    setVerdict('failed'); setFailureReason(''); setNotes(''); setFormError(null);
  }, [brief.id, brief.analysis?.suno_prompts]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);

    const scores = {
      melody: numOrUndef(melody),
      vocals: numOrUndef(vocals),
      lyrics: numOrUndef(lyrics),
      mix: numOrUndef(mix),
    };
    const settings = {
      weirdness: numOrUndef(weirdness),
      styleInfluence: numOrUndef(styleInfluence),
      engineModel: engineModel.trim() || undefined,
    };
    const payload = {
      briefId: brief.id,
      engine,
      chosenStyle: chosenStyle || undefined,
      audioUrl: audioUrl || undefined,
      settings,
      scores,
      verdict,
      // A success carries no failure reason (server enforces this too).
      failureReason: verdict === 'success' ? undefined : failureReason || undefined,
      notes: notes.trim(),
    };

    try {
      const res = await adminFetch('/api/admin/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
      onSaved(body.data as Generation);
      // Keep engine/style; clear the per-attempt fields for the next log.
      setAudioUrl(''); setWeirdness(''); setStyleInfluence('');
      setMelody(''); setVocals(''); setLyrics(''); setMix('');
      setFailureReason(''); setNotes('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const scoreInput = (label: string, value: string, set: (v: string) => void) => (
    <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-300">
      {label}
      <input
        type="number" min={0} max={10} step={1} value={value}
        onChange={(e) => set(e.target.value)}
        className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
      />
    </label>
  );

  return (
    <form onSubmit={submit} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        <Plus className="h-4 w-4" aria-hidden /> Log a generation
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700 dark:text-gray-200">
          Engine
          <select value={engine} onChange={(e) => setEngine(e.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100">
            {GENERATION_ENGINES.map((en) => <option key={en} value={en}>{en}</option>)}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-gray-700 dark:text-gray-200">
          Style variant {styles.length === 0 && <span className="text-xs font-normal text-gray-400">(brief has none)</span>}
          {styles.length > 0 ? (
            <select value={chosenStyle} onChange={(e) => setChosenStyle(e.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100">
              {styles.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : (
            <input value={chosenStyle} onChange={(e) => setChosenStyle(e.target.value)} placeholder="optional" className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />
          )}
        </label>
      </div>

      <div className="mt-4">
        <MediaUploadField kind="audio" label="Audio" value={audioUrl} onChange={setAudioUrl} helpText="Upload the generated MP3, or paste a URL. Optional — you can rate before the audio is back." />
      </div>

      <fieldset className="mt-4">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Settings</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-300">
            Weirdness (0–100)
            <input type="number" min={0} max={100} value={weirdness} onChange={(e) => setWeirdness(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-300">
            Style influence (0–100)
            <input type="number" min={0} max={100} value={styleInfluence} onChange={(e) => setStyleInfluence(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-300">
            Engine/model
            <input value={engineModel} onChange={(e) => setEngineModel(e.target.value)} placeholder="e.g. suno v4.5" className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />
          </label>
        </div>
      </fieldset>

      <fieldset className="mt-4">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Scores (0–10)</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {scoreInput('Melody', melody, setMelody)}
          {scoreInput('Vocals', vocals, setVocals)}
          {scoreInput('Lyrics', lyrics, setLyrics)}
          {scoreInput('Mix', mix, setMix)}
        </div>
      </fieldset>

      <fieldset className="mt-4">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Verdict</legend>
        <div className="flex flex-wrap gap-4">
          {GENERATION_VERDICTS.map((v) => (
            <label key={v} className="flex items-center gap-2 text-sm capitalize text-gray-700 dark:text-gray-200">
              <input type="radio" name={`${idp}-verdict`} value={v} checked={verdict === v} onChange={() => setVerdict(v)} className="accent-orange-600" />
              {v}
            </label>
          ))}
        </div>
      </fieldset>

      {verdict !== 'success' && (
        <label className="mt-4 flex flex-col gap-1 text-sm font-medium text-gray-700 dark:text-gray-200">
          Primary issue
          <select value={failureReason} onChange={(e) => setFailureReason(e.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm sm:w-64 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100">
            <option value="">— none —</option>
            {FAILURE_REASONS.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
      )}

      <label htmlFor={`${idp}-notes`} className="mt-4 flex flex-col gap-1 text-sm font-medium text-gray-700 dark:text-gray-200">
        Notes
        <textarea id={`${idp}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="What worked, what failed (e.g. excellent flute intro, weak chorus transition)…" className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />
      </label>

      {formError && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{formError}</p>}

      <div className="mt-4">
        <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
          {saving ? 'Saving…' : 'Log generation'}
        </button>
      </div>
    </form>
  );
}
