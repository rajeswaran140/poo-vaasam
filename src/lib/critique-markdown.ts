/**
 * Render a structured Lyric Critic critique as portable Markdown — for the
 * Copy / Download actions on the critique screen. Pure + dependency-free →
 * unit-testable (the clipboard/blob side lives in LyricCriticForm.tsx).
 *
 * Empty sections are omitted; `overall` always leads. The feedback-not-rewrite
 * framing is preserved so a pasted/exported critique can't be mistaken for an
 * edited lyric.
 */

import type { IssueType, LyricCritique } from '@/services/ai/lyricCriticSchema';

/** Faults first, deliberate choices last. */
const ISSUE_ORDER: IssueType[] = ['likely_error', 'possible_issue', 'artistic_choice'];

/**
 * The label does the work the classification exists for: a reader skimming the
 * report must be able to see at a glance that the critic thinks a line is
 * DELIBERATE, not weak.
 */
const ISSUE_LABEL: Record<IssueType, string> = {
  likely_error: '⚠️',
  possible_issue: '•',
  artistic_choice: '🎨 _(reads deliberate)_',
};

/** Words, not decimals — 0.35 means nothing to a poet reading a report. */
export function confidenceWord(c: number): string {
  if (c >= 0.75) return 'high';
  if (c >= 0.45) return 'medium';
  return 'low';
}

export function critiqueToMarkdown(c: LyricCritique): string {
  const out: string[] = ['# Lyric Critic — feedback', '', `**Overall:** ${c.overall}`];

  if (c.strengths.length) {
    out.push('', '## Strengths', ...c.strengths.map((s) => `- ${s}`));
  }
  if (c.observations.length) {
    out.push('', '## Observations', ...c.observations.map((o) => `- **${o.aspect}** — ${o.note}`));
  }
  if (c.slackLines.length) {
    // Sorted so genuine faults lead and things the critic thinks are DELIBERATE
    // sink to the bottom — otherwise an artistic_choice note reads with the same
    // weight as an error, which is the failure mode this classification exists
    // to prevent.
    const ordered = [...c.slackLines].sort(
      (a, b) => ISSUE_ORDER.indexOf(a.issueType) - ISSUE_ORDER.indexOf(b.issueType)
    );
    out.push(
      '',
      '## Lines worth a second look',
      ...ordered.map((l) => {
        const bits = [`- ${ISSUE_LABEL[l.issueType]} **${l.line}** — ${l.issue}`];
        bits.push(` _(${confidenceWord(l.confidence)} confidence)_`);
        if (l.questionForWriter) bits.push(`\n  - ❓ ${l.questionForWriter}`);
        return bits.join('');
      })
    );
  }
  if (c.wordIdeas.length) {
    out.push(
      '',
      '## Word ideas to consider',
      ...c.wordIdeas.flatMap((w) => [
        `- **${w.instead_of}** → ${w.consider.join(', ')} — ${w.why}`,
        // The trade-off is never optional in the render: an alternative shown
        // without its cost is how a critic quietly sands originality off a line.
        `  - ⚖️ ${w.tradeoff}`,
      ])
    );
  }
  if (c.questions.length) {
    out.push('', '## Questions', ...c.questions.map((q) => `- ${q}`));
  }

  out.push('', '_Feedback, not a rewrite — the words stay yours._');
  return out.join('\n') + '\n';
}
