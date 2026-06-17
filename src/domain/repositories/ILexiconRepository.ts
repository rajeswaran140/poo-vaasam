/**
 * Lexicon repository port — persistence for the lyric word-family dictionary.
 */

import type { LexiconWord, LexiconWordInput, LexiconWordUpdate } from '@/types/lexicon';

export interface ILexiconRepository {
  create(input: LexiconWordInput): Promise<LexiconWord>;
  findById(id: string): Promise<LexiconWord | null>;
  /** Lookup by headword (NFC-normalized) for uniqueness checks. */
  findByWord(word: string): Promise<LexiconWord | null>;
  findAll(): Promise<LexiconWord[]>;
  update(id: string, updates: LexiconWordUpdate): Promise<LexiconWord>;
  delete(id: string): Promise<void>;
}
