'use client';

/**
 * Live Tamil meter & rhyme view for the Lyric Critic — deterministic, instant,
 * no AI. Shows per-line syllable counts (flagging lines that break the song's
 * dominant length) and the மோனை / எதுகை / இயைபு groupings, so the poet can SEE
 * the rhythm and sound-patterns of their own draft as they write.
 */

import { useMemo, useState } from 'react';
import { Music2, ChevronDown } from 'lucide-react';
import { analyzeProsody, type RhymeGroup } from '@/lib/tamil-prosody';

function RhymeRow({ label, groups }: { label: string; groups: RhymeGroup[] }) {
  return (
    <div className="text-xs">
      <span className="font-semibold text-purple-700 dark:text-purple-300">{label}:</span>{' '}
      {groups.length === 0 ? (
        <span className="text-gray-400">none yet</span>
      ) : (
        groups.map((g, i) => (
          <span key={i} className="mr-2 whitespace-nowrap">
            <span className="font-tamil">{g.key}</span>
            <span className="text-gray-500 dark:text-gray-400"> → lines {g.lineIndexes.map((n) => n + 1).join(', ')}</span>
          </span>
        ))
      )}
    </div>
  );
}

export function TamilProsodyPanel({ lyrics }: { lyrics: string }) {
  const [open, setOpen] = useState(false);
  const report = useMemo(() => analyzeProsody(lyrics), [lyrics]);
  if (report.lyricLineCount === 0) return null;

  const outliers = new Set(report.syllableOutliers);
  const lyricLines = report.lines.filter((l) => !l.isHeading && l.letters > 0);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200"
      >
        <Music2 className="h-4 w-4 text-purple-500" aria-hidden /> Prosody — meter &amp; rhyme
        <span className="ml-auto text-xs font-normal text-gray-400">
          {report.dominantSyllables ? `~${report.dominantSyllables.count} syllables · ${report.lyricLineCount} lines` : `${report.lyricLineCount} lines`}
          {outliers.size > 0 && ` · ${outliers.size} off-meter`}
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="space-y-3 border-t border-gray-100 px-3 py-2.5 dark:border-gray-800">
          <ol className="space-y-0.5">
            {lyricLines.map((l) => {
              const off = outliers.has(l.index);
              return (
                <li key={l.index} className="flex items-baseline gap-2 text-sm">
                  <span
                    className={`w-6 shrink-0 text-right tabular-nums text-xs font-semibold ${off ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400'}`}
                    title={`${l.syllables} syllables · ${l.letters} எழுத்து`}
                  >
                    {l.syllables}
                  </span>
                  <span className="truncate font-tamil text-gray-800 dark:text-gray-200">{l.text}</span>
                  {off && <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">⚠ off-meter</span>}
                </li>
              );
            })}
          </ol>

          <div className="space-y-1 border-t border-gray-100 pt-2 dark:border-gray-800">
            <RhymeRow label="மோனை (alliteration)" groups={report.monai} />
            <RhymeRow label="எதுகை (rhyme)" groups={report.etukai} />
            <RhymeRow label="இயைபு (end-rhyme)" groups={report.iyaipu} />
          </div>
          <p className="text-[11px] text-gray-400">
            Counts are a guide — Tamil meter (யாப்பு) has nuance these don&apos;t capture. The words stay yours.
          </p>
        </div>
      )}
    </div>
  );
}
