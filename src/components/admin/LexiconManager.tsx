'use client';

/**
 * LexiconManager — admin UI for the lyric word-family dictionary.
 * Filter/search, inline usage edits, add a word, and AI-assisted seeding
 * (suggest → review → bulk-accept). Talks to /api/admin/lexicon* via adminFetch.
 */

import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { adminFetch } from '@/lib/client-auth';
import { TransliterateField } from '@/components/admin/TransliterateField';
import { LEXICON_REGISTERS, LEXICON_USAGES, LEXICON_THEMES } from '@/types/lexicon';

export interface LexiconRow {
  id: string;
  word: string;
  romanization?: string;
  gloss: string;
  register: string;
  usage: string;
  themes: string[];
  usageCount: number;
  archived: boolean;
}

interface Suggestion {
  word: string;
  romanization?: string;
  gloss: string;
  register: string;
  themes: string[];
  usage: string;
}

const USAGE_STYLE: Record<string, string> = {
  fresh: 'text-green-700 bg-green-50',
  neutral: 'text-gray-600 bg-gray-100',
  retire: 'text-red-700 bg-red-50',
};

export function LexiconManager({ initial }: { initial: LexiconRow[] }) {
  const [words, setWords] = useState<LexiconRow[]>(initial);
  const [fRegister, setFRegister] = useState('');
  const [fUsage, setFUsage] = useState('');
  const [fTheme, setFTheme] = useState('');
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const visible = useMemo(() => {
    const needle = q.normalize('NFC').trim().toLowerCase();
    return words.filter((w) => {
      if (!showArchived && w.archived) return false;
      if (fRegister && w.register !== fRegister) return false;
      if (fUsage && w.usage !== fUsage) return false;
      if (fTheme && !w.themes.includes(fTheme)) return false;
      if (needle && !`${w.word} ${w.romanization ?? ''} ${w.gloss}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [words, fRegister, fUsage, fTheme, q, showArchived]);

  const reload = async () => {
    const res = await adminFetch('/api/admin/lexicon?archived=true');
    if (res.ok) {
      const d = await res.json();
      if (Array.isArray(d.data)) setWords(d.data);
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
    if (res.ok) setWords((prev) => prev.filter((w) => w.id !== id));
    else toast.error('Delete failed');
  };

  return (
    <div className="space-y-6">
      <AddWord onAdded={(w) => setWords((prev) => [w, ...prev])} />
      <SuggestPanel onAccepted={reload} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search word / gloss…"
          className="rounded-md border border-gray-300 px-3 py-1.5 font-tamil dark:border-gray-600 dark:bg-gray-900"
        />
        <Select value={fRegister} onChange={setFRegister} placeholder="All registers" options={LEXICON_REGISTERS} />
        <Select value={fUsage} onChange={setFUsage} placeholder="All usage" options={LEXICON_USAGES} />
        <Select value={fTheme} onChange={setFTheme} placeholder="All themes" options={LEXICON_THEMES} />
        <label className="flex items-center gap-1 text-gray-500">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> archived
        </label>
        <span className="ml-auto text-gray-400">{visible.length} words</span>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            <tr>
              <th className="px-3 py-2">Word</th>
              <th className="px-3 py-2">Gloss</th>
              <th className="px-3 py-2">Register</th>
              <th className="px-3 py-2">Usage</th>
              <th className="px-3 py-2">Themes</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {visible.map((w) => (
              <tr key={w.id} className={w.archived ? 'opacity-50' : ''}>
                <td className="px-3 py-2">
                  <div className="font-tamil font-medium text-gray-900 dark:text-gray-100">{w.word}</div>
                  {w.romanization && <div className="text-xs text-gray-400">{w.romanization}</div>}
                </td>
                <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{w.gloss}</td>
                <td className="px-3 py-2 text-gray-500">{w.register}</td>
                <td className="px-3 py-2">
                  <select
                    value={w.usage}
                    onChange={(e) => setUsage(w.id, e.target.value)}
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
                <td className="px-3 py-2 text-right text-xs">
                  <button onClick={() => toggleArchive(w)} className="mr-2 text-gray-500 hover:text-gray-800">{w.archived ? 'Restore' : 'Archive'}</button>
                  <button onClick={() => remove(w.id)} className="text-red-500 hover:text-red-700">Delete</button>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">No words. Add one or use AI suggest.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
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

function AddWord({ onAdded }: { onAdded: (w: LexiconRow) => void }) {
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState('');
  const [gloss, setGloss] = useState('');
  const [register, setRegister] = useState<string>(LEXICON_REGISTERS[0]);
  const [usage, setUsage] = useState<string>('fresh');
  const [themes, setThemes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!word.trim() || !gloss.trim()) { toast.error('Word + gloss required'); return; }
    setBusy(true);
    try {
      const res = await adminFetch('/api/admin/lexicon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word, gloss, register, usage, themes }),
      });
      const d = await res.json();
      if (res.status === 409) { toast.error('Word already exists'); return; }
      if (!res.ok) throw new Error(d?.error || 'Failed');
      onAdded({ id: d.data.id, word: d.data.word, gloss: d.data.gloss, register: d.data.register, usage: d.data.usage, themes: d.data.themes, romanization: d.data.romanization, usageCount: 0, archived: false });
      setWord(''); setGloss(''); setThemes([]);
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
    <div className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      {/* Tamil headword — type English to transliterate (e.g. amma → அம்மா),
          or paste/type Tamil directly. ↑↓ choose · Enter/Tab/Space commit. */}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">சொல் (word) — type: amma, nila</label>
        <TransliterateField value={word} onChange={setWord} placeholder="சொல்" />
      </div>
      <div className="flex flex-wrap gap-2">
        <input value={gloss} onChange={(e) => setGloss(e.target.value)} placeholder="meaning (English)" className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600 dark:bg-gray-900" />
        <Select value={register} onChange={setRegister} placeholder="register" options={LEXICON_REGISTERS} />
        <Select value={usage} onChange={setUsage} placeholder="usage" options={LEXICON_USAGES} />
      </div>
      <div className="flex flex-wrap gap-1">
        {LEXICON_THEMES.map((t) => (
          <button key={t} type="button" onClick={() => setThemes((p) => p.includes(t) ? p.filter((x) => x !== t) : [...p, t])}
            className={`rounded-full px-2 py-0.5 text-xs ${themes.includes(t) ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{t}</button>
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy} className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60">{busy ? 'Saving…' : 'Save'}</button>
        <button onClick={() => setOpen(false)} className="rounded-md border border-gray-300 px-4 py-1.5 text-sm">Cancel</button>
      </div>
    </div>
  );
}

function SuggestPanel({ onAccepted }: { onAccepted: () => void }) {
  const [register, setRegister] = useState<string>(LEXICON_REGISTERS[0]);
  const [theme, setTheme] = useState('');
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
        body: JSON.stringify({ register, theme: theme || undefined, count }),
      });
      const d = await res.json();
      if (res.status === 503) { toast.error('AI not configured (ANTHROPIC_API_KEY)'); return; }
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
        <Select value={register} onChange={setRegister} placeholder="register" options={LEXICON_REGISTERS} />
        <Select value={theme} onChange={setTheme} placeholder="any theme" options={LEXICON_THEMES} />
        <input type="number" min={1} max={30} value={count} onChange={(e) => setCount(Math.max(1, Math.min(30, Number(e.target.value) || 12)))} className="w-16 rounded-md border border-gray-300 px-2 py-1.5 dark:border-gray-600 dark:bg-gray-900" />
        <button onClick={run} disabled={busy} className="rounded-md bg-orange-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-60">{busy ? 'Working…' : 'Suggest'}</button>
      </div>

      {suggestions && suggestions.length > 0 && (
        <div className="space-y-2">
          <ul className="max-h-72 space-y-1 overflow-auto">
            {suggestions.map((s, i) => (
              <li key={`${s.word}-${i}`} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={picked.has(i)} onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n; })} />
                <span className="font-tamil font-medium text-gray-900 dark:text-gray-100">{s.word}</span>
                {s.romanization && <span className="text-xs text-gray-400">{s.romanization}</span>}
                <span className="text-gray-600 dark:text-gray-300">— {s.gloss}</span>
              </li>
            ))}
          </ul>
          <button onClick={accept} disabled={busy} className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60">Add selected ({picked.size})</button>
        </div>
      )}
    </div>
  );
}
