/** @jest-environment node */
/** critiqueToMarkdown — sections render, empty sections omit, overall always leads. */

import { critiqueToMarkdown, confidenceWord } from '@/lib/critique-markdown';
import type { LyricCritique } from '@/services/ai/lyricCriticSchema';

const FULL: LyricCritique = {
  overall: 'A tender read.',
  strengths: ['The மண்வாசம் image lands'],
  observations: [{ aspect: 'meter', note: 'Line 3 runs long' }],
  slackLines: [
    { line: 'மண்ணை தொடணும்', issue: 'too abstract', issueType: 'possible_issue', confidence: 0.6 },
  ],
  wordIdeas: [
    {
      instead_of: 'அழகு',
      consider: ['எழில்', 'சாயல்'],
      why: 'less generic',
      tradeoff: 'gains literary weight, loses plainness',
    },
  ],
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
  expect(md).toContain('## Lines worth a second look');
  expect(md).toContain('**மண்ணை தொடணும்** — too abstract'); // line quoted verbatim
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
  expect(md).not.toContain('## Lines worth a second look');
  expect(md.endsWith('\n')).toBe(true);
});

/**
 * The report is where the new classification either helps or is wasted. A
 * reader skimming it must see at a glance that the critic thinks a line is
 * DELIBERATE rather than weak — otherwise `artistic_choice` is a field nobody
 * ever perceives.
 */
describe('issue type, confidence and trade-off in the report', () => {
  const mixed = (): LyricCritique => ({
    ...FULL,
    slackLines: [
      { line: 'கலை வரி', issue: 'reads deliberate', issueType: 'artistic_choice', confidence: 0.3 },
      { line: 'பிழை வரி', issue: 'genuine fault', issueType: 'likely_error', confidence: 0.9 },
      { line: 'நடு வரி', issue: 'might catch', issueType: 'possible_issue', confidence: 0.55 },
    ],
  });

  it('leads with real faults and sinks deliberate choices to the bottom', () => {
    const md = critiqueToMarkdown(mixed());
    expect(md.indexOf('பிழை வரி')).toBeLessThan(md.indexOf('நடு வரி'));
    expect(md.indexOf('நடு வரி')).toBeLessThan(md.indexOf('கலை வரி'));
  });

  it('marks a deliberate line so it does not read as criticism', () => {
    expect(critiqueToMarkdown(mixed())).toMatch(/🎨 _\(reads deliberate\)_ \*\*கலை வரி\*\*/);
  });

  it('states confidence in words, not decimals', () => {
    const md = critiqueToMarkdown(mixed());
    expect(md).toContain('_(high confidence)_');
    expect(md).toContain('_(low confidence)_');
    expect(md).not.toContain('0.9');
  });

  it('renders an intent question when the critic asked one instead of downgrading', () => {
    const md = critiqueToMarkdown({
      ...FULL,
      slackLines: [
        {
          line: 'மெய்யில் உந்தன் நினைவே',
          issue: 'மெய் carries two readings',
          issueType: 'artistic_choice',
          confidence: 0.35,
          questionForWriter: 'Did you intend body or truth?',
        },
      ],
    });
    expect(md).toContain('❓ Did you intend body or truth?');
  });

  it('ALWAYS shows the trade-off beside a suggested word', () => {
    // A swap shown without its cost is how a critic quietly sands originality
    // off a line — the render must never drop it.
    expect(critiqueToMarkdown(FULL)).toContain('⚖️ gains literary weight, loses plainness');
  });
});

describe('confidenceWord', () => {
  it('buckets at the boundaries', () => {
    expect(confidenceWord(1)).toBe('high');
    expect(confidenceWord(0.75)).toBe('high');
    expect(confidenceWord(0.74)).toBe('medium');
    expect(confidenceWord(0.45)).toBe('medium');
    expect(confidenceWord(0.44)).toBe('low');
    expect(confidenceWord(0)).toBe('low');
  });
});

describe('a rhythm note that needs the tune reads as provisional', () => {
  it('marks it so it cannot be mistaken for a settled verdict', () => {
    const md = critiqueToMarkdown({
      ...FULL,
      slackLines: [
        {
          line: 'முத்தமிழின் மூன்றெழுத்தே',
          issue: 'runs longer than the lines around it',
          issueType: 'possible_issue',
          confidence: 0.4,
          requiresMelodyValidation: true,
        },
      ],
    });
    expect(md).toContain('🎵');
    expect(md).toMatch(/line length alone cannot decide this/);
  });

  it('omits the marker when the note is not rhythmic', () => {
    expect(critiqueToMarkdown(FULL)).not.toContain('🎵');
  });
});
