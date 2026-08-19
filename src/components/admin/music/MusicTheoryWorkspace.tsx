'use client';

/**
 * Music Composition & Theory — the workspace shell.
 *
 * Sections are tabs rather than one long scroll, and only ONE is mounted at a
 * time. That is a correctness requirement, not a layout preference: unmounting
 * stops the section's audio, so leaving the metronome for the keyboard cannot
 * leave a click running underneath. `audioEngine.stopAll()` on every switch
 * makes that explicit rather than relying on cleanup order.
 *
 * Phase 1 ships Foundations, Rhythm & Meter, Melody and Tamil Lyrics as lesson
 * text plus the two interactive tools. The Lyric Meter Lab and Composition
 * Notebook are separate routes, linked below — the Tamil Lyrics lessons send
 * the reader to them by name, so this page has to be able to get them there.
 */

import { useState } from 'react';
import { audioEngine } from '@/lib/music/audio-engine';
import { Metronome } from '@/components/admin/music/Metronome';
import { Keyboard } from '@/components/admin/music/Keyboard';
import Link from 'next/link';
import { lessonsForSection, type MusicLesson } from '@/content/music-lessons';

type SectionId = 'foundations' | 'rhythm' | 'melody' | 'tamil-lyrics';

const SECTIONS: ReadonlyArray<{ id: SectionId; label: string; tamil: string }> = [
  { id: 'foundations', label: 'Foundations', tamil: 'அடிப்படை' },
  { id: 'rhythm', label: 'Rhythm & Meter', tamil: 'தாளம்' },
  { id: 'melody', label: 'Melody', tamil: 'மெட்டு' },
  { id: 'tamil-lyrics', label: 'Tamil Lyrics & Music', tamil: 'பாடல் வரிகள்' },
];

function LessonCard({ lesson }: { lesson: MusicLesson }) {
  return (
    <article className="space-y-2 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <header className="flex flex-wrap items-baseline gap-2">
        <h3 className="font-tamil text-base font-semibold text-gray-900 dark:text-gray-100">{lesson.tamilTitle}</h3>
        <span className="text-sm text-gray-600 dark:text-gray-300">{lesson.englishTitle}</span>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
          {lesson.difficulty} · {lesson.minutes} min
        </span>
      </header>
      <div className="space-y-2 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
        {lesson.theory.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      {lesson.terms && (
        <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
          {lesson.terms.map((t) => (
            <div key={t.english} className="flex gap-2">
              <dt className="font-tamil text-gray-700 dark:text-gray-200">{t.tamil}</dt>
              <dd className="text-gray-500 dark:text-gray-400">— {t.english}</dd>
            </div>
          ))}
        </dl>
      )}
      {lesson.application && (
        <p className="rounded-md bg-orange-50 px-3 py-2 text-xs text-orange-900 dark:bg-gray-800 dark:text-orange-200">
          <strong>Applying it:</strong> {lesson.application}
        </p>
      )}
    </article>
  );
}

export function MusicTheoryWorkspace() {
  const [section, setSection] = useState<SectionId>('foundations');

  const go = (id: SectionId) => {
    // One tool at a time — never leave the previous section sounding.
    audioEngine.stopAll();
    setSection(id);
  };

  const lessons = lessonsForSection(section);

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Music Composition &amp; Theory</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          இசைக் கோட்பாடு — learned through songwriting rather than as an academic course.
          Learn → Listen → Practise → Apply to lyrics → Compose.
        </p>
      </header>

      <nav className="flex flex-wrap gap-1" aria-label="Theory sections">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => go(s.id)}
            aria-current={section === s.id ? 'page' : undefined}
            className={`rounded-md px-3 py-1.5 text-sm ${
              section === s.id
                ? 'bg-orange-600 text-white'
                : 'border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800'
            }`}
          >
            {s.label} <span className="font-tamil opacity-70">{s.tamil}</span>
          </button>
        ))}
      </nav>

      {/* The interactive tool for the current section, mounted alone. */}
      {section === 'rhythm' && <Metronome />}
      {(section === 'foundations' || section === 'melody') && <Keyboard />}

      <div className="space-y-3">
        {lessons.map((l) => (
          <LessonCard key={l.id} lesson={l} />
        ))}
      </div>

      <nav className="flex flex-wrap gap-3 border-t border-gray-200 pt-4 text-sm dark:border-gray-700">
        <Link href="/admin/music-lab/meter-lab" className="text-orange-600 hover:underline dark:text-orange-400">
          Lyric Meter Lab ↗
        </Link>
        <Link href="/admin/music-lab/notebook" className="text-orange-600 hover:underline dark:text-orange-400">
          Composition Notebook ↗
        </Link>
      </nav>
    </div>
  );
}
