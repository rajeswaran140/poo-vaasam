'use client';

/**
 * LYRIC METER LAB — paste a Tamil line, see its structure, work out its rhythm
 * against a metronome, and look words up in the Lexicon without leaving.
 *
 * The three principles this screen has to hold:
 *
 * 1. **The line is the poet's.** Nothing here rewrites it. Words are never
 *    split, never reordered, never replaced automatically. Lexicon results are
 *    offered as *discover → compare → select*, and selecting copies to the
 *    clipboard rather than editing the line.
 * 2. **A suggested meter is labelled suggested.** The badge says so, the
 *    reasoning is printed next to it, and the meters that fit equally well are
 *    named. §24: "Meter: 6/8" and "Suggested meter: 6/8" are not the same claim.
 * 3. **Sustain is a property of the word.** Words ending in an open long vowel
 *    are marked as the ones a singer can hold — the poet chooses which to use.
 */

import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { adminFetch } from '@/lib/client-auth';
import { TransliterateField } from '@/components/admin/TransliterateField';
import { Metronome } from '@/components/admin/music/Metronome';
import { METERS, meterById, DEFAULT_BPM, type MeterId } from '@/lib/music/meter';
import { planLine, splitPhrases, readDensity, suggestMeter, type WordUnit } from '@/lib/music/lyric-meter';

const DENSITY_STYLE: Record<string, string> = {
  sparse: 'text-blue-700 bg-blue-50 dark:bg-blue-950/40 dark:text-blue-300',
  comfortable: 'text-green-700 bg-green-50 dark:bg-green-950/40 dark:text-green-300',
  busy: 'text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300',
  rushed: 'text-red-700 bg-red-50 dark:bg-red-950/40 dark:text-red-300',
};

interface LexEntry {
  id: string;
  word: string;
  gloss?: string;
  tamilMeaning?: string;
  registers?: string[];
  usage?: string;
  themes?: string[];
  wordType?: string;
  lexicalStatus?: string;
  confidence?: string;
}

interface Alternative {
  word: string;
  gloss: string;
  nuance: string;
  register?: string;
  known?: boolean;
}

