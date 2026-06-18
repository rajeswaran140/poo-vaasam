'use client';

/**
 * Admin authoring control for structured lyrics. Authors type/paste plain text
 * (English→Tamil transliteration via TamilInput); verses are separated by a
 * blank line and optionally labelled with பல்லவி / அனுபல்லவி / சரணம். The form
 * converts the text to a structured LyricsDTO on submit (see lib/lyrics-text).
 * A live counter shows how the parser will section it — instant feedback that
 * the markers/blank-lines are doing what the author expects.
 */

import { TamilInput } from '@/components/admin/TamilInput';
import { Lyrics } from '@/domain/songs/Lyrics';

interface LyricsFieldProps {
  value: string;
  onChange: (value: string) => void;
}

export function LyricsField({ value, onChange }: LyricsFieldProps) {
  const parsed = Lyrics.fromPlainText(value);
  const filled = value.trim().length > 0;

  return (
    <div className="space-y-2">
      <TamilInput
        label="பாடல் வரிகள் (Lyrics) — optional"
        value={value}
        onChange={onChange}
        multiline
        rows={10}
        placeholder={'பல்லவி\nநீ சிரிச்ச நேரம்...\n\nசரணம்\n...'}
      />
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Separate verses with a blank line. Start a verse with{' '}
        <strong>பல்லவி</strong>, <strong>அனுபல்லவி</strong> or <strong>சரணம்</strong> to label it.
        {filled && (
          <span className="ml-1 font-medium text-gray-600 dark:text-gray-300">
            · {parsed.sections.length} section{parsed.sections.length === 1 ? '' : 's'}, {parsed.lineCount} line
            {parsed.lineCount === 1 ? '' : 's'} parsed
          </span>
        )}
      </p>
    </div>
  );
}
