'use client';

/**
 * Composition Studio Phase 0: the blind listening test.
 *
 * Renders short lines of one song from shippable samples, then Raj compares
 * each render against the same line of the Suno stem, blind and
 * loudness-matched, and scores both. The answer decides whether Phases 1–3
 * are worth building yet.
 *
 * Steps, top to bottom: check the CSP (a `blob:` Worker must start), load,
 * play lines live, prepare the trials (render → upload → measure), listen,
 * summary. Every error renders next to the step or row that caused it.
 *
 * Spec: docs/specs/studio-phase-0-listening-test.md. Throwaway: removed by
 * the Phase 0 cleanup PR.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Play, Square, RotateCw } from 'lucide-react';
import { MasteringComparePlayer } from '@/components/admin/MasteringComparePlayer';
import { uploadToWorkspace } from '@/lib/mastering-upload-client';
import {
  MANIFEST_KEY,
  addRating,
  buildTrials,
  isRevealed,
  lineNotesSchema,
  newSession,
  parseManifest,
  verdict,
  type Instrument,
  type LineNotes,
  type Manifest,
  type Results,
  type Trial,
} from '@/lib/studio-phase0/model';
import { encodeWav16 } from '@/lib/studio-phase0/wav';
import { fetchJson, fetchKey, loadResults, measureLufs, saveResults, workerProbe } from '@/lib/studio-phase0/client';
import type { LoadedPack } from '@/lib/studio-phase0/engine';

/** Loaded lazily: Tone and smplr must never reach another page's bundle. */
const engine = () => import('@/lib/studio-phase0/engine');

type Score = 1 | 2 | 3 | 4 | 5;
type Guess = 'A' | 'B' | 'unsure';
type Step = 'render' | 'upload' | 'measure';
interface PrepRow {
  status: 'waiting' | Step | 'ready' | 'error';
  error?: string;
}
interface LoadItem {
  label: string;
  error?: string;
  done: boolean;
}
interface Violation {
  directive: string;
  blocked: string;
}

const INSTRUMENT_LABEL: Record<Instrument, string> = { flute: 'Flute', violin: 'Violin', percussion: 'Percussion' };

/** Shown only AFTER a trial is rated. */
export function packLabel(packId: string): string {
  if (packId.startsWith('fluidr3-')) return 'FluidR3_GM';
  if (packId.startsWith('vsco2-')) return 'VSCO 2 CE';
  if (packId === 'vcsl-frame-drum') return 'VCSL frame drum';
  if (packId === 'vcsl-darbuka') return 'VCSL darbuka';
  return packId;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const isPrepared = (r: Results, id: string) => {
  const t = r.trials[id];
  return !!t?.renderKey && t.renderLufs !== null && t.stemLufs !== null;
};

function newSeed(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      aria-label={title}
      className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
    >
      <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
      {children}
    </section>
  );
}

const buttonClass =
  'inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800';
const primaryClass =
  'inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50';
const alertClass = 'mt-1 text-xs text-red-700 dark:text-red-400';

