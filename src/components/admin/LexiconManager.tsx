'use client';

/**
 * LexiconManager — admin UI for the Tamil literary / songwriting lexicon.
 *
 * Search + filters, the eight-column table, a word-detail panel (deep metadata,
 * word family, alternatives), add / edit / paste-import, AI suggest, AI
 * enrichment, the lyric-context reader, export, and the data-quality audit.
 *
 * TWO LAYOUT RULES worth keeping:
 *  - the TABLE stays eight columns. Everything deeper lives in the detail panel,
 *    because this table is 1,047 rows long and a wide table is an unreadable one.
 *  - the tools live behind toggles, not stacked open. The default view is the
 *    word list; a poet opening this page is usually looking something up.
 *
 * Search runs CLIENT-side through the same `searchLexicon` the API uses, so
 * filtering 1,047 in-memory rows is instant and the two can never disagree.
 */

import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { adminFetch } from '@/lib/client-auth';
import { TransliterateField } from '@/components/admin/TransliterateField';
import { usePagination, PAGER_BTN } from '@/components/admin/Pager';
import {
  LEXICON_REGISTERS,
  LEXICON_USAGES,
  LEXICON_THEMES,
  LEXICON_WORD_TYPES,
  LEXICAL_STATUSES,
  LEXICON_CONFIDENCE,
  LEXICON_MOODS,
  DEFAULT_REGISTER,
  REGISTER_DESCRIPTIONS,
  THEME_GROUPS,
} from '@/types/lexicon';
import { parsePastedWords, lexiconToCsv, chunkForBulk } from '@/lib/lexicon-io';
import { searchLexicon, lexiconCounts } from '@/lib/lexicon-search';
import { WordDetailPanel } from '@/components/admin/lexicon/WordDetailPanel';
import { AuditPanel } from '@/components/admin/lexicon/AuditPanel';
import { LyricContextPanel } from '@/components/admin/lexicon/LyricContextPanel';
import { EnrichPanel } from '@/components/admin/lexicon/EnrichPanel';
import { toRow, type LexiconRow } from '@/components/admin/lexicon/types';

export type { LexiconRow };

interface Suggestion {
  word: string;
  romanization?: string;
  gloss: string;
  tamilMeaning?: string;
  register: string;
  registers?: string[];
  wordType?: string;
  lexicalStatus?: string;
  confidence?: string;
  themes: string[];
  usage: string;
}

const USAGE_STYLE: Record<string, string> = {
  fresh: 'text-green-700 bg-green-50',
  normal: 'text-gray-600 bg-gray-100',
  familiar: 'text-blue-700 bg-blue-50',
  overused: 'text-amber-700 bg-amber-50',
  avoid: 'text-red-700 bg-red-50',
};

const CONFIDENCE_STYLE: Record<string, string> = {
  verified: 'bg-green-100 text-green-800',
  high: 'bg-emerald-50 text-emerald-700',
  medium: 'bg-gray-100 text-gray-600',
  experimental: 'bg-amber-100 text-amber-800',
};

