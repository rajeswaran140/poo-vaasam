'use client';

/**
 * DuetTagger — turns the lyrics in the composer into SUNO-ready, per-section
 * voice-tagged lyrics so male/female duets actually follow the assignment.
 * Sits in the compose flow; reads the same lyrics, lets you set who sings each
 * section, warns when it isn't really a duet (pre-flight), and gives a one-click
 * copy of the tagged lyrics to paste into SUNO. Logic lives in @/lib/duet-tagging.
 */

import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  splitSections,
  defaultAssignment,
  toDuetLyrics,
  duetWarnings,
  type Voice,
  type TaggedSection,
} from '@/lib/duet-tagging';

const VOICE_OPTIONS: { value: Voice; label: string }[] = [
  { value: 'male', label: '♂ Male' },
  { value: 'female', label: '♀ Female' },
  { value: 'duet', label: '⚭ Both' },
];

const VOICE_STYLE: Record<Voice, string> = {
  male: 'text-blue-700 bg-blue-50',
  female: 'text-pink-700 bg-pink-50',
  duet: 'text-purple-700 bg-purple-50',
};

export function DuetTagger({ lyrics }: { lyrics: string }) {
  const [open, setOpen] = useState(false);
  // Per-section voice overrides (keyed by section index).
  const [overrides, setOverrides] = useState<Record<number, Voice>>({});

  const base = useMemo(() => defaultAssignment(splitSections(lyrics)), [lyrics]);
  const sections: TaggedSection[] = useMemo(
    () => base.map((s, i) => (overrides[i] ? { ...s, voice: overrides[i] } : s)),
    [base, overrides]
  );
  const output = useMemo(() => toDuetLyrics(sections), [sections]);
  const warnings = useMemo(() => duetWarnings(sections), [sections]);

  const setVoice = (i: number, v: Voice) => setOverrides((p) => ({ ...p, [i]: v }));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      toast.success('Copied — paste into SUNO');
    } catch {
      toast.error('Copy failed');
    }
  };

  const hasLyrics = sections.length > 0;

  return (
    <div className="mt-3 rounded-lg border border-purple-200 bg-purple-50/40 dark:border-gray-700 dark:bg-gray-800/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200"
      >
        <span>⚭ Duet mode — tag voices for SUNO</span>
        <span aria-hidden className="text-xs font-normal text-gray-500">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-purple-200 px-3 py-3 dark:border-gray-700">
          {!hasLyrics ? (
            <p className="text-xs text-gray-500">Paste your lyrics in the box above (blank line between each verse/chorus), then assign a voice to each section.</p>
          ) : (
            <>
              <p className="text-xs text-gray-500">
                SUNO follows voices <strong>per section</strong>, not a global instruction. Assign who sings each block — repeated blocks are detected as the chorus.
              </p>

              {warnings.length > 0 && (
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
                  {warnings.map((w) => <div key={w}>⚠ {w}</div>)}
                </div>
              )}

              <ul className="space-y-2">
                {sections.map((s, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${VOICE_STYLE[s.voice]}`}>
                      {s.kind}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-tamil text-sm text-gray-700 dark:text-gray-300" title={s.text}>
                      {s.text.split('\n')[0]}
                    </span>
                    <select
                      value={s.voice}
                      onChange={(e) => setVoice(i, e.target.value as Voice)}
                      aria-label={`voice for section ${i + 1}`}
                      className="shrink-0 rounded-md border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-900"
                    >
                      {VOICE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </li>
                ))}
              </ul>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-300">SUNO-ready lyrics</span>
                  <button type="button" onClick={copy} className="rounded-md bg-purple-600 px-3 py-1 text-xs font-medium text-white hover:bg-purple-700">Copy for SUNO</button>
                </div>
                <textarea
                  readOnly
                  value={output}
                  rows={Math.min(12, sections.length * 3 + 2)}
                  aria-label="SUNO-ready duet lyrics"
                  className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 font-mono text-xs text-gray-800 dark:border-gray-600 dark:bg-gray-950 dark:text-gray-100"
                />
                <p className="mt-1 text-[11px] text-gray-400">Keep the <code>[Male/Female/Duet …]</code> tags in English even with Tamil lyrics — SUNO recognizes them more reliably.</p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
