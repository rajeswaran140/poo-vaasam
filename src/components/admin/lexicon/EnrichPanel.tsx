'use client';

/**
 * ENRICH — AI proposes the metadata that bulk-pasted words are missing, and the
 * poet accepts them one at a time.
 *
 * ⚠️ EVERY PROPOSAL IS A SUGGESTION, AND NOTHING IS APPLIED WITHOUT A CLICK.
 * Raj's instruction: *"AI-generated enrichment must be treated as suggestions
 * and remain editable."* So this panel shows the proposed values, lets him
 * apply per word, and never writes in bulk. Applying uses the ordinary PUT, so
 * the same validation and the same audit trail apply as for a manual edit.
 *
 * It defaults to the words that actually need it (no Tamil meaning, no themes,
 * no word type) — on a 1,047-word lexicon where every entry is bare, "enrich
 * everything" would be a very expensive way to get an unreviewable wall.
 */

import { useState } from 'react';
import toast from 'react-hot-toast';
import { adminFetch } from '@/lib/client-auth';
import type { LexiconRow } from './types';

interface Enrichment {
  id?: string;
  word: string;
  gloss?: string;
  tamilMeaning?: string;
  registers?: string[];
  wordType?: string;
  lexicalStatus?: string;
  confidence?: string;
  themes?: string[];
  moods?: string[];
  synonyms?: string[];
  relatedWords?: string[];
  poeticUsage?: string;
  examples?: string[];
}

/** Fields the panel offers to write, in display order. */
const FIELDS: ReadonlyArray<[keyof Enrichment, string]> = [
  ['tamilMeaning', 'Tamil meaning'],
  ['gloss', 'Gloss'],
  ['registers', 'Register'],
  ['wordType', 'Type'],
  ['lexicalStatus', 'Status'],
  ['confidence', 'Confidence'],
  ['themes', 'Themes'],
  ['moods', 'Moods'],
  ['synonyms', 'Synonyms'],
  ['relatedWords', 'Related'],
  ['poeticUsage', 'Poetic usage'],
  ['examples', 'Examples'],
];

const show = (v: unknown): string => (Array.isArray(v) ? v.join(', ') : typeof v === 'string' ? v : '');

export function EnrichPanel({ words, onApplied }: { words: LexiconRow[]; onApplied: () => void }) {
  const [busy, setBusy] = useState(false);
  const [proposals, setProposals] = useState<Enrichment[] | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());

  const bare = words.filter((w) => !w.archived && (!w.tamilMeaning || !w.themes.length || !w.wordType));

  const run = async () => {
    setBusy(true);
    try {
      const res = await adminFetch('/api/admin/lexicon/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ missingOnly: true }),
      });
      const d = await res.json();
      if (res.status === 503) { toast.error('AI is not configured'); return; }
      if (!res.ok) throw new Error(d?.error || 'Failed');
      setProposals(Array.isArray(d.data) ? d.data : []);
      setApplied(new Set());
      if (!d.data?.length) toast('Nothing came back');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const apply = async (p: Enrichment) => {
    if (!p.id) { toast.error('No matching entry'); return; }
    // Send only fields the model actually filled in — an absent field must stay
    // absent rather than being overwritten with an empty value.
    const patch: Record<string, unknown> = {};
    for (const [key] of FIELDS) {
      const v = p[key];
      if (v === undefined || v === null) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      if (typeof v === 'string' && !v.trim()) continue;
      patch[key] = v;
    }
    if (!Object.keys(patch).length) { toast.error('Nothing to apply'); return; }

    const res = await adminFetch(`/api/admin/lexicon/${p.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      setApplied((prev) => new Set(prev).add(p.id!));
      toast.success(`${p.word} updated`);
      onApplied();
    } else {
      toast.error('Could not apply');
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">🪄 Enrich imported words</span>
        <button
          onClick={run}
          disabled={busy || bare.length === 0}
          className="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-700 disabled:opacity-60"
        >
          {busy ? 'Working…' : 'Propose metadata'}
        </button>
        <span className="text-xs text-gray-500">{bare.length} words are missing meaning, themes or type</span>
      </div>
      <p className="text-xs text-gray-500">
        Proposals only — review each one and apply it. Nothing is saved until you click <em>Apply</em>.
      </p>

      {proposals?.map((p) => (
        <div key={p.word} className="rounded-md border border-gray-100 p-2 dark:border-gray-800">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <span className="font-tamil text-base font-medium text-gray-900 dark:text-gray-100">{p.word}</span>
            <button
              onClick={() => apply(p)}
              disabled={!p.id || applied.has(p.id)}
              className="rounded border border-green-600 px-2 py-0.5 text-[11px] font-medium text-green-700 hover:bg-green-50 disabled:opacity-50 dark:text-green-400 dark:hover:bg-gray-800"
            >
              {p.id && applied.has(p.id) ? 'applied' : 'Apply'}
            </button>
          </div>
          <dl className="grid gap-x-3 gap-y-0.5 text-xs sm:grid-cols-2">
            {FIELDS.map(([key, label]) => {
              const v = show(p[key]);
              if (!v) return null;
              return (
                <div key={String(key)} className="flex gap-1">
                  <dt className="shrink-0 text-gray-400">{label}:</dt>
                  <dd className="font-tamil text-gray-700 dark:text-gray-200">{v}</dd>
                </div>
              );
            })}
          </dl>
        </div>
      ))}
    </div>
  );
}
