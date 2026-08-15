'use client';

/**
 * COMPOSITION NOTEBOOK — one record per song, where the language, the lyric and
 * the music decisions converge.
 *
 * Three behaviours that are requirements rather than styling:
 *
 * 1. **Saving and versioning are separate acts.** "Save" updates the working
 *    state; "Save version" takes an immutable snapshot. Autosaving into
 *    versions would bury the real decisions under dozens of keystroke states,
 *    and versioning on every save would make §16 meaningless.
 * 2. **Provenance is visible (§24).** Tempo, meter, tonic, scale and raga each
 *    carry a source selector. A field with no recorded source shows "—", not
 *    "user-entered": absence is not authorship.
 * 3. **The AI prompt is provider-neutral.** One `aiMusicPrompt` field; "Copy
 *    for Suno" is an export button that formats on the way out.
 */

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { adminFetch } from '@/lib/client-auth';
import { TransliterateField } from '@/components/admin/TransliterateField';
import {
  COMPOSITION_STATUSES,
  SONG_SECTIONS,
  SECTION_LABELS,
  PROVENANCES,
  PROVENANCED_FIELDS,
  compareVersions,
  formatForSuno,
  type Composition,
  type CompositionSpec,
  type CompositionSummary,
  type SongSection,
  type Provenance,
} from '@/types/composition';
import { METERS } from '@/lib/music/meter';
import { NOTE_NAMES_SHARP, SCALES } from '@/lib/music/pitch';

const FIELD_LABELS: Record<string, string> = {
  bpm: 'Tempo (BPM)',
  meter: 'Meter',
  tonic: 'Key / tonic',
  scale: 'Scale',
  raga: 'Raga',
};

