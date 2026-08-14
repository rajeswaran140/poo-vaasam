/** @jest-environment node */
/**
 * The data-quality audit.
 *
 * The defining constraint is that the audit NEVER changes anything, so the
 * tests check two things in parallel: that each rule fires on the right data,
 * and that the finding it produces either carries a safe proposal or carries
 * none at all. A destructive proposal here would be applied with one click.
 */

import { auditLexicon, sortFindings } from '@/lib/lexicon-audit';
import type { LexiconWord } from '@/types/lexicon';

const word = (o: Partial<LexiconWord> & { id: string; word: string }): LexiconWord => ({
  normalizedWord: o.word,
  gloss: 'a meaning',
  tamilMeaning: 'ஒரு பொருள்',
  register: 'literary',
  registers: ['literary'],
  usage: 'fresh',
  themes: ['nature'],
  moods: [],
  synonyms: [],
  relatedWords: [],
  antonyms: [],
  etukai: [],
  monai: [],
  rhymesWith: [],
  semanticFamily: [],
  examples: [],
  usageCount: 0,
  archived: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...o,
});

const codes = (rows: LexiconWord[]) => auditLexicon(rows).findings.map((f) => f.code);

describe('the audit never proposes anything destructive', () => {
  it('offers no proposal at all for duplicates — deleting is the poet’s call', () => {
    const report = auditLexicon([
      word({ id: '1', word: 'நிலா' }),
      word({ id: '2', word: 'நிலா' }),
    ]);
    const dup = report.findings.find((f) => f.code === 'duplicate-word')!;
    expect(dup.proposal).toBeNull();
    expect(dup.ids.sort()).toEqual(['1', '2']);
  });

  it('never proposes a field that could remove data', () => {
    const report = auditLexicon([
      word({ id: '1', word: 'நினைவலை', registers: ['sangam'], lexicalStatus: 'creative-poetic', confidence: 'verified' }),
    ]);
    for (const f of report.findings) {
      if (!f.proposal) continue;
      // Only classification fields may ever be proposed — never the word,
      // the gloss, the themes, or `archived`.
      expect(Object.keys(f.proposal).every((k) => ['registers', 'lexicalStatus', 'confidence'].includes(k))).toBe(true);
    }
  });
});

/**
 * ⚠️ THE FINDING THIS TOOL EXISTS FOR. 1,046 of 1,047 live entries say
 * `sangam` because every admin form defaulted to it, not because anyone judged
 * them Sangam.
 */
describe('suspicious sangam', () => {
  it('flags an unreviewed single-register sangam entry', () => {
    expect(codes([word({ id: '1', word: 'அகநேசம்', register: 'sangam', registers: ['sangam'] })])).toContain(
      'suspicious-sangam'
    );
  });

  it('does NOT flag it once a confidence has been recorded', () => {
    expect(
      codes([word({ id: '1', word: 'அகத்திணை', registers: ['sangam'], confidence: 'verified' })])
    ).not.toContain('suspicious-sangam');
  });

  it('proposes nothing — the right register is a judgement, not a default', () => {
    const f = auditLexicon([word({ id: '1', word: 'அகநேசம்', registers: ['sangam'] })]).findings.find(
      (x) => x.code === 'suspicious-sangam'
    )!;
    expect(f.proposal).toBeNull();
    expect(f.message).toMatch(/never been reviewed/i);
  });

  it('flags OTHER historical claims separately, at lower severity', () => {
    const found = auditLexicon([word({ id: '1', word: 'x', registers: ['classical'] })]).findings;
    const f = found.find((x) => x.code === 'unreviewed-historical')!;
    expect(f.severity).toBe('medium');
  });
});

describe('a coined compound cannot be historical vocabulary', () => {
  it('flags creative-poetic filed under a historical register, and proposes modern-poetic', () => {
    const f = auditLexicon([
      word({ id: '1', word: 'நினைவலை', registers: ['sangam'], lexicalStatus: 'creative-poetic', confidence: 'experimental' }),
    ]).findings.find((x) => x.code === 'constructed-marked-historical')!;
    expect(f.severity).toBe('high');
    expect(f.proposal).toEqual({ registers: ['modern-poetic'] });
  });

  it('flags a coinage marked "verified" and proposes experimental', () => {
    const f = auditLexicon([
      word({ id: '1', word: 'நினைவலை', lexicalStatus: 'creative-poetic', confidence: 'verified' }),
    ]).findings.find((x) => x.code === 'contradictory-status')!;
    expect(f.proposal).toEqual({ confidence: 'experimental' });
  });
});

describe('duplicates', () => {
  it('reports two entries that differ only by an invisible character', () => {
    const found = codes([
      word({ id: '1', word: 'அன்பு', normalizedWord: 'அன்பு' }),
      word({ id: '2', word: 'அன்‌பு', normalizedWord: 'அன்பு' }),
    ]);
    expect(found).toContain('duplicate-normalized');
  });

  it('does not double-report an exact duplicate as a normalized one', () => {
    const found = codes([word({ id: '1', word: 'நிலா' }), word({ id: '2', word: 'நிலா' })]);
    expect(found.filter((c) => c === 'duplicate-normalized')).toHaveLength(0);
  });
});

describe('completeness and form', () => {
  it('flags a placeholder gloss as missing', () => {
    expect(codes([word({ id: '1', word: 'x', gloss: '—' })])).toContain('missing-gloss');
  });

  it('flags a missing Tamil meaning and missing themes', () => {
    const found = codes([word({ id: '1', word: 'x', tamilMeaning: undefined, themes: [] })]);
    expect(found).toContain('missing-tamil-meaning');
    expect(found).toContain('missing-themes');
  });

  it('flags a headword that is really a comma list', () => {
    expect(codes([word({ id: '1', word: 'பொற்கதிர்,இளங்கதிர்' })])).toContain('malformed-tamil');
  });

  it('flags registers that cannot both be true', () => {
    expect(codes([word({ id: '1', word: 'x', registers: ['sangam', 'colloquial'] })])).toContain(
      'inconsistent-registers'
    );
  });
});

describe('scope and ordering', () => {
  it('ignores archived entries — a decision has already been made on them', () => {
    const report = auditLexicon([word({ id: '1', word: 'x', registers: ['sangam'], archived: true })]);
    expect(report.findings).toEqual([]);
    expect(report.total).toBe(0);
  });

  it('is pure — the same lexicon always yields the same report', () => {
    const rows = [word({ id: '1', word: 'அகநேசம்', registers: ['sangam'] }), word({ id: '2', word: 'நிலா' })];
    expect(auditLexicon(rows)).toEqual(auditLexicon(rows));
  });

  it('sorts high severity first', () => {
    const report = auditLexicon([
      word({ id: '1', word: 'x', tamilMeaning: undefined }), // medium
      word({ id: '2', word: 'y', gloss: '—' }), // high
    ]);
    const sorted = sortFindings(report.findings);
    expect(sorted[0].severity).toBe('high');
  });

  it('counts findings by code and severity', () => {
    const report = auditLexicon([word({ id: '1', word: 'அகநேசம்', registers: ['sangam'] })]);
    expect(report.countsByCode['suspicious-sangam']).toBe(1);
    expect(report.countsBySeverity.high).toBeGreaterThan(0);
  });
});
