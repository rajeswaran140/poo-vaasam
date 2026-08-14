/**
 * /admin/lexicon — manage the lyric word-family dictionary (see
 * project_poo_vaasam_lexicon). Server-rendered initial list (runtime DynamoDB
 * via APP_AWS_* creds, like /admin/songs), then the client manager handles
 * filters, inline edits, add, and AI-assisted seeding.
 */

import { LexiconRepository } from '@/infrastructure/database/LexiconRepository';
import { LexiconManager, type LexiconRow } from '@/components/admin/LexiconManager';

export const dynamic = 'force-dynamic';

async function getWords(): Promise<LexiconRow[]> {
  try {
    const words = await new LexiconRepository().findAll();
    // Everything except the Dates: the table renders none of them, and dropping
    // them keeps the row a plain serialisable object across the server/client
    // boundary. Explicit rather than a spread so a field added to the domain
    // type has to be considered here before it reaches the browser.
    return words.map((w) => ({
      id: w.id,
      word: w.word,
      normalizedWord: w.normalizedWord,
      romanization: w.romanization,
      gloss: w.gloss,
      tamilMeaning: w.tamilMeaning,
      register: w.register,
      registers: w.registers,
      wordType: w.wordType,
      lexicalStatus: w.lexicalStatus,
      confidence: w.confidence,
      usage: w.usage,
      themes: w.themes,
      moods: w.moods,
      synonyms: w.synonyms,
      relatedWords: w.relatedWords,
      antonyms: w.antonyms,
      etukai: w.etukai,
      monai: w.monai,
      rhymesWith: w.rhymesWith,
      semanticFamily: w.semanticFamily,
      poeticUsage: w.poeticUsage,
      examples: w.examples,
      notes: w.notes,
      usageCount: w.usageCount,
      archived: w.archived,
    }));
  } catch (e) {
    console.error('[admin/lexicon] load failed', e);
    return [];
  }
}

export default async function AdminLexiconPage() {
  const initial = await getWords();
  return <LexiconManager initial={initial} />;
}
