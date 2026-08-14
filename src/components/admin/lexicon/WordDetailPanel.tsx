'use client';

/**
 * WORD DETAIL — everything known about one entry, plus the two discovery tools
 * that only make sense in the context of a single word: its WORD FAMILY and
 * FIND ALTERNATIVES.
 *
 * The main table deliberately shows eight columns and no more; this is where
 * the depth lives, so the table stays readable at 1,047 rows.
 *
 * Two honesty rules are enforced visually, not just in the data:
 *  - a coined compound is badged as a construction, never displayed as though
 *    it were an attested dictionary headword
 *  - alternatives are shown WITH their nuance, and anything not marked
 *    interchangeable says so, because அழகு / எழில் / வனப்பு are not swappable
 */

import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { adminFetch } from '@/lib/client-auth';
import { buildWordFamily, type FamilyMember } from '@/lib/lexicon-family';
import { CONSTRUCTED_STATUSES, REGISTER_DESCRIPTIONS, LEXICAL_STATUS_DESCRIPTIONS } from '@/types/lexicon';
import type { LexiconRow } from './types';

interface Alternative {
  word: string;
  gloss: string;
  nuance: string;
  register?: string;
  lexicalStatus?: string;
  interchangeable?: boolean;
  known?: boolean;
}

const RELATION_LABEL: Record<FamilyMember['relation'], string> = {
  listed: 'you linked it',
  'derived-form': 'derived form',
  compound: 'compound',
  'shares-stem': 'shares a stem',
};

/** A labelled block, rendered only when there is something to show. */
function Field({ label, children }: { label: string; children?: React.ReactNode }) {
  if (children === undefined || children === null || children === '' ) return null;
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-sm text-gray-700 dark:text-gray-200">{children}</div>
    </div>
  );
}

function Chips({ items, tone = 'gray' }: { items?: string[]; tone?: 'gray' | 'orange' | 'blue' }) {
  if (!items?.length) return null;
  const cls =
    tone === 'orange'
      ? 'bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300'
      : tone === 'blue'
        ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300';
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((t) => (
        <span key={t} className={`rounded-full px-2 py-0.5 text-xs font-tamil ${cls}`}>
          {t}
        </span>
      ))}
    </div>
  );
}

