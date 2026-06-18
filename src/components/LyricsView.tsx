/**
 * LyricsView — renders structured {@link LyricsDTO} on a song page.
 *
 * Each section shows its label (authored, or a Tamil default by kind) followed by
 * its lines; a line's romanisation, when present, appears beneath it in muted
 * text so diaspora readers who can't read Tamil script can still follow along.
 * Pure presentational server component — no state, no effects.
 */

import type { LyricsDTO, LyricsSectionKind } from '@/domain/songs/Lyrics';

/** Tamil default labels for known section kinds (used when none was authored). */
const KIND_LABEL_TA: Record<LyricsSectionKind, string> = {
  pallavi: 'பல்லவி',
  anupallavi: 'அனுபல்லவி',
  charanam: 'சரணம்',
  intro: 'முன்னுரை',
  other: '',
};

interface LyricsViewProps {
  sections: LyricsDTO['sections'];
  className?: string;
}

export function LyricsView({ sections, className }: LyricsViewProps) {
  if (!sections || sections.length === 0) return null;

  return (
    <div className={className} data-testid="lyrics-view">
      {sections.map((section, si) => {
        const label = section.label || KIND_LABEL_TA[section.kind];
        return (
          <section key={si} className="mb-6 last:mb-0">
            {label && (
              <h3 className="mb-2 font-tamil text-sm font-semibold uppercase tracking-wide text-orange-600">
                {label}
              </h3>
            )}
            <div className="font-poem text-lg leading-loose text-gray-800 sm:text-xl">
              {section.lines.map((line, li) => (
                <p key={li} className="mb-1 last:mb-0">
                  <span className="font-tamil">{line.text}</span>
                  {line.romanized && (
                    <span className="block text-sm italic text-gray-400">{line.romanized}</span>
                  )}
                </p>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
