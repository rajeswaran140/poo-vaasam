/** @jest-environment node */
/** critiqueToMarkdown — sections render, empty sections omit, overall always leads. */

import { critiqueToMarkdown } from '@/lib/critique-markdown';
import type { LyricCritique } from '@/services/ai/lyricCriticSchema';

const FULL: LyricCritique = {
  overall: 'A tender read.',
  strengths: ['The மண்வாசம் image lands'],
  observations: [{ aspect: 'meter', note: 'Line 3 runs long' }],
  slackLines: [{ line: 'மண்ணை தொடணும்', issue: 'too abstract' }],
  wordIdeas: [{ instead_of: 'அழகு', consider: ['எழில்', 'சாயல்'], why: 'less generic' }],
  questions: ['Whose voice carries the charanam?'],
};

it('renders every section as Markdown', () => {
  const md = critiqueToMarkdown(FULL);
  expect(md).toContain('# Lyric Critic — feedback');
  expect(md).toContain('**Overall:** A tender read.');
  expect(md).toContain('## Strengths');
  expect(md).toContain('- The மண்வாசம் image lands');
  expect(md).toContain('## Observations');
  expect(md).toContain('- **meter** — Line 3 runs long');
  expect(md).toContain('## Lines that go slack');
  expect(md).toContain('- **மண்ணை தொடணும்** — too abstract'); // line quoted verbatim
  expect(md).toContain('## Word ideas to consider');
  expect(md).toContain('- **அழகு** → எழில், சாயல் — less generic');
  expect(md).toContain('## Questions');
  expect(md).toContain('- Whose voice carries the charanam?');
  expect(md).toContain('_Feedback, not a rewrite — the words stay yours._'); // framing preserved
});

it('omits empty sections but always leads with overall', () => {
  const md = critiqueToMarkdown({
    overall: 'Solid throughout.',
    strengths: [],
    observations: [],
    slackLines: [],
    wordIdeas: [],
    questions: [],
  });
  expect(md).toContain('**Overall:** Solid throughout.');
  expect(md).not.toContain('## Strengths');
  expect(md).not.toContain('## Lines that go slack');
  expect(md.endsWith('\n')).toBe(true);
});