export function LyricMeterLab() {
  const [line, setLine] = useState('');
  const [meterId, setMeterId] = useState<MeterId>('4/4');
  const [bpm] = useState(DEFAULT_BPM);
  const [phraseCount, setPhraseCount] = useState(2);
  const [selected, setSelected] = useState<WordUnit | null>(null);

  const meter = meterById(meterId) ?? METERS[1];
  const plan = useMemo(() => planLine(line), [line]);
  const phrases = useMemo(() => splitPhrases(plan, phraseCount), [plan, phraseCount]);
  const density = useMemo(() => readDensity(plan, bpm, meter), [plan, bpm, meter]);
  const suggestion = useMemo(() => suggestMeter(plan, METERS), [plan]);

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Lyric Meter Lab</h1>
        <p className="text-sm text-gray-500">
          Paste a line to see its syllables, phrases and sustain points, and work out the rhythm against a
          metronome. <strong>Your line is never rewritten.</strong>
        </p>
      </header>

      <TransliterateField
        value={line}
        onChange={setLine}
        multiline
        rows={2}
        ariaLabel="lyric line"
        placeholder="மழை பெய்தால் மண் வாசம்"
        className="w-full rounded-md border border-gray-300 px-3 py-2 font-tamil text-lg dark:border-gray-600 dark:bg-gray-900"
      />

      {plan.syllableCount > 0 && (
        <>
          {/* ---- structural breakdown -------------------------------- */}
          <section className="space-y-2 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
              <span><strong className="text-gray-800 dark:text-gray-100">{plan.syllableCount}</strong> syllables</span>
              <span><strong className="text-gray-800 dark:text-gray-100">{plan.words.length}</strong> words</span>
              <span className={`rounded-full px-2 py-0.5 ${DENSITY_STYLE[density.verdict]}`}>
                {density.verdict} · {density.syllablesPerSecond.toFixed(1)}/sec
              </span>
              <span>{density.message}</span>
            </div>

            {/* word | word | word — click one to look it up */}
            <div className="flex flex-wrap items-center gap-1 font-tamil text-lg">
              {plan.words.map((w, i) => (
                <span key={`${w.text}-${i}`} className="flex items-center gap-1">
                  <button
                    onClick={() => setSelected(w)}
                    aria-label={`inspect ${w.text}`}
                    className={`rounded px-2 py-0.5 hover:bg-orange-100 dark:hover:bg-gray-700 ${
                      selected?.index === w.index ? 'bg-orange-200 dark:bg-gray-700' : ''
                    } ${w.sustainable ? 'underline decoration-orange-500 decoration-2 underline-offset-4' : ''}`}
                  >
                    {w.text}
                    <sub className="ml-0.5 text-[10px] text-gray-400">{w.syllableCount}</sub>
                    {w.sustainable && <span className="ml-0.5 text-orange-600">—</span>}
                  </button>
                  {i < plan.words.length - 1 && <span className="text-gray-300">|</span>}
                </span>
              ))}
            </div>
            <p className="text-[11px] text-gray-400">
              Subscript = syllables. An underlined word ending in <span className="text-orange-600">—</span> has an
              open long vowel, so the singer can hold that note.
            </p>
          </section>

          {/* ---- phrases --------------------------------------------- */}
          <section className="space-y-2 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium text-gray-700 dark:text-gray-200">Phrases</span>
              {[2, 3, 4].map((n) => (
                <button
                  key={n}
                  onClick={() => setPhraseCount(n)}
                  className={`rounded px-2 py-0.5 text-xs ${
                    phraseCount === n ? 'bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900' : 'border border-gray-300 dark:border-gray-600'
                  }`}
                >
                  {n}
                </button>
              ))}
              <span className="text-[11px] text-gray-400">split on word boundaries — a starting point, not a rule</span>
            </div>
            {phrases.map((p) => (
              <div key={p.label} className="flex flex-wrap items-baseline gap-2">
                <span className="w-20 shrink-0 text-xs text-gray-400">{p.label}</span>
                <span className="font-tamil text-base text-gray-800 dark:text-gray-100">{p.text}</span>
                <span className="text-xs text-gray-400">{p.syllableCount} syl</span>
              </div>
            ))}
            {plan.sustainCandidates.length > 0 && (
              <p className="text-xs text-gray-500">
                Possible sustained words:{' '}
                <span className="font-tamil">{plan.sustainCandidates.map((w) => `${w.text} —`).join('  ')}</span>
              </p>
            )}
          </section>

          {/* ---- meter, clearly labelled as a suggestion -------------- */}
          <section className="space-y-2 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-gray-700 dark:text-gray-200">Meter</span>
              {METERS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMeterId(m.id)}
                  className={`rounded px-2 py-1 text-xs ${
                    meterId === m.id ? 'bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900' : 'border border-gray-300 dark:border-gray-600'
                  }`}
                >
                  {m.id}
                </button>
              ))}
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                you chose this · user-entered
              </span>
            </div>

            {suggestion && (
              <div className="rounded-md border border-dashed border-amber-400 bg-amber-50/60 px-3 py-2 text-xs dark:border-amber-800 dark:bg-amber-950/30">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
                    Suggested
                  </span>
                  <span className="text-gray-800 dark:text-gray-100">
                    <strong>{suggestion.meterId}</strong> · confidence {suggestion.confidence}
                  </span>
                  {suggestion.alternatives.length > 0 && (
                    <span className="text-gray-600 dark:text-gray-300">
                      fits equally: {suggestion.alternatives.join(', ')}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-gray-700 dark:text-gray-300">{suggestion.reasoning}</p>
              </div>
            )}
          </section>

          <Metronome initialMeter={meterId} />

          {selected && <WordLookup word={selected} onClose={() => setSelected(null)} />}
        </>
      )}
    </div>
  );
}

/**
 * Lexicon lookup for one selected word: the entry's own metadata if he has it,
 * plus meaning-related and sound-related neighbours.
 *
 * Sound-related words come from the LEXICON's own எதுகை search (words sharing
 * the ending), not from the AI — வாசம் / பாசம் / நேசம் is a rhyme fact, and
 * asking a model for it would be slower and less reliable than matching.
 */
