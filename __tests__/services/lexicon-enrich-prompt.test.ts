/** @jest-environment node */
/**
 * ⚠️ THE PROMPT MUST NAME EVERY VOCABULARY.
 *
 * It used to say only `"lexicalStatus":"<status>"` and never list the permitted
 * values, so the model invented them. Measured 2026-08-17 on real runs:
 * "standard" for lexicalStatus (24x), the lexicalStatus value "creative-poetic"
 * placed in `registers` (17x), "poetic" as a register (8x), and 176 distinct
 * themes against the 40 allowed. Because these are enum fields, each invalid
 * value rejected the ENTIRE word — 45 of every 100 lost. Naming the
 * vocabularies took it to 0 of 100.
 *
 * This pins the cause, not the symptom: loosening validation would have hidden
 * the mislabelling instead of preventing it.
 */

jest.mock('@/services/ai/text-engine', () => ({
  generateText: jest.fn(async () => ({ ok: true, text: '[]', engine: 'openai', model: 'test' })),
  isTextEngineConfigured: () => true,
  textEngineModel: () => 'test',
  selectedTextEngine: () => 'openai',
}));

import { enrichWords } from '@/services/ai/lexicon-enrich';
import { generateText } from '@/services/ai/text-engine';
import {
  LEXICON_REGISTERS,
  LEXICAL_STATUSES,
  LEXICON_CONFIDENCE,
  LEXICON_MOODS,
  LEXICON_THEMES,
  LEXICON_WORD_TYPES,
} from '@/types/lexicon';

const promptText = async () => {
  await enrichWords([{ word: 'செழுமை' }]);
  const call = (generateText as jest.Mock).mock.calls.at(-1)![0];
  return `${call.system}\n${call.prompt}`;
};

describe('every enum vocabulary is spelled out to the model', () => {
  it.each([
    ['registers', LEXICON_REGISTERS],
    ['lexicalStatus', LEXICAL_STATUSES],
    ['confidence', LEXICON_CONFIDENCE],
    ['moods', LEXICON_MOODS],
    ['wordType', LEXICON_WORD_TYPES],
  ])('names every allowed %s value', async (_label, values) => {
    const p = await promptText();
    for (const v of values) expect(p).toContain(v);
  });

  it('names every allowed theme', async () => {
    const p = await promptText();
    for (const t of LEXICON_THEMES) expect(p).toContain(t);
  });

  /** The specific confusion seen 17 times: a status value put in registers. */
  it('warns that lexicalStatus and registers are different fields', async () => {
    expect(await promptText()).toMatch(/not put a lexicalStatus value in registers/i);
  });
});
