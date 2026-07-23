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

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { FlaskConical, Loader2, Plus, Trash2, Lightbulb } from 'lucide-react';
import { adminFetch } from '@/lib/client-auth';
import { MediaUploadField } from '@/components/admin/MediaUploadField';
import {
  GENERATION_ENGINES,
  GENERATION_VERDICTS,
  FAILURE_REASONS,
  loudnessSchema,
  type Generation,
  type GenerationVerdict,
  type AudioMetricsRecord,
  type LoudnessRecord,
} from '@/types/generation';
import { computeInsights, type InsightsReport } from '@/lib/generation-insights';
import { TAMIL_VOCAL_AXES, MAX_AXIS_SCORE, scoreTamilVocal, type TamilVocalScores } from '@/lib/tamil-vocal-rubric';
import { streamingNormVerdict, type LoudnessStatus } from '@/lib/loudness-targets';
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
  // The cross-brief feed of ALL logged generations — powers the insights panel,
  // independent of which brief is selected.
  const [allGenerations, setAllGenerations] = useState<Generation[]>([]);
  // True when the insights feed hit the server cap — insights then cover only
  // the most-recent slice, so we say so instead of understating silently.
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [briefsRes, gensRes] = await Promise.all([
          adminFetch('/api/admin/briefs?limit=500'),
          // The WHOLE log (paged server-side), so insights reflect every attempt
          // — not a silent 200-row slice.
          adminFetch('/api/admin/generations?all=true'),
        ]);
        const briefsBody = await briefsRes.json().catch(() => ({}));
        if (!briefsRes.ok || !briefsBody.success) throw new Error(briefsBody.error || `HTTP ${briefsRes.status}`);
        const gensBody = await gensRes.json().catch(() => ({}));
        if (alive) {
          setBriefs(briefsBody.data ?? []);
          if (gensRes.ok && gensBody.success) {
            setAllGenerations(gensBody.data ?? []);
            setTruncated(Boolean(gensBody.truncated));
          }
        }
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

  const briefsById = useMemo(
    () => Object.fromEntries(briefs.map((b) => [b.id, b])),
    [briefs]
  );
  const insights = useMemo(() => computeInsights(allGenerations, briefsById), [allGenerations, briefsById]);

  const handleSaved = useCallback((gen: Generation) => {
    setAllGenerations((prev) => [gen, ...prev]);
    setGenerations((prev) => (gen.briefId === selectedId ? [gen, ...prev] : prev));
  }, [selectedId]);

  const handleDelete = useCallback(async (gen: Generation) => {
    // Optimistic: drop from both lists, remembering each original index so a
    // failed delete restores the card to its place (not jammed at the top).
    const restore = (idx: number, prev: Generation[]) =>
      idx < 0 ? [gen, ...prev] : [...prev.slice(0, idx), gen, ...prev.slice(idx)];
    let genIdx = -1;
    let allIdx = -1;
    setGenerations((prev) => {
      genIdx = prev.findIndex((g) => g.id === gen.id);
      return prev.filter((g) => g.id !== gen.id);
    });
    setAllGenerations((prev) => {
      allIdx = prev.findIndex((g) => g.id === gen.id);
      return prev.filter((g) => g.id !== gen.id);
    });
    try {
      const res = await adminFetch(`/api/admin/generations/${gen.id}?briefId=${encodeURIComponent(gen.briefId)}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setGenerations((prev) => restore(genIdx, prev));
      setAllGenerations((prev) => restore(allIdx, prev));
    }
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

      {truncated && (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200">
          Showing the most recent {allGenerations.length.toLocaleString()} generations — older ones aren&apos;t included in these stats.
        </div>
      )}

      {/* Insights — derived from ALL logged generations */}
      <InsightsPanel report={insights} />

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
          <LogGenerationForm brief={selectedBrief} onSaved={handleSaved} />

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
                  <GenerationCard key={g.id} g={g} onDelete={handleDelete} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

const AXES = ['melody', 'vocals', 'lyrics', 'mix'] as const;

/** "What's working" panel derived from all logged generations. */
function InsightsPanel({ report: r }: { report: InsightsReport }) {
  const pct = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)}%`);
  const reliableStyles = r.byStyle.filter((s) => s.reliable).slice(0, 3);
  const reliableVoices = r.byVoice.filter((s) => s.reliable).slice(0, 3);
  const reliableModels = r.byModel.filter((s) => s.reliable).slice(0, 3);
  // Engine VERSION hit-rate — shows a vendor model change moving quality.
  const reliableVersions = r.byEngineVersion.filter((s) => s.reliable).slice(0, 4);
  const scoredAxes = AXES.filter((a) => r.scoreContrast[a].gap != null);

  return (
    <section
      aria-label="Insights"
      className="rounded-xl border border-amber-200 bg-amber-50/60 p-5 dark:border-amber-900/40 dark:bg-amber-900/10"
    >
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
        <Lightbulb className="h-4 w-4" aria-hidden /> Insights — {r.total} logged
      </h2>

      <ul className="space-y-1.5">
        {r.recommendations.map((rec, i) => (
          <li key={i} className="flex gap-2 text-sm text-gray-800 dark:text-gray-200">
            <span aria-hidden className="text-amber-500">▸</span>
            <span>{rec}</span>
          </li>
        ))}
      </ul>

      {r.total > 0 && (
        <div className="mt-4 grid gap-4 text-xs text-gray-600 sm:grid-cols-2 dark:text-gray-300">
          <div>
            <p className="mb-1 font-semibold uppercase tracking-wide text-gray-400">Outcomes</p>
            <p>✅ {r.byVerdict.success} · 🟡 {r.byVerdict.partial} · ❌ {r.byVerdict.failed} — <strong>{pct(r.successRate)}</strong> hit rate</p>
          </div>
          {r.failureReasons.length > 0 && (
            <div>
              <p className="mb-1 font-semibold uppercase tracking-wide text-gray-400">Top failure reasons</p>
              <p>{r.failureReasons.slice(0, 3).map((f) => `${f.reason.replace(/_/g, ' ')} (${f.count})`).join(' · ')}</p>
            </div>
          )}
          {reliableStyles.length > 0 && (
            <div>
              <p className="mb-1 font-semibold uppercase tracking-wide text-gray-400">Style hit-rate</p>
              <p>{reliableStyles.map((s) => `${s.key} ${pct(s.rate)} (${s.total})`).join(' · ')}</p>
            </div>
          )}
          {reliableVoices.length > 0 && (
            <div>
              <p className="mb-1 font-semibold uppercase tracking-wide text-gray-400">Voice hit-rate</p>
              <p>{reliableVoices.map((s) => `${s.key} ${pct(s.rate)} (${s.total})`).join(' · ')}</p>
            </div>
          )}
          {reliableModels.length > 0 && (
            <div>
              <p className="mb-1 font-semibold uppercase tracking-wide text-gray-400">Model hit-rate</p>
              <p>{reliableModels.map((s) => `${s.key} ${pct(s.rate)} (${s.total})`).join(' · ')}</p>
            </div>
          )}
          {reliableVersions.length > 0 && (
            <div>
              <p className="mb-1 font-semibold uppercase tracking-wide text-gray-400">Engine version hit-rate</p>
              <p>{reliableVersions.map((s) => `${s.key} ${pct(s.rate)} (${s.total})`).join(' · ')}</p>
            </div>
          )}
          {scoredAxes.length > 0 && (
            <div>
              <p className="mb-1 font-semibold uppercase tracking-wide text-gray-400">Avg score — keepers / rejects</p>
              <p>{scoredAxes.map((a) => `${a} ${r.scoreContrast[a].success?.toFixed(1) ?? '—'}/${r.scoreContrast[a].failed?.toFixed(1) ?? '—'}`).join(' · ')}</p>
            </div>
          )}
          {(r.audioContrast.lufs.success != null || r.audioContrast.crest.success != null) && (
            <div>
              <p className="mb-1 font-semibold uppercase tracking-wide text-gray-400">Measured audio — keepers / rejects</p>
              <p>
                {r.audioContrast.lufs.success != null && `LUFS ${r.audioContrast.lufs.success.toFixed(1)}/${r.audioContrast.lufs.failed?.toFixed(1) ?? '—'}`}
                {r.audioContrast.crest.success != null && ` · crest ${r.audioContrast.crest.success.toFixed(1)}/${r.audioContrast.crest.failed?.toFixed(1) ?? '—'} dB`}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function GenerationCard({ g, onDelete }: { g: Generation; onDelete: (g: Generation) => void }) {
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
        <button
          type="button"
          onClick={() => { if (window.confirm('Delete this logged generation?')) onDelete(g); }}
          aria-label="Delete generation"
          className="rounded p-1 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
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

      {(g.settings?.weirdness != null || g.settings?.styleInfluence != null || g.settings?.engineModel || g.settings?.voiceLabel || g.settings?.customModel || (g.stemRevisions?.length ?? 0) > 0) && (
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400">
          {g.settings?.engineModel && <span>{g.settings.engineModel}</span>}
          {g.settings?.weirdness != null && <span>weirdness {g.settings.weirdness}</span>}
          {g.settings?.styleInfluence != null && <span>style {g.settings.styleInfluence}</span>}
          {g.settings?.voiceLabel && <span>voice {g.settings.voiceLabel}</span>}
          {g.settings?.customModel && <span>model {g.settings.customModel}</span>}
          {(g.stemRevisions?.length ?? 0) > 0 && <span>{g.stemRevisions.length} stem revision{g.stemRevisions.length === 1 ? '' : 's'}</span>}
        </div>
      )}

      {g.loudness ? <LoudnessRow l={g.loudness} /> : g.audioMetrics ? <AudioMetricsRow m={g.audioMetrics} /> : null}

      {g.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">{g.notes}</p>}
      {g.audioUrl && (
        <audio controls preload="none" src={g.audioUrl} className="mt-3 w-full">
          <track kind="captions" />
        </audio>
      )}
    </li>
  );
}

const STATUS_BADGE: Record<LoudnessStatus, string> = {
  ok: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300',
  hot: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  quiet: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300',
};

/** Measured sound-engineering metrics + streaming-loudness compliance. */
function AudioMetricsRow({ m }: { m: AudioMetricsRecord }) {
  const v = m.lufsIntegrated != null ? streamingNormVerdict(m.lufsIntegrated) : null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-300">
      <span className="font-semibold uppercase tracking-wide text-gray-400">Measured</span>
      {m.lufsIntegrated != null && <span><strong className="tabular-nums">{m.lufsIntegrated}</strong> LUFS</span>}
      <span>peak <strong className="tabular-nums">{m.peakDbfs}</strong> dBFS</span>
      <span>crest <strong className="tabular-nums">{m.crestDb}</strong> dB</span>
      {m.clipPct > 0 && <span className="text-red-600 dark:text-red-400">clip {m.clipPct}%</span>}
      {v && (
        <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_BADGE[v.status]}`} title={v.label}>
          {v.status === 'ok' ? 'on target (−14)' : v.status === 'hot' ? `+${v.deltaLu} LU hot` : `${v.deltaLu} LU quiet`}
        </span>
      )}
    </div>
  );
}

const LOUDNESS_VERDICT_BADGE: Record<LoudnessRecord['verdict'], string> = {
  ok: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300',
  hot: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  quiet: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300',
  'clip-risk': 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
  squashed: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
};

/** Server-measured loudness (measure-fn) — badge + verdict + key metrics. */
function LoudnessRow({ l }: { l: LoudnessRecord }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-300">
      <span className="font-semibold uppercase tracking-wide text-gray-400">Measured</span>
      <span><strong className="tabular-nums">{l.lufs}</strong> LUFS</span>
      <span>true-peak <strong className="tabular-nums">{l.truePeak}</strong> dBTP</span>
      <span>crest <strong className="tabular-nums">{l.crest}</strong> dB</span>
      <span className={`rounded-full px-2 py-0.5 font-medium ${LOUDNESS_VERDICT_BADGE[l.verdict]}`} title={`verdict: ${l.verdict}`}>
        {l.badge}
      </span>
      {(l.verdict === 'clip-risk' || l.verdict === 'squashed') && (
        <span className="text-amber-600 dark:text-amber-400">⚠ {l.verdict}</span>
      )}
    </div>
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
  // The prompt text actually submitted. Prefilled from the chosen variant, but
  // EDITABLE — hunting for wording that still lands means hand-tweaking before
  // pasting, and an unrecorded tweak makes the attempt unreproducible.
  const [promptText, setPromptText] = useState('');
  const [promptDirty, setPromptDirty] = useState(false);
  // Tamil A/B fields — collapsed by default so ordinary logging is unchanged.
  const [tamilVocal, setTamilVocal] = useState<TamilVocalScores>({});
  const [lyricScript, setLyricScript] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [weirdness, setWeirdness] = useState('');
  const [styleInfluence, setStyleInfluence] = useState('');
  const [engineModel, setEngineModel] = useState('');
  const [voiceLabel, setVoiceLabel] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [stemRevisionsText, setStemRevisionsText] = useState('');
  const [melody, setMelody] = useState('');
  const [vocals, setVocals] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [mix, setMix] = useState('');
  const [verdict, setVerdict] = useState<GenerationVerdict>('failed');
  const [failureReason, setFailureReason] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Reset the form when the brief changes (don't leak one brief's draft into another).
  useEffect(() => {
    setChosenStyle((brief.analysis?.suno_prompts?.[0]?.style) ?? '');
    setPromptText((brief.analysis?.suno_prompts?.[0]?.prompt) ?? '');
    setPromptDirty(false);
    setTamilVocal({}); setLyricScript('');
    setEngine('suno');
    setAudioUrl(''); setWeirdness(''); setStyleInfluence(''); setEngineModel('');
    setVoiceLabel(''); setCustomModel(''); setStemRevisionsText('');
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
      voiceLabel: voiceLabel.trim() || undefined,
      customModel: customModel.trim() || undefined,
    };
    // One stem revision per line: trim, drop empties, cap at 24 (schema limit).
    const stemRevisions = stemRevisionsText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 24);

    // Measure loudness SERVER-side (measure-fn via /api/admin/music-lab/measure)
    // — the browser never fetches the audio, so there's no CORS dependency.
    // Best-effort: a failure just logs the take without loudness.
    let loudness: LoudnessRecord | null = null;
    if (audioUrl) {
      setMeasuring(true);
      try {
        const s3Key = new URL(audioUrl, window.location.origin).pathname.replace(/^\/+/, '');
        const mr = await adminFetch('/api/admin/music-lab/measure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ s3Key }),
        });
        const mj = (await mr.json().catch(() => ({}))) as { success?: boolean; metrics?: Omit<LoudnessRecord, 'badge' | 'verdict'>; badge?: string; verdict?: LoudnessRecord['verdict'] };
        if (mr.ok && mj.success && mj.metrics && mj.badge && mj.verdict) {
          // Validate against the SAME schema the API enforces before attaching.
          // A drifted/partial measure-fn payload must not ride along, or the
          // whole POST would 400 — defeating the best-effort intent. On any
          // mismatch we simply log the take without loudness.
          const measured = loudnessSchema.safeParse({ ...mj.metrics, badge: mj.badge, verdict: mj.verdict });
          if (measured.success) loudness = measured.data;
        }
      } catch {
        /* best-effort — log the take without loudness */
      }
      setMeasuring(false);
    }

    const payload = {
      briefId: brief.id,
      engine,
      chosenStyle: chosenStyle || undefined,
      promptText: promptText.trim() || undefined,
      tamilVocal: Object.keys(tamilVocal).length ? tamilVocal : undefined,
      lyricScript: lyricScript || undefined,
      audioUrl: audioUrl || undefined,
      settings,
      scores,
      stemRevisions,
      verdict,
      // A success carries no failure reason (server enforces this too).
      failureReason: verdict === 'success' ? undefined : failureReason || undefined,
      notes: notes.trim(),
      ...(loudness ? { loudness } : {}),
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
      setVoiceLabel(''); setCustomModel(''); setStemRevisionsText('');
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
            <select
              value={chosenStyle}
              onChange={(e) => {
                setChosenStyle(e.target.value);
                // Follow the variant's prompt unless the user has hand-edited —
                // never silently discard their wording.
                if (!promptDirty) {
                  const v = brief.analysis?.suno_prompts?.find((p) => p.style === e.target.value);
                  setPromptText(v?.prompt ?? '');
                }
              }}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
            >
              {styles.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : (
            <input value={chosenStyle} onChange={(e) => setChosenStyle(e.target.value)} placeholder="optional" className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />
          )}
        </label>
      </div>

      <label className="mt-4 flex flex-col gap-1 text-sm font-medium text-gray-700 dark:text-gray-200">
        Style prompt actually used
        <span className="text-xs font-normal text-gray-400">
          Prefilled from the variant — edit it to match exactly what you pasted, so this
          attempt is reproducible and comparable{promptDirty && ' · edited'}
        </span>
        <textarea
          value={promptText}
          onChange={(e) => { setPromptText(e.target.value); setPromptDirty(true); }}
          rows={3}
          placeholder="The style/instrumentation/tempo text submitted to the engine"
          className="rounded-md border border-gray-300 px-3 py-2 font-mono text-xs dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
        />
      </label>

      <details className="mt-4 rounded-md border border-gray-200 p-3 dark:border-gray-700">
        <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-200">
          Tamil pronunciation scoring
          <span className="ml-2 text-xs font-normal text-gray-400">
            for engine / prompt comparisons — leave closed for ordinary logging
          </span>
        </summary>

        <label className="mt-3 flex flex-col gap-1 text-sm font-medium text-gray-700 dark:text-gray-200">
          Lyrics submitted as
          <select
            value={lyricScript}
            onChange={(e) => setLyricScript(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
          >
            <option value="">— not recorded —</option>
            <option value="tamil">Tamil script (தமிழ்)</option>
            <option value="romanized">Romanized</option>
          </select>
        </label>

        <div className="mt-3 space-y-3">
          {TAMIL_VOCAL_AXES.map((axis) => (
            <div key={axis.key}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{axis.label}</span>
                <span className="text-xs text-gray-400">{axis.probes.join(' · ')}</span>
              </div>
              <p className="text-xs text-gray-400">{axis.why}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {Array.from({ length: MAX_AXIS_SCORE + 1 }, (_, n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() =>
                      setTamilVocal((prev) => {
                        const next = { ...prev };
                        if (next[axis.key] === n) delete next[axis.key];
                        else next[axis.key] = n;
                        return next;
                      })
                    }
                    aria-pressed={tamilVocal[axis.key] === n}
                    title={axis.anchors[n]}
                    className={`rounded px-2 py-1 text-xs ${
                      tamilVocal[axis.key] === n
                        ? 'bg-orange-600 text-white'
                        : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                    }`}
                  >
                    {n}
                  </button>
                ))}
                {typeof tamilVocal[axis.key] === 'number' && (
                  <span className="self-center pl-2 text-xs text-gray-500 dark:text-gray-400">
                    {axis.anchors[tamilVocal[axis.key] as number]}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {(() => {
          const r = scoreTamilVocal(tamilVocal);
          if (r.verdict === null) {
            return (
              <p className="mt-3 text-xs text-gray-400">
                Scored {r.scored}/{r.total} axes — score retroflex, vowel length and gemination for a verdict.
              </p>
            );
          }
          return (
            <p className="mt-3 text-xs text-gray-600 dark:text-gray-300">
              Composite <strong>{r.composite}</strong> · intelligibility <strong>{r.intelligibility}</strong> ·{' '}
              <strong>{r.verdict}</strong>
              <span className="ml-1 text-gray-400">(verdict is gated on intelligibility, not the composite)</span>
            </p>
          );
        })()}
      </details>

      <div className="mt-4">
        <MediaUploadField kind="audio" label="Audio" value={audioUrl} onChange={setAudioUrl} helpText="Upload the generated MP3, or paste a URL. Optional — you can rate before the audio is back." />
      </div>

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

      {/* Advanced — kept collapsed to keep the default log fast, but rendered in
          the DOM so its fields stay accessible (and test-queryable). */}
      <details className="group mt-4 rounded-lg border border-gray-200 dark:border-gray-800">
        <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Advanced (settings · voice · model · stems · scores)
        </summary>
        <div className="border-t border-gray-200 px-3 py-3 dark:border-gray-800">
          <fieldset>
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
                Engine version
                <input value={engineModel} onChange={(e) => setEngineModel(e.target.value)} placeholder="engine version, e.g. suno v5.5" className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-300">
                Voice
                <input value={voiceLabel} onChange={(e) => setVoiceLabel(e.target.value)} placeholder="verified voice (blank = generic)" className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-300">
                Custom Model
                <input value={customModel} onChange={(e) => setCustomModel(e.target.value)} placeholder="idiom label, e.g. devotional-pathos" className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />
              </label>
            </div>
          </fieldset>

          <label htmlFor={`${idp}-stems`} className="mt-4 flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-300">
            Stem revisions
            <span className="font-normal text-gray-400">One stem re-performance / Stem-Cover note per line (up to 24).</span>
            <textarea id={`${idp}-stems`} value={stemRevisionsText} onChange={(e) => setStemRevisionsText(e.target.value)} rows={3} placeholder={'re-sang lead vocal\nreplaced flute with veena\ntightened kick'} className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />
          </label>

          <fieldset className="mt-4">
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Scores (0–10)</legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {scoreInput('Melody', melody, setMelody)}
              {scoreInput('Vocals', vocals, setVocals)}
              {scoreInput('Lyrics', lyrics, setLyrics)}
              {scoreInput('Mix', mix, setMix)}
            </div>
          </fieldset>
        </div>
      </details>

      {formError && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{formError}</p>}

      <div className="mt-4">
        <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
          {measuring ? 'Analyzing audio…' : saving ? 'Saving…' : 'Log generation'}
        </button>
      </div>
    </form>
  );
}
