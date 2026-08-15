'use client';

/**
 * BULK EDIT BAR — apply one change to every selected entry.
 *
 * This is the piece that makes the ~1,046 defaulted-`sangam` entries tractable:
 * filter to them, select the page, set the honest register, apply. One at a
 * time it is a thousand round trips.
 *
 * ⚠️ THEMES ADD RATHER THAN REPLACE. Setting a theme list across a selection
 * would erase whatever themes each entry already had, silently, in bulk. The
 * bar therefore offers "add theme" and "remove theme" and no way to express a
 * wholesale replace — that stays a single-entry action where the poet can see
 * the chips he is overwriting.
 *
 * ⚠️ PARTIAL FAILURE IS SHOWN. The endpoint writes entries individually, so it
 * can succeed for some and fail for others. The bar reports the real numbers
 * instead of a green tick.
 */

import { useState } from 'react';
import toast from 'react-hot-toast';
import { adminFetch } from '@/lib/client-auth';
import {
  LEXICON_REGISTERS,
  LEXICON_USAGES,
  LEXICON_THEMES,
  LEXICON_WORD_TYPES,
  LEXICAL_STATUSES,
  LEXICON_CONFIDENCE,
  REGISTER_DESCRIPTIONS,
  BULK_UPDATE_MAX_IDS,
} from '@/types/lexicon';

export function BulkEditBar({
  selectedIds,
  onClear,
  onApplied,
}: {
  selectedIds: string[];
  onClear: () => void;
  onApplied: () => void;
}) {
  const [registers, setRegisters] = useState<string[]>([]);
  const [usage, setUsage] = useState('');
  const [wordType, setWordType] = useState('');
  const [lexicalStatus, setLexicalStatus] = useState('');
  const [confidence, setConfidence] = useState('');
  const [addTheme, setAddTheme] = useState('');
  const [removeTheme, setRemoveTheme] = useState('');
  const [busy, setBusy] = useState(false);

  const count = selectedIds.length;
  const overCap = count > BULK_UPDATE_MAX_IDS;

  const hasChange =
    registers.length > 0 || !!usage || !!wordType || !!lexicalStatus || !!confidence || !!addTheme || !!removeTheme;

  const apply = async () => {
    if (!hasChange) { toast.error('Choose what to change first'); return; }
    setBusy(true);
    try {
      const res = await adminFetch('/api/admin/lexicon/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: selectedIds.slice(0, BULK_UPDATE_MAX_IDS),
          ...(registers.length ? { registers } : {}),
          ...(usage ? { usage } : {}),
          ...(wordType ? { wordType } : {}),
          ...(lexicalStatus ? { lexicalStatus } : {}),
          ...(confidence ? { confidence } : {}),
          ...(addTheme ? { addThemes: [addTheme] } : {}),
          ...(removeTheme ? { removeThemes: [removeTheme] } : {}),
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || 'Failed');

      if (d.failed?.length) {
        // Say what actually happened. "Updated 200" when 60 failed is worse
        // than an error, because the work looks done.
        toast.error(`Updated ${d.updated} of ${d.requested} — ${d.failed.length} failed`);
      } else {
        toast.success(`Updated ${d.updated} word${d.updated === 1 ? '' : 's'}`);
      }
      setRegisters([]); setUsage(''); setWordType(''); setLexicalStatus(''); setConfidence('');
      setAddTheme(''); setRemoveTheme('');
      onApplied();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const toggleRegister = (r: string) =>
    setRegisters((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : prev.length < 3 ? [...prev, r] : prev));

  return (
    <div className="sticky top-0 z-20 space-y-2 rounded-lg border border-orange-400 bg-orange-50 p-3 shadow-sm dark:border-orange-800 dark:bg-gray-800">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <strong className="text-gray-800 dark:text-gray-100">{count} selected</strong>
        <button onClick={onClear} className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">clear</button>
        {overCap && (
          <span className="text-xs text-amber-700 dark:text-amber-400">
            only the first {BULK_UPDATE_MAX_IDS} will be changed — narrow the filter or work in pages
          </span>
        )}
      </div>

      {/* Register: the reason this bar exists. */}
      <div className="flex flex-wrap items-center gap-1">
        <span className="w-20 shrink-0 text-[11px] uppercase tracking-wide text-gray-500">Register</span>
        {LEXICON_REGISTERS.map((r) => (
          <button
            key={r}
            onClick={() => toggleRegister(r)}
            title={REGISTER_DESCRIPTIONS[r]}
            className={`rounded-full px-2 py-0.5 text-xs ${
              registers.includes(r) ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 dark:bg-gray-900 dark:text-gray-300'
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Pick label="Usage" value={usage} onChange={setUsage} options={LEXICON_USAGES} />
        <Pick label="Type" value={wordType} onChange={setWordType} options={LEXICON_WORD_TYPES} />
        <Pick label="Status" value={lexicalStatus} onChange={setLexicalStatus} options={LEXICAL_STATUSES} />
        <Pick label="Confidence" value={confidence} onChange={setConfidence} options={LEXICON_CONFIDENCE} />
        <Pick label="Add theme" value={addTheme} onChange={setAddTheme} options={LEXICON_THEMES} />
        <Pick label="Remove theme" value={removeTheme} onChange={setRemoveTheme} options={LEXICON_THEMES} />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={apply}
          disabled={busy || !hasChange}
          className="rounded-md bg-orange-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
        >
          {busy ? 'Applying…' : `Apply to ${Math.min(count, BULK_UPDATE_MAX_IDS)}`}
        </button>
        <span className="text-[11px] text-gray-500">
          Themes are <strong>added</strong> to what each word already has, never replaced.
        </span>
      </div>
    </div>
  );
}

function Pick({
  label, value, onChange, options,
}: { label: string; value: string; onChange: (v: string) => void; options: readonly string[] }) {
  return (
    <label className="flex items-center gap-1">
      <span className="text-gray-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`bulk ${label.toLowerCase()}`}
        className="rounded border border-gray-300 px-1 py-0.5 dark:border-gray-600 dark:bg-gray-900"
      >
        <option value="">—</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
