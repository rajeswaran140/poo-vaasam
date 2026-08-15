/** @jest-environment node */
/**
 * The literary word list, as it reaches /admin/docs.
 *
 * The doc body is BUILT from `LEXICON_WORD_GROUPS` rather than written out
 * beside it, so these tests mostly guard that the generation stays lossless and
 * paste-ready: a word that silently fails to reach a code block is a word Raj
 * never sees, and he has no way to notice which one.
 */

import { LEXICON_WORD_GROUPS, LEXICON_WORD_COUNT } from '@/content/lexicon-word-list';
import { getDoc } from '@/content/admin-docs';
import { parseMarkdown } from '@/lib/markdown-blocks';

const doc = getDoc('lexicon-word-list')!;
const blocks = parseMarkdown(doc.body);
const codeBlocks = blocks.filter((b): b is { type: 'code'; text: string } => b.type === 'code');

describe('the word list itself', () => {
  it('has no duplicate headwords across groups', () => {
    const all = LEXICON_WORD_GROUPS.flatMap((g) => g.words.map((w) => w.word.normalize('NFC')));
    expect(new Set(all).size).toBe(all.length);
  });

  it('gives every word a gloss', () => {
    for (const g of LEXICON_WORD_GROUPS) {
      for (const w of g.words) {
        expect(w.word.trim()).not.toBe('');
        expect(w.gloss.trim()).not.toBe('');
      }
    }
  });

  /**
   * ⚠️ A headword carrying a separator would import as one blob — the exact bug
   * that put `பொற்கதிர், இளங்கதிர், …` in as a single 49-character entry.
   */
  it('contains no headword that is secretly a list', () => {
    for (const g of LEXICON_WORD_GROUPS) {
      for (const w of g.words) expect(w.word).not.toMatch(/[,;/|、，]/);
    }
  });

  it('keeps the count constant with the data', () => {
    expect(LEXICON_WORD_COUNT).toBe(LEXICON_WORD_GROUPS.reduce((n, g) => n + g.words.length, 0));
  });

  /**
   * ⚠️ THE REGISTER DISCIPLINE. Only genuine Sangam-era technical terms may
   * carry `sangam`. Everything else is `literary` — the mildest claim — because
   * calling a word Sangam for sounding classical is what mislabelled 1,046 of
   * the existing entries.
   */
  it('reserves the sangam register for the sangam group alone', () => {
    for (const g of LEXICON_WORD_GROUPS) {
      if (g.register === 'sangam') expect(g.theme).toBe('sangam');
      else expect(g.register).toBe('literary');
    }
  });

  it('caps every group at the bulk import limit', () => {
    for (const g of LEXICON_WORD_GROUPS) expect(g.words.length).toBeLessThanOrEqual(50);
  });
});

describe('the doc as it renders', () => {
  it('is registered under Composer and titled with the count', () => {
    expect(doc.category).toBe('Composer');
    expect(doc.title).toContain(String(LEXICON_WORD_COUNT));
  });

  it('emits one fenced block per group', () => {
    expect(codeBlocks).toHaveLength(LEXICON_WORD_GROUPS.length);
  });

  /** Lossless: every single word must survive into a copyable block. */
  it('carries every word into a code block, in paste format', () => {
    const lines = codeBlocks.flatMap((b) => b.text.split('\n').filter(Boolean));
    expect(lines).toHaveLength(LEXICON_WORD_COUNT);
    for (const line of lines) expect(line).toMatch(/^\S.* — .+$/);
  });

  it('names the register and theme above each block, so the import is set up right', () => {
    for (const g of LEXICON_WORD_GROUPS) {
      // The heading keeps the "(part n)" label, but the theme to SELECT in the
      // import form is the bare theme — a part number is not a theme.
      const selectable = g.theme.replace(/ \(part \d+\)/, '');
      expect(doc.body).toContain(`Register **${g.register}** · theme **${selectable}**`);
    }
  });

  /** A group over the cap is rejected whole by the bulk endpoint. */
  it('splits an oversized theme into parts rather than one failing paste', () => {
    const parts = LEXICON_WORD_GROUPS.filter((g) => g.theme.startsWith('nature'));
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map((g) => g.theme)).toEqual(['nature (part 1)', 'nature (part 2)']);
  });

  /** The caveats are the point — a bare list would be worse than none. */
  it('states that the registers are proposals and that nothing is in the database', () => {
    expect(doc.body).toMatch(/proposals, not findings/i);
    expect(doc.body).toMatch(/Nothing here is in the database/i);
    expect(doc.body).toMatch(/30%.*already had|already had.*30%/i);
  });
});
