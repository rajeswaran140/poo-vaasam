/** @jest-environment node */
/** lexiconHints — fresh-first, excludes archived + 'retire', compact format. */

import { lexiconHints } from '@/lib/lexicon-hints';
import type { LexiconWord } from '@/types/lexicon';

const w = (over: Partial<LexiconWord>): LexiconWord => ({
  id: 'lex_x', word: 'மலர்', romanization: undefined, gloss: 'flower',
  register: 'sangam', usage: 'fresh', themes: [], usageCount: 0, notes: undefined,
  archived: false, createdAt: new Date(0), updatedAt: new Date(0), ...over,
});

it('formats "word — gloss [register]" and drops placeholder glosses', () => {
  expect(lexiconHints([w({ word: 'மலர்', gloss: 'flower', register: 'sangam' })])).toEqual(['மலர் — flower [sangam]']);
  expect(lexiconHints([w({ word: 'நிலா', gloss: '—', register: 'literary' })])).toEqual(['நிலா [literary]']);
});

it('excludes archived and overused (retire) words', () => {
  const out = lexiconHints([
    w({ word: 'keep', gloss: 'k' }),
    w({ word: 'gone', archived: true }),
    w({ word: 'tired', usage: 'retire' }),
  ]);
  expect(out.some((h) => h.startsWith('keep'))).toBe(true);
  expect(out.join(' ')).not.toMatch(/gone|tired/);
});

it('orders fresh before neutral and caps the count', () => {
  const out = lexiconHints(
    [w({ word: 'neutralw', usage: 'neutral' }), w({ word: 'freshw', usage: 'fresh' })],
    10
  );
  expect(out[0]).toMatch(/^freshw/);
  expect(lexiconHints(Array.from({ length: 200 }, (_, i) => w({ word: `w${i}` })), 50)).toHaveLength(50);
});
