/**
 * Render a structured Lyric Critic critique as portable Markdown — for the
 * Copy / Download actions on the critique screen. Pure + dependency-free →
 * unit-testable (the clipboard/blob side lives in LyricCriticForm.tsx).
 *
 * Empty sections are omitted; `overall` always leads. The feedback-not-rewrite
 * framing is preserved so a pasted/exported critique can't be mistaken for an
 * edited lyric.
 */

import type { LyricCritique } from '@/services/ai/lyricCriticSchema';

export function critiqueToMarkdown(c: LyricCritique): string {
  const out: string[] = ['# Lyric Critic — feedback', '', `**Overall:** ${c.overall}`];

  if (c.strengths.length) {
    out.push('', '## Strengths', ...c.strengths.map((s) => `- ${s}`));
  }
  if (c.observations.length) {
    out.push('', '## Observations', ...c.observations.map((o) => `- **${o.aspect}** — ${o.note}`));
  }
  if (c.slackLines.length) {
    out.push('', '## Lines that go slack', ...c.slackLines.map((l) => `- **${l.line}** — ${l.issue}`));
  }
  if (c.wordIdeas.length) {
    out.push(
      '',
      '## Word ideas to consider',
      ...c.wordIdeas.map((w) => `- **${w.instead_of}** → ${w.consider.join(', ')} — ${w.why}`)
    );
  }
  if (c.questions.length) {
    out.push('', '## Questions', ...c.questions.map((q) => `- ${q}`));
  }

  out.push('', '_Feedback, not a rewrite — the words stay yours._');
  return out.join('\n') + '\n';
}