export function CompositionNotebook() {
  const [list, setList] = useState<CompositionSummary[]>([]);
  const [current, setCurrent] = useState<Composition | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const res = await adminFetch('/api/admin/compositions');
    if (res.ok) {
      const d = await res.json();
      if (Array.isArray(d.data)) setList(d.data);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const open = async (id: string) => {
    const res = await adminFetch(`/api/admin/compositions/${id}`);
    if (!res.ok) { toast.error('Could not open'); return; }
    const d = await res.json();
    setCurrent(d.data);
  };

  const create = async () => {
    const title = prompt('Song title')?.trim();
    if (!title) return;
    setBusy(true);
    try {
      const res = await adminFetch('/api/admin/compositions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, spec: {} }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || 'Failed');
      setCurrent(d.data);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Composition Notebook</h1>
          <p className="text-sm text-gray-500">
            One record per song — the decisions, not just the result. Versions keep earlier choices.
          </p>
        </div>
        <button onClick={create} disabled={busy}
          className="rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-60">
          + New composition
        </button>
      </header>

      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="space-y-1">
          {list.length === 0 && <p className="text-xs text-gray-400">No compositions yet.</p>}
          {list.map((c) => (
            <button
              key={c.id}
              onClick={() => open(c.id)}
              className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                current?.id === c.id
                  ? 'border-orange-500 bg-orange-50 dark:bg-gray-800'
                  : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'
              }`}
            >
              <div className="font-tamil font-medium text-gray-900 dark:text-gray-100">{c.title}</div>
              <div className="text-[11px] text-gray-500">
                {c.status}
                {c.versionCount > 0 && ` · ${c.versionCount} version${c.versionCount > 1 ? 's' : ''}`}
                {c.bpm ? ` · ${c.bpm} BPM` : ''}
                {c.meter ? ` · ${c.meter}` : ''}
              </div>
            </button>
          ))}
        </aside>

        {current ? (
          <CompositionEditor
            key={current.id}
            composition={current}
            onSaved={(c) => { setCurrent(c); reload(); }}
            onDeleted={() => { setCurrent(null); reload(); }}
          />
        ) : (
          <p className="text-sm text-gray-400">Select a composition, or create one.</p>
        )}
      </div>
    </div>
  );
}

function CompositionEditor({
  composition,
  onSaved,
  onDeleted,
}: {
  composition: Composition;
  onSaved: (c: Composition) => void;
  onDeleted: () => void;
}) {
  const [title, setTitle] = useState(composition.title);
  const [status, setStatus] = useState(composition.status);
  const [spec, setSpec] = useState<CompositionSpec>(composition.spec ?? {});
  const [busy, setBusy] = useState(false);
  const [compare, setCompare] = useState<[number, number] | null>(null);

  const set = <K extends keyof CompositionSpec>(key: K, value: CompositionSpec[K]) =>
    setSpec((s) => ({ ...s, [key]: value }));

  const setSource = (field: string, value: Provenance | '') =>
    setSpec((s) => {
      const sources = { ...(s.sources ?? {}) };
      if (value) sources[field] = value;
      else delete sources[field];
      return { ...s, sources };
    });

  const save = async () => {
    setBusy(true);
    try {
      const res = await adminFetch(`/api/admin/compositions/${composition.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, status, spec }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || 'Failed');
      onSaved({ ...d.data, versions: composition.versions });
      toast.success('Saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const saveVersion = async () => {
    const label = prompt('Version label', `V${composition.versions.length + 1}`)?.trim();
    if (label === undefined) return;
    const note = prompt('What changed? (optional)')?.trim();
    setBusy(true);
    try {
      const res = await adminFetch(`/api/admin/compositions/${composition.id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label || undefined, note: note || undefined, spec }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || 'Failed');
      onSaved(d.data);
      toast.success('Version saved — earlier versions are untouched');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete "${composition.title}" and all its versions? This cannot be undone.`)) return;
    const res = await adminFetch(`/api/admin/compositions/${composition.id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Deleted'); onDeleted(); } else toast.error('Delete failed');
  };

  const copyForSuno = () => {
    const text = formatForSuno({ title, spec });
    if (!text) { toast.error('Nothing to export yet — write an AI music prompt first'); return; }
    navigator.clipboard?.writeText(text);
    toast.success('Copied — your lyrics are NOT included');
  };

  const diff =
    compare && composition.versions.length
      ? compareVersions(
          composition.versions.find((v) => v.version === compare[0])?.spec ?? {},
          composition.versions.find((v) => v.version === compare[1])?.spec ?? {}
        )
      : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="title"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 font-tamil text-lg dark:border-gray-600 dark:bg-gray-900" />
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="status"
          className="rounded-md border border-gray-300 px-2 py-2 text-sm dark:border-gray-600 dark:bg-gray-900">
          {COMPOSITION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={save} disabled={busy}
          className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60">Save</button>
        <button onClick={saveVersion} disabled={busy}
          className="rounded-md border border-orange-500 px-3 py-2 text-sm font-medium text-orange-700 hover:bg-orange-50 disabled:opacity-60 dark:text-orange-400 dark:hover:bg-gray-800">
          Save version
        </button>
        <button onClick={remove} className="rounded-md px-2 py-2 text-sm text-red-600 hover:text-red-800">Delete</button>
      </div>

      {/* ---- musical decisions, each with its provenance ---------------- */}
      <section className="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <h2 className="text-sm font-medium text-gray-700 dark:text-gray-200">Musical decisions</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Labelled label={FIELD_LABELS.bpm}>
            <input type="number" min={40} max={200} value={spec.bpm ?? ''} aria-label="tempo"
              onChange={(e) => set('bpm', e.target.value ? Number(e.target.value) : undefined)}
              className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900" />
          </Labelled>
          <Labelled label={FIELD_LABELS.meter}>
            <select value={spec.meter ?? ''} onChange={(e) => set('meter', e.target.value || undefined)} aria-label="meter"
              className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900">
              <option value="">—</option>
              {METERS.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
            </select>
          </Labelled>
          <Labelled label={FIELD_LABELS.tonic}>
            <select value={spec.tonic ?? ''} onChange={(e) => set('tonic', e.target.value || undefined)} aria-label="tonic"
              className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900">
              <option value="">—</option>
              {NOTE_NAMES_SHARP.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Labelled>
          <Labelled label={FIELD_LABELS.scale}>
            <select value={spec.scale ?? ''} onChange={(e) => set('scale', e.target.value || undefined)} aria-label="scale"
              className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900">
              <option value="">—</option>
              {SCALES.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </Labelled>
          <Labelled label={FIELD_LABELS.raga}>
            <input value={spec.raga ?? ''} onChange={(e) => set('raga', e.target.value || undefined)} aria-label="raga"
              className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900" />
          </Labelled>
          <Labelled label="Vocal configuration">
            <input value={spec.vocalConfiguration ?? ''} aria-label="vocal configuration"
              onChange={(e) => set('vocalConfiguration', e.target.value || undefined)}
              className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900" />
          </Labelled>
        </div>

        {/* §24 — where each value came from. */}
        <div className="space-y-1 rounded-md bg-gray-50 p-3 dark:bg-gray-800/60">
          <div className="text-[11px] uppercase tracking-wide text-gray-400">Source of each value</div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {PROVENANCED_FIELDS.map((field) => (
              <label key={field} className="flex items-center gap-2 text-xs">
                <span className="w-24 shrink-0 text-gray-500">{FIELD_LABELS[field]}</span>
                <select
                  value={spec.sources?.[field] ?? ''}
                  onChange={(e) => setSource(field, e.target.value as Provenance | '')}
                  aria-label={`source of ${field}`}
                  className="flex-1 rounded border border-gray-300 px-1 py-0.5 dark:border-gray-600 dark:bg-gray-900"
                >
                  <option value="">— not recorded</option>
                  {PROVENANCES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
            ))}
          </div>
          <p className="text-[11px] text-gray-400">
            A blank source means <strong>not recorded</strong> — not &ldquo;user-entered&rdquo;. A suggested tempo and one you
            chose are different claims.
          </p>
        </div>
      </section>

      {/* ---- song structure -------------------------------------------- */}
      <section className="space-y-2 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <h2 className="text-sm font-medium text-gray-700 dark:text-gray-200">Song structure</h2>
        <div className="flex flex-wrap gap-1">
          {SONG_SECTIONS.map((s) => (
            <button key={s} onClick={() => set('structure', [...(spec.structure ?? []), s])}
              className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 hover:bg-orange-100 dark:bg-gray-800 dark:text-gray-300">
              + {SECTION_LABELS[s].english}
            </button>
          ))}
        </div>
        {!!spec.structure?.length && (
          <ol className="flex flex-wrap items-center gap-1 text-sm">
            {spec.structure.map((s, i) => (
              <li key={`${s}-${i}`} className="flex items-center gap-1">
                <button
                  onClick={() => set('structure', (spec.structure ?? []).filter((_, j) => j !== i))}
                  title="remove"
                  className="rounded bg-orange-100 px-2 py-0.5 text-xs text-orange-800 hover:line-through dark:bg-gray-700 dark:text-orange-300"
                >
                  {SECTION_LABELS[s as SongSection].english}
                  <span className="ml-1 font-tamil opacity-60">{SECTION_LABELS[s as SongSection].tamil}</span>
                </button>
                {i < (spec.structure?.length ?? 0) - 1 && <span className="text-gray-300">→</span>}
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* ---- notes ------------------------------------------------------ */}
      <section className="grid gap-3 rounded-lg border border-gray-200 p-4 sm:grid-cols-2 dark:border-gray-700">
        <Notes label="Melody notes" value={spec.melodyNotes} onChange={(v) => set('melodyNotes', v)} />
        <Notes label="Rhythm notes" value={spec.rhythmNotes} onChange={(v) => set('rhythmNotes', v)} />
        <Notes label="Lyric notes" value={spec.lyricNotes} onChange={(v) => set('lyricNotes', v)} />
        <Notes label="Instrumentation" value={spec.instrumentation} onChange={(v) => set('instrumentation', v)} />
        <Notes label="Arrangement notes" value={spec.arrangementNotes} onChange={(v) => set('arrangementNotes', v)} />
        <Notes label="Composition notes" value={spec.compositionNotes} onChange={(v) => set('compositionNotes', v)} />
        <Notes label="Mixing notes" value={spec.mixingNotes} onChange={(v) => set('mixingNotes', v)} />
        <Notes label="Mastering notes" value={spec.masteringNotes} onChange={(v) => set('masteringNotes', v)} />
      </section>

      {/* ---- lyrics ----------------------------------------------------- */}
      <section className="space-y-2 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <h2 className="text-sm font-medium text-gray-700 dark:text-gray-200">Lyrics</h2>
        <TransliterateField
          value={spec.lyrics ?? ''}
          onChange={(v) => set('lyrics', v)}
          multiline
          rows={8}
          ariaLabel="lyrics"
          placeholder="பல்லவி…"
          className="w-full rounded-md border border-gray-300 px-3 py-2 font-tamil dark:border-gray-600 dark:bg-gray-900"
        />
      </section>

      {/* ---- AI music prompt: neutral field, export action --------------- */}
      <section className="space-y-2 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-gray-700 dark:text-gray-200">AI music prompt</h2>
          <button onClick={copyForSuno}
            className="rounded-md border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800">
            Copy for Suno
          </button>
        </div>
        <textarea
          value={spec.aiMusicPrompt ?? ''}
          onChange={(e) => set('aiMusicPrompt', e.target.value || undefined)}
          rows={3}
          aria-label="ai music prompt"
          placeholder="Describe the sound you want — instruments, feel, era, production."
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
        />
        <p className="text-[11px] text-gray-400">
          Stored provider-neutral. &ldquo;Copy for Suno&rdquo; formats it on the way out and{' '}
          <strong>never includes your lyrics</strong>.
        </p>
      </section>

      {/* ---- versions --------------------------------------------------- */}
      <section className="space-y-2 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <h2 className="text-sm font-medium text-gray-700 dark:text-gray-200">
          Versions <span className="font-normal text-gray-400">— earlier decisions are never overwritten</span>
        </h2>
        {composition.versions.length === 0 && (
          <p className="text-xs text-gray-400">No versions yet. &ldquo;Save version&rdquo; snapshots the current state.</p>
        )}
        <ul className="space-y-1">
          {composition.versions.map((v) => (
            <li key={v.version} className="flex flex-wrap items-baseline gap-2 text-sm">
              <span className="font-medium text-gray-800 dark:text-gray-100">{v.label}</span>
              <span className="text-xs text-gray-400">
                {v.spec.bpm ? `${v.spec.bpm} BPM` : ''} {v.spec.meter ?? ''} {v.spec.tonic ?? ''}
              </span>
              {v.note && <span className="text-xs text-gray-500">— {v.note}</span>}
            </li>
          ))}
        </ul>

        {composition.versions.length >= 2 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-gray-500">Compare</span>
            <select aria-label="compare from" onChange={(e) => setCompare([Number(e.target.value), compare?.[1] ?? composition.versions.length])}
              className="rounded border border-gray-300 px-1 py-0.5 dark:border-gray-600 dark:bg-gray-900">
              {composition.versions.map((v) => <option key={v.version} value={v.version}>{v.label}</option>)}
            </select>
            <span className="text-gray-400">→</span>
            <select aria-label="compare to" onChange={(e) => setCompare([compare?.[0] ?? 1, Number(e.target.value)])}
              className="rounded border border-gray-300 px-1 py-0.5 dark:border-gray-600 dark:bg-gray-900">
              {composition.versions.map((v) => <option key={v.version} value={v.version}>{v.label}</option>)}
            </select>
          </div>
        )}

        {diff && (
          <div className="rounded-md bg-gray-50 p-3 text-xs dark:bg-gray-800/60">
            {diff.length === 0 ? (
              <span className="text-gray-500">No differences in the decision fields.</span>
            ) : (
              <ul className="space-y-0.5">
                {diff.map((d) => (
                  <li key={d.field}>
                    <span className="text-gray-500">{FIELD_LABELS[d.field] ?? d.field}:</span>{' '}
                    <span className="text-red-600 line-through">{d.before}</span>{' '}
                    <span className="text-gray-400">→</span>{' '}
                    <span className="text-green-700 dark:text-green-400">{d.after}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wide text-gray-400">{label}</span>
      {children}
    </label>
  );
}

function Notes({ label, value, onChange }: { label: string; value?: string; onChange: (v: string | undefined) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wide text-gray-400">{label}</span>
      <textarea
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        rows={2}
        aria-label={label.toLowerCase()}
        className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900"
      />
    </label>
  );
}
