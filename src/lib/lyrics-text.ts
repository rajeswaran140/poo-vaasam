/**
 * Bridge between the admin form's plain-text lyrics textarea and the structured
 * {@link LyricsDTO} the API/entity store. Authors type/paste lyrics with blank
 * lines between verses and optional பல்லவி/சரணம் markers; these helpers parse
 * that to structure on submit and re-flatten it for editing. Reuses the Lyrics
 * value object's parser so the form and the domain never drift.
 */

import { Lyrics, type LyricsDTO } from '@/domain/songs/Lyrics';

/** Parse the textarea into a structured DTO, or undefined when blank. */
export function lyricsTextToDTO(text: string): LyricsDTO | undefined {
  const lyrics = Lyrics.fromPlainText(text);
  return lyrics.isEmpty() ? undefined : lyrics.toObject();
}

/** Flatten a stored DTO back to editable plain text (labels prefix verses). */
export function lyricsDTOToText(dto: LyricsDTO | null | undefined): string {
  return Lyrics.fromObject(dto).toPlainText();
}