export function WordDetailPanel({
  word,
  lexicon,
  onClose,
  onEdit,
  onOpenWord,
}: {
  word: LexiconRow;
  lexicon: LexiconRow[];
  onClose: () => void;
  onEdit: () => void;
  onOpenWord: (id: string) => void;
}) {
  const [alternatives, setAlternatives] = useState<Alternative[] | null>(null);
  const [busy, setBusy] = useState(false);

  // Clear AI results when the panel moves to a different word — otherwise the
  // alternatives for மலர் sit under the heading for வைகறை.
  useEffect(() => {
    setAlternatives(null);
  }, [word.id]);

  // The family is computed from the lexicon already in memory: instant, and it
  // cannot invent a relative that is not really there. `LexiconRow` satisfies
  // `FamilyEntry` structurally, so no mapping is needed.
  const family = useMemo(() => buildWordFamily(word.word, lexicon), [word.word, lexicon]);

  const constructed = !!word.lexicalStatus && (CONSTRUCTED_STATUSES as readonly string[]).includes(word.lexicalStatus);

  const loadAlternatives = async () => {
    setBusy(true);
    try {
      const res = await adminFetch('/api/admin/lexicon/alternatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: word.word, gloss: word.gloss }),
      });
      const d = await res.json();
      if (res.status === 503) {
        toast.error('AI is not configured');
        return;
      }
      if (!res.ok) throw new Error(d?.error || 'Failed');
      setAlternatives(Array.isArray(d.data) ? d.data : []);
      if (!d.data?.length) toast('No alternatives came back');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-tamil text-2xl font-semibold text-gray-900 dark:text-gray-100">{word.word}</h3>
          {word.romanization && <div className="text-xs text-gray-400">{word.romanization}</div>}
        </div>
        <div className="flex gap-2 text-xs">
          <button onClick={onEdit} className="text-blue-600 hover:text-blue-800">Edit</button>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close detail">✕</button>
        </div>
      </div>

      {/* The honesty badge. A coinage is a fine word to sing and a poor word to
          cite; saying so here is the whole point of `lexicalStatus`. */}
      {constructed && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <strong>Poetic construction.</strong> {word.lexicalStatus && LEXICAL_STATUS_DESCRIPTIONS[word.lexicalStatus as keyof typeof LEXICAL_STATUS_DESCRIPTIONS]}{' '}
          Use it freely — just don&apos;t cite it as an established dictionary word.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="English gloss">{word.gloss}</Field>
        <Field label="Tamil meaning">
          <span className="font-tamil">{word.tamilMeaning}</span>
        </Field>
        <Field label="Register">
          <div className="flex flex-wrap gap-1">
            {(word.registers?.length ? word.registers : [word.register]).map((r) => (
              <span
                key={r}
                title={REGISTER_DESCRIPTIONS[r as keyof typeof REGISTER_DESCRIPTIONS]}
                className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
              >
                {r}
              </span>
            ))}
          </div>
        </Field>
        <Field label="Word type">{word.wordType}</Field>
        <Field label="Lexical status">{word.lexicalStatus}</Field>
        <Field label="Confidence">{word.confidence ?? <span className="text-gray-400">not reviewed</span>}</Field>
        <Field label="Usage">{word.usage}</Field>
        <Field label="Themes"><Chips items={word.themes} tone="orange" /></Field>
        <Field label="Moods"><Chips items={word.moods} tone="blue" /></Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Synonyms"><Chips items={word.synonyms} /></Field>
        <Field label="Related"><Chips items={word.relatedWords} /></Field>
        <Field label="Antonyms"><Chips items={word.antonyms} /></Field>
        <Field label="எதுகை (etukai)"><Chips items={word.etukai} /></Field>
        <Field label="மோனை (monai)"><Chips items={word.monai} /></Field>
        <Field label="Rhymes with"><Chips items={word.rhymesWith} /></Field>
      </div>

      <Field label="Poetic usage">
        <p className="font-tamil leading-relaxed">{word.poeticUsage}</p>
      </Field>

      {!!word.examples?.length && (
        <Field label="Example phrases">
          <ul className="space-y-1 font-tamil">
            {word.examples.map((e) => (
              <li key={e} className="text-gray-700 dark:text-gray-200">• {e}</li>
            ))}
          </ul>
        </Field>
      )}

      <Field label="Notes">{word.notes}</Field>

      {/* ---- Word family ---------------------------------------------- */}
      <section className="border-t border-gray-100 pt-3 dark:border-gray-800">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Word family <span className="font-normal normal-case text-gray-400">· stem {family.stem}</span>
        </h4>
        {family.members.length === 0 ? (
          <p className="text-xs text-gray-400">
            No relatives in the lexicon yet. Enrichment can propose forms like {word.word}தல் / {word.word}ச்சி.
          </p>
        ) : (
          <ul className="space-y-1">
            {family.members.map((m) => (
              <li key={m.word} className="flex flex-wrap items-baseline gap-2 text-sm">
                {m.id ? (
                  <button
                    onClick={() => onOpenWord(m.id!)}
                    className="font-tamil font-medium text-blue-700 hover:underline dark:text-blue-400"
                  >
                    {m.word}
                  </button>
                ) : (
                  <span className="font-tamil font-medium text-gray-500">{m.word}</span>
                )}
                {m.gloss && <span className="text-xs text-gray-500">{m.gloss}</span>}
                {/* Established vs constructed, stated per member — the
                    distinction Raj asked to be able to see at a glance. */}
                {m.constructed ? (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                    coined
                  </span>
                ) : m.lexicalStatus ? (
                  <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] text-green-800 dark:bg-green-950/50 dark:text-green-300">
                    established
                  </span>
                ) : null}
                <span className="text-[10px] text-gray-400">{RELATION_LABEL[m.relation]}</span>
                {m.missing && <span className="text-[10px] text-gray-400">· not in lexicon</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- Find alternatives ---------------------------------------- */}
      <section className="border-t border-gray-100 pt-3 dark:border-gray-800">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Alternatives</h4>
          <button
            onClick={loadAlternatives}
            disabled={busy}
            className="rounded-md border border-orange-500 px-2 py-1 text-xs font-medium text-orange-700 hover:bg-orange-50 disabled:opacity-60 dark:text-orange-400 dark:hover:bg-gray-800"
          >
            {busy ? 'Thinking…' : 'Find alternatives'}
          </button>
        </div>
        {alternatives && alternatives.length === 0 && <p className="text-xs text-gray-400">Nothing came back.</p>}
        {!!alternatives?.length && (
          <ul className="space-y-2">
            {alternatives.map((a) => (
              <li key={a.word} className="rounded-md border border-gray-100 p-2 dark:border-gray-800">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-tamil font-medium text-gray-900 dark:text-gray-100">{a.word}</span>
                  <span className="text-xs text-gray-500">{a.gloss}</span>
                  {a.register && <span className="text-[10px] text-gray-400">{a.register}</span>}
                  {a.known && <span className="text-[10px] text-green-600">already yours</span>}
                </div>
                {/* The nuance is the reason this feature exists — never render a
                    bare synonym list that implies free substitution. */}
                <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-300">{a.nuance}</p>
                {a.interchangeable === false && (
                  <p className="text-[10px] text-amber-700 dark:text-amber-400">Not a drop-in replacement.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
