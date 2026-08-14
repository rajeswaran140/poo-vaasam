/**
 * The client-side row shape for the lexicon admin UI.
 *
 * A structural mirror of `LexiconWord` minus the Date fields (the server
 * serialises them away and nothing in the table renders them). Kept in its own
 * leaf module so the manager, the detail panel and the audit panel can all
 * import it without importing each other.
 *
 * Every field added in the literary-system work is OPTIONAL here for the same
 * reason it is optional in the domain type: 1,047 rows predate it.
 */

export interface LexiconRow {
  id: string;
  word: string;
  normalizedWord?: string;
  romanization?: string;
  gloss: string;
  tamilMeaning?: string;
  register: string;
  registers?: string[];
  wordType?: string;
  lexicalStatus?: string;
  confidence?: string;
  usage: string;
  themes: string[];
  moods?: string[];
  synonyms?: string[];
  relatedWords?: string[];
  antonyms?: string[];
  etukai?: string[];
  monai?: string[];
  rhymesWith?: string[];
  semanticFamily?: string[];
  poeticUsage?: string;
  examples?: string[];
  notes?: string;
  usageCount: number;
  archived: boolean;
}

/** Header-strip counts returned alongside the list. */
export interface LexiconCountsDto {
  total: number;
  archived: number;
  byRegister: Record<string, number>;
  byLexicalStatus: Record<string, number>;
  byUsage: Record<string, number>;
  needsReview: number;
}

/** Normalise anything the API returns into a complete row. */
export function toRow(d: Partial<LexiconRow> & { id: string; word: string; gloss: string }): LexiconRow {
  const registers = d.registers?.length ? d.registers : d.register ? [d.register] : ['literary'];
  return {
    ...d,
    id: d.id,
    word: d.word,
    gloss: d.gloss,
    register: registers[0],
    registers,
    usage: d.usage ?? 'fresh',
    themes: d.themes ?? [],
    moods: d.moods ?? [],
    synonyms: d.synonyms ?? [],
    relatedWords: d.relatedWords ?? [],
    antonyms: d.antonyms ?? [],
    etukai: d.etukai ?? [],
    monai: d.monai ?? [],
    rhymesWith: d.rhymesWith ?? [],
    semanticFamily: d.semanticFamily ?? [],
    examples: d.examples ?? [],
    usageCount: d.usageCount ?? 0,
    archived: d.archived ?? false,
  };
}