function WordLookup({ word, onClose }: { word: WordUnit; onClose: () => void }) {
  const [entry, setEntry] = useState<LexEntry | null>(null);
  const [related, setRelated] = useState<LexEntry[]>([]);
  const [rhymes, setRhymes] = useState<LexEntry[]>([]);
  const [alts, setAlts] = useState<Alternative[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const lookup = async () => {
    setBusy(true);
    try {
      const res = await adminFetch(`/api/admin/lexicon?q=${encodeURIComponent(word.text)}`);
      const d = await res.json();
      const rows: LexEntry[] = Array.isArray(d.data) ? d.data : [];
      const exact = rows.find((r) => r.word.normalize('NFC') === word.text.normalize('NFC')) ?? null;
      setEntry(exact);
      setRelated(rows.filter((r) => r.id !== exact?.id).slice(0, 8));

      // Sound-related: same two-syllable ending (the எதுகை/இயைபு a lyricist uses).
      const tail = word.text.normalize('NFC').slice(-3);
      if (tail.length >= 2) {
        const rhymeRes = await adminFetch(`/api/admin/lexicon?q=${encodeURIComponent(tail)}`);
        const rd = await rhymeRes.json();
        const rhymeRows: LexEntry[] = Array.isArray(rd.data) ? rd.data : [];
        setRhymes(rhymeRows.filter((r) => r.word.endsWith(tail) && r.word !== word.text).slice(0, 8));
      }
      setLoaded(true);
    } catch {
      toast.error('Lexicon lookup failed');
    } finally {
      setBusy(false);
    }
  };

  const findAlternatives = async () => {
    setBusy(true);
    try {
      const res = await adminFetch('/api/admin/lexicon/alternatives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: word.text, gloss: entry?.gloss }),
      });
      const d = await res.json();
      if (res.status === 503) { toast.error('AI is not configured'); return; }
      if (!res.ok) throw new Error(d?.error || 'Failed');
      setAlts(Array.isArray(d.data) ? d.data : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text);
    toast.success(`${text} copied — paste it where you want it`);
  };

  return (
    <section className="space-y-3 rounded-lg border border-orange-300 p-4 dark:border-orange-800">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-tamil text-xl font-semibold text-gray-900 dark:text-gray-100">{word.text}</h3>
          <p className="text-xs text-gray-500">
            {word.syllableCount} syllables ·{' '}
            {word.syllables.map((s) => `${s.text}${s.vowel === 'long' ? ' (நெடில்)' : ' (குறில்)'}`).join(' · ')}
            {word.sustainable ? ' · can be sustained' : ' · closed ending, clips the note'}
          </p>
        </div>
        <button onClick={onClose} aria-label="close word lookup" className="text-gray-400 hover:text-gray-600">✕</button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={lookup} disabled={busy}
          className="rounded-md border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:hover:bg-gray-800">
          {busy ? 'Looking…' : 'Look up in Lexicon'}
        </button>
        <button onClick={findAlternatives} disabled={busy}
          className="rounded-md border border-orange-500 px-3 py-1 text-xs text-orange-700 hover:bg-orange-50 disabled:opacity-60 dark:text-orange-400 dark:hover:bg-gray-800">
          Find alternatives
        </button>
      </div>

      {entry && (
        <div className="rounded-md bg-gray-50 p-3 text-xs dark:bg-gray-800">
          <div className="font-tamil text-sm text-gray-800 dark:text-gray-100">{entry.tamilMeaning}</div>
          <div className="text-gray-600 dark:text-gray-300">{entry.gloss}</div>
          <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-gray-500">
            {entry.registers?.length && <span>register: {entry.registers.join('/')}</span>}
            {entry.wordType && <span>type: {entry.wordType}</span>}
            {entry.usage && <span>usage: {entry.usage}</span>}
            {entry.lexicalStatus && <span>status: {entry.lexicalStatus}</span>}
            <span>confidence: {entry.confidence ?? 'not reviewed'}</span>
            {entry.themes?.length ? <span>themes: {entry.themes.join(', ')}</span> : null}
          </div>
        </div>
      )}
      {loaded && !entry && (
        <p className="text-xs text-gray-500">Not in your Lexicon yet — you could add it.</p>
      )}

      {related.length > 0 && (
        <WordList title="Meaning-related (from your Lexicon)" rows={related} onPick={copy} />
      )}
      {rhymes.length > 0 && (
        <WordList title="Sound-related — same ending (எதுகை / இயைபு)" rows={rhymes} onPick={copy} />
      )}

      {alts && (
        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wide text-gray-400">Alternatives, with their differences</div>
          {alts.length === 0 && <p className="text-xs text-gray-400">Nothing came back.</p>}
          <ul className="space-y-1">
            {alts.map((a) => (
              <li key={a.word} className="rounded border border-gray-100 p-2 text-xs dark:border-gray-800">
                <div className="flex flex-wrap items-baseline gap-2">
                  <button onClick={() => copy(a.word)} className="font-tamil text-sm font-medium text-blue-700 hover:underline dark:text-blue-400">
                    {a.word}
                  </button>
                  <span className="text-gray-500">{a.gloss}</span>
                  {a.known && <span className="text-[10px] text-green-600">already yours</span>}
                </div>
                <p className="text-gray-600 dark:text-gray-300">{a.nuance}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[11px] text-gray-400">
        Choosing a word copies it to the clipboard. Your line stays exactly as you wrote it.
      </p>
    </section>
  );
}

function WordList({ title, rows, onPick }: { title: string; rows: LexEntry[]; onPick: (w: string) => void }) {
  return (
    <div>
      <div className="mb-1 text-[11px] uppercase tracking-wide text-gray-400">{title}</div>
      <div className="flex flex-wrap gap-1">
        {rows.map((r) => (
          <button
            key={r.id}
            onClick={() => onPick(r.word)}
            title={r.gloss}
            className="rounded-full bg-gray-100 px-2 py-0.5 font-tamil text-xs text-gray-700 hover:bg-orange-100 dark:bg-gray-800 dark:text-gray-200"
          >
            {r.word}
          </button>
        ))}
      </div>
    </div>
  );
}