function ScoreGroup({
  name,
  value,
  onChange,
}: {
  name: string;
  value: Score | null;
  onChange: (s: Score) => void;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="flex items-center gap-1">
      <span className="mr-2 w-24 text-xs text-gray-600 dark:text-gray-300">{name}</span>
      {([1, 2, 3, 4, 5] as Score[]).map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          onClick={() => onChange(s)}
          className={`h-8 w-8 rounded border text-sm ${
            value === s
              ? 'border-orange-500 bg-orange-50 text-orange-800 dark:bg-orange-500/10 dark:text-orange-300'
              : 'border-gray-300 text-gray-700 dark:border-gray-700 dark:text-gray-300'
          }`}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

export function StudioPhase0() {
  const [probe, setProbe] = useState<'checking' | 'ok' | 'blocked'>('checking');
  const [violations, setViolations] = useState<Violation[]>([]);

  const [loading, setLoading] = useState(false);
  const [loadItems, setLoadItems] = useState<LoadItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const notes = useRef(new Map<string, LineNotes>());
  const packs = useRef(new Map<string, LoadedPack>());

  const [results, setResults] = useState<Results | null>(null);
  const resultsRef = useRef<Results | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [prep, setPrep] = useState<Record<string, PrepRow>>({});
  const [preparing, setPreparing] = useState(false);
  const stemLufs = useRef(new Map<string, number>());

  const [liveKey, setLiveKey] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<Record<string, string>>({});
  const stopLive = useRef<(() => void) | null>(null);

  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [scoreA, setScoreA] = useState<Score | null>(null);
  const [scoreB, setScoreB] = useState<Score | null>(null);
  const [guess, setGuess] = useState<Guess | null>(null);
  const [note, setNote] = useState('');
  const [rateError, setRateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const trials = useMemo<Trial[]>(() => (manifest ? buildTrials(manifest) : []), [manifest]);
  const trialById = useMemo(() => new Map(trials.map((t) => [t.trialId, t])), [trials]);

  useEffect(() => {
    void workerProbe().then((ok) => setProbe(ok ? 'ok' : 'blocked'));
    const onViolation = (e: Event) => {
      const v = e as SecurityPolicyViolationEvent;
      setViolations((list) => [...list, { directive: v.violatedDirective, blocked: v.blockedURI }]);
    };
    document.addEventListener('securitypolicyviolation', onViolation);
    return () => {
      document.removeEventListener('securitypolicyviolation', onViolation);
      stopLive.current?.();
    };
  }, []);

  const commit = useCallback(async (next: Results) => {
    resultsRef.current = next;
    setResults(next);
    try {
      await saveResults(next);
      setSaveError(null);
    } catch (err) {
      setSaveError(message(err));
      throw err;
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const items: LoadItem[] = [];
    const track = async <T,>(label: string, fn: () => Promise<T>): Promise<T | null> => {
      const item: LoadItem = { label, done: false };
      items.push(item);
      setLoadItems([...items]);
      try {
        const out = await fn();
        item.done = true;
        return out;
      } catch (err) {
        item.error = message(err);
        return null;
      } finally {
        setLoadItems([...items]);
      }
    };
    try {
      const m = await track('Manifest', async () => {
        const parsed = parseManifest(await fetchJson(MANIFEST_KEY));
        if (!parsed.ok) throw new Error(parsed.error);
        return parsed.value;
      });
      if (!m) return;
      const { liveContext, loadPack } = await engine();
      const ctx = await liveContext();
      await Promise.all([
        ...m.packs.map((p) =>
          track(`Samples: ${p.packId}`, async () => packs.current.set(p.packId, await loadPack(p, fetchKey, ctx)))
        ),
        ...m.lines.map((l) =>
          track(`Notes: ${l.lineId}`, async () => {
            const parsed = lineNotesSchema.parse(await fetchJson(l.notesKey));
            notes.current.set(l.lineId, parsed);
          })
        ),
      ]);
      const saved = await track('Saved results', () => loadResults());
      if (items.some((i) => i.error)) return;
      const all = buildTrials(m);
      const session = saved ?? newSession(all, newSeed());
      resultsRef.current = session;
      setResults(session);
      setPrep(
        Object.fromEntries(session.order.map((id) => [id, { status: isPrepared(session, id) ? 'ready' : 'waiting' }]))
      );
      setManifest(m);
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const setRow = (id: string, row: PrepRow) => setPrep((p) => ({ ...p, [id]: row }));

  /** Render → upload → measure one trial, resuming from whatever is already saved. */
  const prepareOne = useCallback(
    async (id: string) => {
      const trial = trialById.get(id);
      const line = manifest?.lines.find((l) => l.lineId === trial?.lineId);
      const lineNotes = trial && notes.current.get(trial.lineId);
      const pack = trial && packs.current.get(trial.packId);
      if (!trial || !line || !lineNotes || !pack) return;
      let step: Step = 'render';
      try {
        let record = resultsRef.current!.trials[id];
        if (!record.renderKey) {
          setRow(id, { status: 'render' });
          const { renderLine, SAMPLE_RATE } = await engine();
          const channels = await renderLine({ ...lineNotes, durationSec: line.durationSec }, pack, trial);
          step = 'upload';
          setRow(id, { status: 'upload' });
          const bytes = encodeWav16(channels, SAMPLE_RATE);
          const file = new File([bytes as BlobPart], `studio-phase0-${id}.wav`, { type: 'audio/wav' });
          const renderKey = await uploadToWorkspace(file, () => {}, new AbortController().signal);
          record = { ...record, renderKey };
          await commit({ ...resultsRef.current!, trials: { ...resultsRef.current!.trials, [id]: record } });
        }
        step = 'measure';
        setRow(id, { status: 'measure' });
        const renderLufs = record.renderLufs ?? (await measureLufs(record.renderKey!));
        let stem = stemLufs.current.get(line.lineId) ?? record.stemLufs;
        if (stem === null || stem === undefined) {
          stem = await measureLufs(line.stemKey);
          stemLufs.current.set(line.lineId, stem);
        }
        record = { ...record, renderLufs, stemLufs: stem };
        await commit({ ...resultsRef.current!, trials: { ...resultsRef.current!.trials, [id]: record } });
        setRow(id, { status: 'ready' });
      } catch (err) {
        setRow(id, { status: 'error', error: `${step === 'render' ? 'Render' : step === 'upload' ? 'Upload' : 'Measure'} failed: ${message(err)}` });
      }
    },
    [commit, manifest, trialById]
  );

  const prepareAll = useCallback(async () => {
    if (!resultsRef.current) return;
    setPreparing(true);
    try {
      for (const id of resultsRef.current.order) {
        if (!isPrepared(resultsRef.current, id)) await prepareOne(id);
      }
    } finally {
      setPreparing(false);
    }
  }, [prepareOne]);

  const toggleLive = useCallback(
    async (lineId: string, packId: string) => {
      const key = `${lineId}:${packId}`;
      stopLive.current?.();
      stopLive.current = null;
      if (liveKey === key) {
        setLiveKey(null);
        return;
      }
      try {
        const line = manifest!.lines.find((l) => l.lineId === lineId)!;
        const trial = trialById.get(`${lineId}-${packId}`)!;
        const { playLive } = await engine();
        stopLive.current = await playLive(
          { ...notes.current.get(lineId)!, durationSec: line.durationSec },
          packs.current.get(packId)!,
          trial
        );
        setLiveKey(key);
        setLiveError((e) => ({ ...e, [key]: '' }));
      } catch (err) {
        setLiveKey(null);
        setLiveError((e) => ({ ...e, [key]: message(err) }));
      }
    },
    [liveKey, manifest, trialById]
  );

  const allPrepared = !!results && results.order.every((id) => isPrepared(results, id));
  const currentId =
    editingId ?? revealedId ?? results?.order.find((id) => !isRevealed(results, id)) ?? null;
  const allRated = !!results && results.order.every((id) => isRevealed(results, id));

  const resetForm = () => {
    setScoreA(null);
    setScoreB(null);
    setGuess(null);
    setNote('');
    setRateError(null);
  };

  const save = useCallback(async () => {
    const r = resultsRef.current;
    if (!r || !currentId || !scoreA || !scoreB || !guess) return;
    const side = r.trials[currentId].renderSide;
    const next = addRating(
      r,
      currentId,
      {
        renderScore: side === 'A' ? scoreA : scoreB,
        sunoScore: side === 'A' ? scoreB : scoreA,
        guess,
        note: note.trim(),
      },
      new Date()
    );
    setSaving(true);
    try {
      await saveResults(next);
      resultsRef.current = next;
      setResults(next);
      setRevealedId(currentId);
      setEditingId(null);
      resetForm();
    } catch (err) {
      setRateError(message(err));
    } finally {
      setSaving(false);
    }
  }, [currentId, scoreA, scoreB, guess, note]);

  if (probe === 'checking') {
    return (
      <p className="flex items-center gap-2 p-4 text-sm text-gray-600 dark:text-gray-300">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking this page&apos;s security settings…
      </p>
    );
  }
  if (probe === 'blocked') {
    return (
      <div role="alert" className="m-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
        <p>This page needs a fresh load to get its security settings. Reload this page.</p>
        <button type="button" className={`${primaryClass} mt-3`} onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }

  const current = currentId ? trialById.get(currentId) : null;
  const currentRecord = currentId && results ? results.trials[currentId] : null;
  const currentLine = current ? manifest?.lines.find((l) => l.lineId === current.lineId) : null;
  const showForm = !!currentId && (!revealedId || editingId === currentId);
  const v = allRated && results ? verdict(results, trials) : null;

  return (
    <div className="space-y-4 p-4">
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Compare each sample render with the Suno stem of the same line. You will not be told which is which until you
        save your scores. Score both: 3 means acceptable, would ship in a mix.
      </p>

      <Section title="CSP violations">
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {violations.length} violation{violations.length === 1 ? '' : 's'} on this page
        </p>
        {violations.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-xs text-red-700 dark:text-red-400">
            {violations.map((x, i) => (
              <li key={i}>
                {x.directive} blocked {x.blocked || '(inline)'}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Load">
        {!loaded && (
          <button type="button" className={primaryClass} onClick={() => void load()} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Load the test
          </button>
        )}
        <ul className="mt-2 space-y-1 text-xs text-gray-700 dark:text-gray-300">
          {loadItems.map((i) => (
            <li key={i.label}>
              {i.label}: {i.error ? 'failed' : i.done ? 'done' : 'loading…'}
              {i.error && (
                <p role="alert" className={alertClass}>
                  {i.error}
                </p>
              )}
            </li>
          ))}
        </ul>
        {loaded && <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">Everything loaded.</p>}
      </Section>

      {loaded && manifest && (
        <Section title="Lines">
          <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
            Checks that live playback works. Not part of the blind test.
          </p>
          <ul className="space-y-1">
            {manifest.lines.flatMap((l) =>
              manifest.packs
                .filter((p) => p.instrument === l.instrument)
                .map((p) => {
                  const key = `${l.lineId}:${p.packId}`;
                  const on = liveKey === key;
                  return (
                    <li key={key} className="flex flex-wrap items-center gap-2 text-sm">
                      <button type="button" className={buttonClass} onClick={() => void toggleLive(l.lineId, p.packId)}>
                        {on ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        {on ? 'Stop' : 'Play live'}
                      </button>
                      <span className="text-gray-700 dark:text-gray-300">
                        {l.lineId} · {p.packId}
                      </span>
                      {liveError[key] && (
                        <span role="alert" className={alertClass}>
                          {liveError[key]}
                        </span>
                      )}
                    </li>
                  );
                })
            )}
          </ul>
        </Section>
      )}

      {loaded && results && (
        <Section title="Prepare trials">
          <button
            type="button"
            className={primaryClass}
            onClick={() => void prepareAll()}
            disabled={preparing || allPrepared}
          >
            {preparing && <Loader2 className="h-4 w-4 animate-spin" />}
            Prepare trials
          </button>
          {saveError && (
            <p role="alert" className={alertClass}>
              Results not saved: {saveError}
            </p>
          )}
          <ol className="mt-3 space-y-1 text-sm">
            {results.order.map((id, i) => {
              const row = prep[id] ?? { status: 'waiting' };
              return (
                <li key={id} className="flex flex-wrap items-center gap-2">
                  <span className="w-16 text-gray-700 dark:text-gray-300">Trial {i + 1}</span>
                  <span className="text-gray-600 dark:text-gray-400">
                    {row.status === 'ready'
                      ? 'Ready'
                      : row.status === 'error'
                        ? 'Failed'
                        : row.status === 'waiting'
                          ? 'Waiting'
                          : row.status === 'render'
                            ? 'Rendering…'
                            : row.status === 'upload'
                              ? 'Uploading…'
                              : 'Measuring…'}
                  </span>
                  {row.status === 'error' && (
                    <>
                      <span role="alert" className={alertClass}>
                        {row.error}
                      </span>
                      <button type="button" className={buttonClass} onClick={() => void prepareOne(id)}>
                        <RotateCw className="h-3.5 w-3.5" />
                        Retry
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ol>
        </Section>
      )}

      {loaded && results && allPrepared && !allRated && current && currentRecord && currentLine && (
        <Section title="Listen">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
            Trial {results.order.indexOf(current.trialId) + 1} of {results.order.length} ·{' '}
            {INSTRUMENT_LABEL[current.instrument]}
          </p>
          <MasteringComparePlayer
            key={current.trialId}
            sourceKey={currentRecord.renderSide === 'A' ? currentRecord.renderKey! : currentLine.stemKey}
            masterKey={currentRecord.renderSide === 'A' ? currentLine.stemKey : currentRecord.renderKey!}
            beforeLufs={currentRecord.renderSide === 'A' ? currentRecord.renderLufs : currentRecord.stemLufs}
            afterLufs={currentRecord.renderSide === 'A' ? currentRecord.stemLufs : currentRecord.renderLufs}
            labels={{ a: 'A', b: 'B' }}
          />
          {showForm ? (
            <div className="mt-4 space-y-2">
              <ScoreGroup name="Score for A" value={scoreA} onChange={setScoreA} />
              <ScoreGroup name="Score for B" value={scoreB} onChange={setScoreB} />
              <div role="radiogroup" aria-label="Which one is Suno?" className="flex items-center gap-1">
                <span className="mr-2 w-24 text-xs text-gray-600 dark:text-gray-300">Which one is Suno?</span>
                {(
                  [
                    ['A', 'A'],
                    ['B', 'B'],
                    ['unsure', "Can't tell"],
                  ] as Array<[Guess, string]>
                ).map(([g, label]) => (
                  <button
                    key={g}
                    type="button"
                    role="radio"
                    aria-checked={guess === g}
                    onClick={() => setGuess(g)}
                    className={`rounded border px-2 py-1 text-sm ${
                      guess === g
                        ? 'border-orange-500 bg-orange-50 text-orange-800 dark:bg-orange-500/10 dark:text-orange-300'
                        : 'border-gray-300 text-gray-700 dark:border-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="block text-xs text-gray-600 dark:text-gray-300">
                Note (optional)
                <input
                  type="text"
                  value={note}
                  maxLength={200}
                  onChange={(e) => setNote(e.target.value)}
                  className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                />
              </label>
              <button
                type="button"
                className={primaryClass}
                onClick={() => void save()}
                disabled={saving || !scoreA || !scoreB || !guess}
              >
                Save
              </button>
              {rateError && (
                <p role="alert" className={alertClass}>
                  {rateError}
                </p>
              )}
            </div>
          ) : (
            <div className="mt-4 space-y-2 text-sm text-gray-700 dark:text-gray-300">
              <p>
                {currentRecord.renderSide} was the render ({packLabel(current.packId)}
                {current.gamaka ? ', with gamaka' : ''}). {currentRecord.renderSide === 'A' ? 'B' : 'A'} was the Suno stem.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={primaryClass}
                  onClick={() => {
                    setRevealedId(null);
                    resetForm();
                  }}
                >
                  Next trial
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => {
                    setEditingId(current.trialId);
                    resetForm();
                  }}
                >
                  Change rating
                </button>
              </div>
            </div>
          )}
        </Section>
      )}

      {v && results && (
        <Section title="Summary">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Phase 0 {v.phase0Pass ? 'passes' : 'does not pass'} (needs 2 of 3 instruments).
          </p>
          <table className="mt-2 w-full text-left text-xs text-gray-700 dark:text-gray-300">
            <thead>
              <tr>
                <th>Instrument</th>
                <th>Result</th>
                <th>Passed with</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(v.byInstrument) as Instrument[]).map((i) => (
                <tr key={i}>
                  <td>{INSTRUMENT_LABEL[i]}</td>
                  <td>{v.byInstrument[i].pass === null ? 'No verdict' : v.byInstrument[i].pass ? 'Pass' : 'Fail'}</td>
                  <td>{v.byInstrument[i].passedWith.map(packLabel).join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="mt-3 w-full text-left text-xs text-gray-700 dark:text-gray-300">
            <thead>
              <tr>
                <th>Trial</th>
                <th>Line</th>
                <th>Source</th>
                <th>Render was</th>
                <th>Render score</th>
                <th>Suno score</th>
                <th>Guess</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {results.order.map((id, i) => {
                const t = trialById.get(id)!;
                const rec = results.trials[id];
                const last = rec.ratings[rec.ratings.length - 1];
                return (
                  <tr key={id}>
                    <td>{i + 1}</td>
                    <td>{t.lineId}</td>
                    <td>
                      {packLabel(t.packId)}
                      {t.gamaka ? ' (gamaka)' : ''}
                    </td>
                    <td>{rec.renderSide}</td>
                    <td>{last?.renderScore}</td>
                    <td>{last?.sunoScore}</td>
                    <td>{last?.guess}</td>
                    <td>{last?.note}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
            Suno identified {v.suno.hits} of {v.suno.total} times. Gamaka:{' '}
            {v.gamaka.map((g) => `${g.lineId} straight ${g.straight ?? '–'} / gamaka ${g.gamaka ?? '–'}`).join('; ')}.
          </p>
        </Section>
      )}
    </div>
  );
}