/** Trigger a client-side file download (no-op outside the browser). */
function download(filename: string, text: string, mime: string) {
  if (typeof window === 'undefined') return;
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type Tool = 'none' | 'suggest' | 'enrich' | 'lyric' | 'audit';

export function LexiconManager({ initial }: { initial: LexiconRow[] }) {
  const [words, setWords] = useState<LexiconRow[]>(initial);
  const [fRegister, setFRegister] = useState('');
  const [fUsage, setFUsage] = useState('');
  const [fTheme, setFTheme] = useState('');
  const [fWordType, setFWordType] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fConfidence, setFConfidence] = useState('');
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('none');

  const counts = useMemo(() => lexiconCounts(words), [words]);

  const visible = useMemo(
    () =>
      searchLexicon(words, q, {
        register: fRegister || undefined,
        usage: fUsage || undefined,
        theme: fTheme || undefined,
        wordType: fWordType || undefined,
        lexicalStatus: fStatus || undefined,
        confidence: fConfidence || undefined,
        includeArchived: showArchived,
      }),
    [words, q, fRegister, fUsage, fTheme, fWordType, fStatus, fConfidence, showArchived]
  );

  // Reset to page 1 whenever the RESULT SET changes, not just when it shrinks.
  const { page, setPage, totalPages, pageRows, total } = usePagination(
    visible,
    50,
    `${fRegister}|${fUsage}|${fTheme}|${fWordType}|${fStatus}|${fConfidence}|${q}|${showArchived}`
  );

  const detail = detailId ? words.find((w) => w.id === detailId) ?? null : null;

  const reload = async () => {
    const res = await adminFetch('/api/admin/lexicon?archived=true');
    if (res.ok) {
      const d = await res.json();
      if (Array.isArray(d.data)) setWords(d.data.map(toRow));
    }
  };

  const setUsage = async (id: string, usage: string) => {
    setWords((prev) => prev.map((w) => (w.id === id ? { ...w, usage } : w)));
    const res = await adminFetch(`/api/admin/lexicon/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usage }),
    });
    if (!res.ok) { toast.error('Update failed'); reload(); } else { toast.success('Updated'); }
  };

  const toggleArchive = async (w: LexiconRow) => {
    const res = await adminFetch(`/api/admin/lexicon/${w.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: !w.archived }),
    });
    if (res.ok) { setWords((prev) => prev.map((x) => (x.id === w.id ? { ...x, archived: !x.archived } : x))); }
    else toast.error('Failed');
  };

  const remove = async (id: string) => {
    const res = await adminFetch(`/api/admin/lexicon/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setWords((prev) => prev.filter((w) => w.id !== id));
      if (detailId === id) setDetailId(null);
    } else toast.error('Delete failed');
  };

  const onEdited = (row: LexiconRow) => {
    setWords((prev) => prev.map((w) => (w.id === row.id ? row : w)));
    setEditingId(null);
  };

  const exportCsv = () => {
    if (visible.length === 0) { toast.error('Nothing to export'); return; }
    download('tamilagaval-lexicon.csv', lexiconToCsv(visible), 'text/csv;charset=utf-8');
  };
  const exportJson = () => {
    if (visible.length === 0) { toast.error('Nothing to export'); return; }
    download('tamilagaval-lexicon.json', JSON.stringify(visible, null, 2), 'application/json');
  };

  const toggleTool = (t: Tool) => setTool((cur) => (cur === t ? 'none' : t));

  return (
    <div className="space-y-4">
      {/* ---- counts strip ------------------------------------------------ */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
        <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
          {counts.total.toLocaleString()} words
        </span>
        {Object.entries(counts.byRegister)
          .sort((a, b) => b[1] - a[1])
          .map(([r, n]) => (
            <button
              key={r}
              onClick={() => setFRegister(fRegister === r ? '' : r)}
              title={REGISTER_DESCRIPTIONS[r as keyof typeof REGISTER_DESCRIPTIONS]}
              className={`rounded-full px-2 py-0.5 ${fRegister === r ? 'bg-indigo-600 text-white' : 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-800'}`}
            >
              {n.toLocaleString()} {r}
            </button>
          ))}
        {counts.needsReview > 0 && (
          <span className="text-amber-600 dark:text-amber-400">{counts.needsReview.toLocaleString()} need review</span>
        )}
        {counts.archived > 0 && <span>{counts.archived} archived</span>}
      </div>

      {/* ---- toolbar ----------------------------------------------------- */}
      <div className="flex flex-wrap gap-2">
        <AddWord onAdded={(w) => setWords((prev) => [w, ...prev])} />
        <PasteImport onImported={reload} />
        <ToolButton active={tool === 'suggest'} onClick={() => toggleTool('suggest')}>✨ AI suggest</ToolButton>
        <ToolButton active={tool === 'enrich'} onClick={() => toggleTool('enrich')}>🪄 Enrich</ToolButton>
        <ToolButton active={tool === 'lyric'} onClick={() => toggleTool('lyric')}>📝 Lyric context</ToolButton>
        <ToolButton active={tool === 'audit'} onClick={() => toggleTool('audit')}>🩺 Audit</ToolButton>
      </div>

      {tool === 'suggest' && <SuggestPanel onAccepted={reload} />}
      {tool === 'enrich' && <EnrichPanel words={words} onApplied={reload} />}
      {tool === 'lyric' && <LyricContextPanel />}
      {tool === 'audit' && <AuditPanel onApplied={reload} />}

      {/* ---- filters ----------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search Tamil, English, meaning, relations…"
          aria-label="Search lexicon"
          className="min-w-[16rem] flex-1 rounded-md border border-gray-300 px-3 py-1.5 font-tamil dark:border-gray-600 dark:bg-gray-900"
        />
        <Select value={fRegister} onChange={setFRegister} placeholder="All registers" options={LEXICON_REGISTERS} />
        <Select value={fUsage} onChange={setFUsage} placeholder="All usage" options={LEXICON_USAGES} />
        <Select value={fTheme} onChange={setFTheme} placeholder="All themes" options={LEXICON_THEMES} />
        <Select value={fWordType} onChange={setFWordType} placeholder="All types" options={LEXICON_WORD_TYPES} />
        <Select value={fStatus} onChange={setFStatus} placeholder="All status" options={LEXICAL_STATUSES} />
        <Select value={fConfidence} onChange={setFConfidence} placeholder="All confidence" options={LEXICON_CONFIDENCE} />
        <label className="flex items-center gap-1 text-gray-500">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> archived
        </label>
        <div className="ml-auto flex items-center gap-2 text-gray-400">
          <span>{total} shown</span>
          <button onClick={exportCsv} className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600">Export CSV</button>
          <button onClick={exportJson} className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600">JSON</button>
        </div>
      </div>

      <div className={detail ? 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]' : ''}>
        <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              <tr>
                <th className="px-3 py-2">Word</th>
                <th className="px-3 py-2">Gloss</th>
                <th className="px-3 py-2">Register</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Usage</th>
                <th className="px-3 py-2">Themes</th>
                <th className="px-3 py-2">Confidence</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {pageRows.map((w) =>
                editingId === w.id ? (
                  <tr key={w.id}>
                    <td colSpan={8} className="px-3 py-2">
                      <EditRow word={w} onSaved={onEdited} onCancel={() => setEditingId(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr key={w.id} className={`${w.archived ? 'opacity-50' : ''} ${detailId === w.id ? 'bg-orange-50/60 dark:bg-gray-800/60' : ''}`}>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => setDetailId(w.id)}
                        className="text-left font-tamil font-medium text-gray-900 hover:text-orange-700 hover:underline dark:text-gray-100 dark:hover:text-orange-400"
                      >
                        {w.word}
                      </button>
                      {w.romanization && <div className="text-xs text-gray-400">{w.romanization}</div>}
                    </td>
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{w.gloss}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {(w.registers?.length ? w.registers : [w.register]).join(', ')}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">{w.wordType ?? '—'}</td>
                    <td className="px-3 py-2">
                      <select
                        value={w.usage}
                        onChange={(e) => setUsage(w.id, e.target.value)}
                        aria-label={`usage for ${w.word}`}
                        className={`rounded px-2 py-1 text-xs font-medium ${USAGE_STYLE[w.usage] ?? ''}`}
                      >
                        {LEXICON_USAGES.map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {w.themes.map((t) => <span key={t} className="rounded-full bg-orange-50 px-2 py-0.5 text-xs text-orange-700">{t}</span>)}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {w.confidence ? (
                        <span className={`rounded px-1.5 py-0.5 text-[11px] ${CONFIDENCE_STYLE[w.confidence] ?? ''}`}>{w.confidence}</span>
                      ) : (
                        <span className="text-[11px] text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-xs">
                      <button onClick={() => setEditingId(w.id)} className="mr-2 text-blue-600 hover:text-blue-800">Edit</button>
                      <button onClick={() => toggleArchive(w)} className="mr-2 text-gray-500 hover:text-gray-800">{w.archived ? 'Restore' : 'Archive'}</button>
                      <button onClick={() => remove(w.id)} className="text-red-500 hover:text-red-700">Delete</button>
                    </td>
                  </tr>
                )
              )}
              {visible.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-400">{words.length ? 'No words match these filters.' : 'No words. Add one or use AI suggest.'}</td></tr>
              )}
            </tbody>
          </table>
          {totalPages > 1 && (
            <nav className="flex items-center justify-end gap-2 border-t border-gray-100 px-3 py-2 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400" aria-label="Pagination">
              <span>Page {page + 1} of {totalPages} · {total} words</span>
              <button type="button" className={PAGER_BTN} onClick={() => setPage(page - 1)} disabled={page === 0}>← Prev</button>
              <button type="button" className={PAGER_BTN} onClick={() => setPage(page + 1)} disabled={page >= totalPages - 1}>Next →</button>
            </nav>
          )}
        </div>

        {detail && (
          <WordDetailPanel
            word={detail}
            lexicon={words}
            onClose={() => setDetailId(null)}
            onEdit={() => setEditingId(detail.id)}
            onOpenWord={(id) => setDetailId(id)}
          />
        )}
      </div>
    </div>
  );
}

function ToolButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md border px-3 py-2 text-sm font-medium ${
        active
          ? 'border-orange-600 bg-orange-600 text-white'
          : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800'
      }`}
    >
      {children}
    </button>
  );
}

function Select({ value, onChange, placeholder, options }: { value: string; onChange: (v: string) => void; placeholder: string; options: readonly string[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600 dark:bg-gray-900">
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

/**
 * Theme chips, grouped. The flat list is 39 tags long — as one row of chips it
 * is a wall; grouped by Love / Feeling / Nature / … it is scannable.
 */
function ThemePicker({ themes, onToggle }: { themes: string[]; onToggle: (t: string) => void }) {
  return (
    <div className="space-y-1">
      {THEME_GROUPS.map((g) => (
        <div key={g.label} className="flex flex-wrap items-center gap-1">
          <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-gray-400">{g.label}</span>
          {g.themes.map((t) => (
            <button key={t} type="button" onClick={() => onToggle(t)}
              className={`rounded-full px-2 py-0.5 text-xs ${themes.includes(t) ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>{t}</button>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Multi-select register chips — a word may hold up to three. */
function RegisterPicker({ registers, onToggle }: { registers: string[]; onToggle: (r: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-gray-400">Register</span>
      {LEXICON_REGISTERS.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onToggle(r)}
          title={REGISTER_DESCRIPTIONS[r]}
          className={`rounded-full px-2 py-0.5 text-xs ${registers.includes(r) ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

/** Shared metadata editor used by both Add and Edit, so they cannot drift. */
function MetadataFields({
  registers, setRegisters, wordType, setWordType, lexicalStatus, setLexicalStatus,
  confidence, setConfidence, usage, setUsage, themes, setThemes,
}: {
  registers: string[]; setRegisters: (v: string[]) => void;
  wordType: string; setWordType: (v: string) => void;
  lexicalStatus: string; setLexicalStatus: (v: string) => void;
  confidence: string; setConfidence: (v: string) => void;
  usage: string; setUsage: (v: string) => void;
  themes: string[]; setThemes: (v: string[]) => void;
}) {
  const toggle = (list: string[], v: string, set: (x: string[]) => void, max = Infinity) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : list.length < max ? [...list, v] : list);

  return (
    <>
      <RegisterPicker registers={registers} onToggle={(r) => toggle(registers, r, setRegisters, 3)} />
      <div className="flex flex-wrap gap-2">
        <Select value={wordType} onChange={setWordType} placeholder="word type" options={LEXICON_WORD_TYPES} />
        <Select value={lexicalStatus} onChange={setLexicalStatus} placeholder="lexical status" options={LEXICAL_STATUSES} />
        <Select value={confidence} onChange={setConfidence} placeholder="confidence" options={LEXICON_CONFIDENCE} />
        <Select value={usage} onChange={setUsage} placeholder="usage" options={LEXICON_USAGES} />
      </div>
      <ThemePicker themes={themes} onToggle={(t) => toggle(themes, t, setThemes)} />
    </>
  );
}

function AddWord({ onAdded }: { onAdded: (w: LexiconRow) => void }) {
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState('');
  const [romanization, setRomanization] = useState('');
  const [gloss, setGloss] = useState('');
  const [tamilMeaning, setTamilMeaning] = useState('');
  // NOT LEXICON_REGISTERS[0] — that pattern is what filed 1,046 words as sangam.
  const [registers, setRegisters] = useState<string[]>([DEFAULT_REGISTER]);
  const [wordType, setWordType] = useState('');
  const [lexicalStatus, setLexicalStatus] = useState('');
  const [confidence, setConfidence] = useState('');
  const [usage, setUsage] = useState<string>('fresh');
  const [themes, setThemes] = useState<string[]>([]);
  const [poeticUsage, setPoeticUsage] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!word.trim() || !gloss.trim()) { toast.error('Word + gloss required'); return; }
    setBusy(true);
    try {
      const res = await adminFetch('/api/admin/lexicon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          word,
          romanization: romanization.trim() || undefined,
          gloss,
          tamilMeaning: tamilMeaning.trim() || undefined,
          registers: registers.length ? registers : [DEFAULT_REGISTER],
          wordType: wordType || undefined,
          lexicalStatus: lexicalStatus || undefined,
          confidence: confidence || undefined,
          usage,
          themes,
          poeticUsage: poeticUsage.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const d = await res.json();
      if (res.status === 409) { toast.error('Word already exists'); return; }
      if (!res.ok) throw new Error(d?.error || 'Failed');
      onAdded(toRow(d.data));
      setWord(''); setRomanization(''); setGloss(''); setTamilMeaning(''); setThemes([]); setPoeticUsage(''); setNotes('');
      toast.success('Added');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return <button onClick={() => setOpen(true)} className="rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700">+ Add word</button>;
  }
  return (
    <div className="w-full space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      {/* Tamil headword — type English to transliterate (e.g. amma → அம்மா),
          or paste/type Tamil directly. ↑↓ choose · Enter/Tab/Space commit. */}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">சொல் (word) — type: amma, nila</label>
        <TransliterateField value={word} onChange={setWord} placeholder="சொல்" />
      </div>
      <div className="flex flex-wrap gap-2">
        <input value={gloss} onChange={(e) => setGloss(e.target.value)} placeholder="meaning (English)" className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600 dark:bg-gray-900" />
        <input value={romanization} onChange={(e) => setRomanization(e.target.value)} placeholder="romanization (opt)" className="w-40 rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600 dark:bg-gray-900" />
      </div>
      <input value={tamilMeaning} onChange={(e) => setTamilMeaning(e.target.value)} placeholder="தமிழ் பொருள் (Tamil meaning)" className="w-full rounded-md border border-gray-300 px-2 py-1.5 font-tamil dark:border-gray-600 dark:bg-gray-900" />
      <MetadataFields
        registers={registers} setRegisters={setRegisters}
        wordType={wordType} setWordType={setWordType}
        lexicalStatus={lexicalStatus} setLexicalStatus={setLexicalStatus}
        confidence={confidence} setConfidence={setConfidence}
        usage={usage} setUsage={setUsage}
        themes={themes} setThemes={setThemes}
      />
      <input value={poeticUsage} onChange={(e) => setPoeticUsage(e.target.value)} placeholder="கவிதைப் பயன்பாடு — how it works in a line" className="w-full rounded-md border border-gray-300 px-2 py-1.5 font-tamil dark:border-gray-600 dark:bg-gray-900" />
      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="notes (opt) — source, evidence…" className="w-full rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600 dark:bg-gray-900" />
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy} className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60">{busy ? 'Saving…' : 'Save'}</button>
        <button onClick={() => setOpen(false)} className="rounded-md border border-gray-300 px-4 py-1.5 text-sm">Cancel</button>
      </div>
    </div>
  );
}

function EditRow({ word: w, onSaved, onCancel }: { word: LexiconRow; onSaved: (w: LexiconRow) => void; onCancel: () => void }) {
  const [word, setWord] = useState(w.word);
  const [romanization, setRomanization] = useState(w.romanization ?? '');
  const [gloss, setGloss] = useState(w.gloss);
  const [tamilMeaning, setTamilMeaning] = useState(w.tamilMeaning ?? '');
  const [registers, setRegisters] = useState<string[]>(w.registers?.length ? w.registers : [w.register]);
  const [wordType, setWordType] = useState(w.wordType ?? '');
  const [lexicalStatus, setLexicalStatus] = useState(w.lexicalStatus ?? '');
  const [confidence, setConfidence] = useState(w.confidence ?? '');
  const [usage, setUsage] = useState(w.usage);
  const [themes, setThemes] = useState<string[]>(w.themes);
  const [poeticUsage, setPoeticUsage] = useState(w.poeticUsage ?? '');
  const [notes, setNotes] = useState(w.notes ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!word.trim() || !gloss.trim()) { toast.error('Word + gloss required'); return; }
    setBusy(true);
    try {
      const res = await adminFetch(`/api/admin/lexicon/${w.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          word,
          romanization: romanization.trim() || null,
          gloss,
          tamilMeaning: tamilMeaning.trim() || null,
          registers: registers.length ? registers : [DEFAULT_REGISTER],
          // '' means "leave unset" — the field is genuinely optional, and
          // absence of a confidence is meaningful data (never reviewed).
          ...(wordType ? { wordType } : {}),
          ...(lexicalStatus ? { lexicalStatus } : {}),
          ...(confidence ? { confidence } : {}),
          usage,
          themes,
          poeticUsage: poeticUsage.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      const d = await res.json();
      if (res.status === 409) { toast.error('Word already exists'); return; }
      if (!res.ok) throw new Error(d?.error || 'Failed');
      onSaved(toRow({ ...d.data, archived: w.archived }));
      toast.success('Saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-blue-200 bg-blue-50/40 p-3 dark:border-gray-600 dark:bg-gray-800/40">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">சொல் (word)</label>
        <TransliterateField value={word} onChange={setWord} placeholder="சொல்" />
      </div>
      <div className="flex flex-wrap gap-2">
        <input value={gloss} onChange={(e) => setGloss(e.target.value)} aria-label="meaning" placeholder="meaning (English)" className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600 dark:bg-gray-900" />
        <input value={romanization} onChange={(e) => setRomanization(e.target.value)} aria-label="romanization" placeholder="romanization" className="w-40 rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600 dark:bg-gray-900" />
      </div>
      <input value={tamilMeaning} onChange={(e) => setTamilMeaning(e.target.value)} aria-label="tamil meaning" placeholder="தமிழ் பொருள்" className="w-full rounded-md border border-gray-300 px-2 py-1.5 font-tamil dark:border-gray-600 dark:bg-gray-900" />
      <MetadataFields
        registers={registers} setRegisters={setRegisters}
        wordType={wordType} setWordType={setWordType}
        lexicalStatus={lexicalStatus} setLexicalStatus={setLexicalStatus}
        confidence={confidence} setConfidence={setConfidence}
        usage={usage} setUsage={setUsage}
        themes={themes} setThemes={setThemes}
      />
      <input value={poeticUsage} onChange={(e) => setPoeticUsage(e.target.value)} aria-label="poetic usage" placeholder="கவிதைப் பயன்பாடு" className="w-full rounded-md border border-gray-300 px-2 py-1.5 font-tamil dark:border-gray-600 dark:bg-gray-900" />
      <input value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="notes" placeholder="notes (opt)" className="w-full rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600 dark:bg-gray-900" />
      <div className="flex gap-2">
        <button onClick={save} disabled={busy} className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60">{busy ? 'Saving…' : 'Save'}</button>
        <button onClick={onCancel} className="rounded-md border border-gray-300 px-4 py-1.5 text-sm">Cancel</button>
      </div>
    </div>
  );
}

function PasteImport({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [register, setRegister] = useState<string>(DEFAULT_REGISTER);
  const [usage, setUsage] = useState<string>('fresh');
  const [themes, setThemes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');

  const parsed = useMemo(
    () => parsePastedWords(text, { register: register as never, usage: usage as never, themes }),
    [text, register, usage, themes]
  );

  const submit = async () => {
    if (parsed.words.length === 0) { toast.error('No words to import'); return; }
    setBusy(true);
    // Sent in chunks: the API caps a batch at BULK_MAX_WORDS, and a real paste
    // is far bigger. Sequential, not parallel — these are writes against one
    // table and a burst buys nothing but contention.
    const batches = chunkForBulk(parsed.words);
    let added = 0, skipped = 0, done = 0;
    try {
      for (const words of batches) {
        const res = await adminFetch('/api/admin/lexicon/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ words }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d?.error || 'Failed');
        added += d.added ?? 0;
        skipped += d.skipped ?? 0;
        done += 1;
        if (batches.length > 1) setProgress(`${done}/${batches.length} batches…`);
      }
      toast.success(`Added ${added}${skipped ? `, skipped ${skipped} (already known)` : ''}`);
      setText(''); setOpen(false);
      onImported();
    } catch (e) {
      // Partial success is the common failure here — say what DID land, or the
      // poet re-pastes everything and every earlier word comes back "skipped".
      const detail = e instanceof Error ? e.message : 'Import failed';
      toast.error(added > 0 ? `${detail} — ${added} added before it stopped; re-paste the rest` : detail);
      if (added > 0) onImported();
    } finally {
      setProgress('');
      setBusy(false);
    }
  };

  if (!open) {
    return <button onClick={() => setOpen(true)} className="rounded-md border border-orange-600 px-4 py-2 text-sm font-medium text-orange-700 hover:bg-orange-50 dark:text-orange-400">📋 Paste list</button>;
  }
  return (
    <div className="w-full space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <div className="text-xs text-gray-500">
        <strong>Type or paste.</strong> Separate words by new lines <em>or</em> commas —{' '}
        <code>பொற்கதிர், இளங்கதிர்</code> adds two. Optional meaning after a dash/pipe:{' '}
        <code>நிலா — moon</code>; a whole line of words shares that meaning. Register/usage/themes
        below apply to all — and <strong>Enrich</strong> can fill in the rest afterwards.
      </div>
      {/* TransliterateField, not a bare <textarea>: Raj's constraint is that
          typing Tamil manually is the hard part, so the multi-word surface
          needs the same romanised input the single Add form already had. */}
      <TransliterateField
        value={text}
        onChange={setText}
        multiline
        rows={6}
        ariaLabel="paste words"
        placeholder={'நிலா — moon\nபொற்கதிர், இளங்கதிர்\nவானம் | sky'}
        className="w-full rounded-md border border-gray-300 px-2 py-1.5 font-tamil dark:border-gray-600 dark:bg-gray-900"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Select value={register} onChange={setRegister} placeholder="register" options={LEXICON_REGISTERS} />
        <Select value={usage} onChange={setUsage} placeholder="usage" options={LEXICON_USAGES} />
        <span className="text-xs text-gray-400">{progress || `${parsed.words.length} ready${parsed.skipped ? `, ${parsed.skipped} skipped` : ''}`}</span>
      </div>
      <ThemePicker themes={themes} onToggle={(t) => setThemes((p) => p.includes(t) ? p.filter((x) => x !== t) : [...p, t])} />
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy || parsed.words.length === 0} className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60">{busy ? 'Importing…' : `Import ${parsed.words.length}`}</button>
        <button onClick={() => setOpen(false)} className="rounded-md border border-gray-300 px-4 py-1.5 text-sm">Cancel</button>
      </div>
    </div>
  );
}

function SuggestPanel({ onAccepted }: { onAccepted: () => void }) {
  const [register, setRegister] = useState<string>('');
  const [theme, setTheme] = useState('');
  const [wordType, setWordType] = useState('');
  const [usage, setUsage] = useState('');
  const [mood, setMood] = useState('');
  const [relatedTo, setRelatedTo] = useState('');
  const [count, setCount] = useState(12);
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const run = async () => {
    setBusy(true); setSuggestions(null); setPicked(new Set());
    try {
      const res = await adminFetch('/api/admin/lexicon/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          register: register || undefined,
          theme: theme || undefined,
          wordType: wordType || undefined,
          usage: usage || undefined,
          mood: mood || undefined,
          relatedTo: relatedTo.trim() || undefined,
          count,
        }),
      });
      const d = await res.json();
      if (res.status === 503) { toast.error('AI is not configured'); return; }
      if (!res.ok) throw new Error(d?.error || 'Failed');
      const list: Suggestion[] = Array.isArray(d.data) ? d.data : [];
      setSuggestions(list);
      setPicked(new Set(list.map((_, i) => i))); // pre-select all
      if (list.length === 0) toast('No new suggestions');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Suggest failed');
    } finally {
      setBusy(false);
    }
  };

  const accept = async () => {
    if (!suggestions) return;
    const chosen = suggestions.filter((_, i) => picked.has(i));
    if (chosen.length === 0) { toast.error('Nothing selected'); return; }
    setBusy(true);
    try {
      const res = await adminFetch('/api/admin/lexicon/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: chosen }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || 'Failed');
      toast.success(`Added ${d.added}${d.skipped ? `, skipped ${d.skipped}` : ''}`);
      setSuggestions(null);
      onAccepted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-orange-200 bg-orange-50/40 p-3 dark:border-gray-700 dark:bg-gray-800/40">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-gray-700 dark:text-gray-200">✨ AI suggest</span>
        <Select value={register} onChange={setRegister} placeholder="any register" options={LEXICON_REGISTERS} />
        <Select value={theme} onChange={setTheme} placeholder="any theme" options={LEXICON_THEMES} />
        <Select value={wordType} onChange={setWordType} placeholder="any type" options={LEXICON_WORD_TYPES} />
        <Select value={mood} onChange={setMood} placeholder="any mood" options={LEXICON_MOODS} />
        <Select value={usage} onChange={setUsage} placeholder="any freshness" options={LEXICON_USAGES} />
        <input type="number" min={1} max={30} value={count} onChange={(e) => setCount(Math.max(1, Math.min(30, Number(e.target.value) || 12)))} aria-label="how many" className="w-16 rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600 dark:bg-gray-900" />
        <button onClick={run} disabled={busy} className="rounded-md bg-orange-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-60">{busy ? 'Working…' : 'Suggest'}</button>
      </div>
      {/* "Related to" asks for a semantic field, not a substring: மழை should
          bring back சாரல் and மண்வாசம், which share no letters with it. */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="text-xs text-gray-500">Related to word</label>
        <TransliterateField value={relatedTo} onChange={setRelatedTo} placeholder="மழை" />
      </div>

      {suggestions && suggestions.length > 0 && (
        <div className="space-y-2">
          <ul className="max-h-72 space-y-1 overflow-auto">
            {suggestions.map((s, i) => (
              <li key={`${s.word}-${i}`} className="flex flex-wrap items-center gap-2 text-sm">
                <input type="checkbox" checked={picked.has(i)} onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n; })} aria-label={`select ${s.word}`} />
                <span className="font-tamil font-medium text-gray-900 dark:text-gray-100">{s.word}</span>
                {s.romanization && <span className="text-xs text-gray-400">{s.romanization}</span>}
                <span className="text-gray-600 dark:text-gray-300">— {s.gloss}</span>
                <span className="text-[10px] text-gray-400">{(s.registers ?? [s.register]).join('/')}</span>
                {/* Say when the model itself calls it a coinage. */}
                {(s.lexicalStatus === 'creative-poetic' || s.lexicalStatus === 'modern-compound') && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">coined</span>
                )}
              </li>
            ))}
          </ul>
          <button onClick={accept} disabled={busy} className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60">Add selected ({picked.size})</button>
        </div>
      )}
    </div>
  );
}
