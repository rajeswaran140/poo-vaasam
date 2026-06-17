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
    return words.map((w) => ({
      id: w.id,
      word: w.word,
      romanization: w.romanization,
      gloss: w.gloss,
      register: w.register,
      usage: w.usage,
      themes: w.themes,
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
