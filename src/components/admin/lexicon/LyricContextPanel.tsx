'use client';

/**
 * LYRIC CONTEXT — paste a line, get the concepts in it and vocabulary to explore.
 *
 * ⚠️ IT DOES NOT REWRITE THE LINE, and the UI says so out loud. Raj is a poet
 * of 35 years who wants AI to improve his craft, not ghostwrite it
 * ([[feedback_tamilagaval_ai_augments_craft]]); a panel that quietly offered
 * "here's a better version" would be the wrong tool no matter how good the
 * suggestion was. So the line is echoed back unchanged, and everything below it
 * is individual WORDS.
 */

import { useState } from 'react';
import toast from 'react-hot-toast';
import { adminFetch } from '@/lib/client-auth';
import { TransliterateField } from '@/components/admin/TransliterateField';

interface Suggestion {
  word: string;
  gloss?: string;
  note?: string;
  register?: string;
  known?: boolean;
}

export function LyricContextPanel() {
  const [line, setLine] = useState('');
  const [busy, setBusy] = useState(false);
  const [concepts, setConcepts] = useState<string[] | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [analyzed, setAnalyzed] = useState('');

  const run = async () => {
    const text = line.trim();
    if (!text) { toast.error('Paste a line first'); return; }
    setBusy(true);
    try {
      const res = await adminFetch('/api/admin/lexicon/lyric-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line: text }),
      });
      const d = await res.json();
      if (res.status === 503) { toast.error('AI is not configured'); return; }
      if (!res.ok) throw new Error(d?.error || 'Failed');
      setConcepts(Array.isArray(d.concepts) ? d.concepts : []);
      setSuggestions(Array.isArray(d.suggestions) ? d.suggestions : []);
      setAnalyzed(text);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <div className="text-sm font-medium text-gray-700 dark:text-gray-200">📝 Lyric context</div>
      <p className="text-xs text-gray-500">
        Paste a line to see the concepts in it and related Tamil imagery to explore.
        <strong> Your line is never rewritten</strong> — these are words to consider, not a replacement.
      </p>
      <TransliterateField
        value={line}
        onChange={setLine}
        multiline
        rows={2}
        ariaLabel="lyric line"
        placeholder="மாலை வானம் சிவக்குதே"
        className="w-full rounded-md border border-gray-300 px-2 py-1.5 font-tamil dark:border-gray-600 dark:bg-gray-900"
      />
      <button
        onClick={run}
        disabled={busy}
        className="rounded-md bg-orange-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-60"
      >
        {busy ? 'Reading…' : 'Read the line'}
      </button>

      {concepts && (
        <div className="space-y-3">
          {/* Echo the line back verbatim, so it is visibly untouched. */}
          <div className="rounded-md bg-gray-50 px-3 py-2 font-tamil text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-200">
            {analyzed}
          </div>

          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-gray-400">Concepts</div>
            {concepts.length ? (
              <div className="flex flex-wrap gap-1">
                {concepts.map((c) => (
                  <span key={c} className="rounded-full bg-indigo-50 px-2 py-0.5 font-tamil text-xs text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                    {c}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400">Nothing identified.</p>
            )}
          </div>

          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-gray-400">Vocabulary to explore</div>
            {suggestions.length ? (
              <ul className="grid gap-1 sm:grid-cols-2">
                {suggestions.map((s) => (
                  <li key={s.word} className="rounded-md border border-gray-100 px-2 py-1 text-sm dark:border-gray-800">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-tamil font-medium text-gray-900 dark:text-gray-100">{s.word}</span>
                      {s.gloss && <span className="text-xs text-gray-500">{s.gloss}</span>}
                      {s.register && <span className="text-[10px] text-gray-400">{s.register}</span>}
                      {s.known && <span className="text-[10px] text-green-600">already yours</span>}
                    </div>
                    {s.note && <p className="text-xs text-gray-600 dark:text-gray-300">{s.note}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-gray-400">No suggestions.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
