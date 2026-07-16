/**
 * Today's Opportunities — turn the channel's current signals into a short,
 * ranked list of concrete NEXT ACTIONS ("do it" layer), each with a priority
 * and a one-line rationale. Deterministic composition of pieces already
 * computed elsewhere (the publish advice, the top outlier, the retention
 * laggard) — no LLM, no I/O. The dashboard page derives the inputs from data it
 * already holds and renders these inline.
 */

export type OpportunityKind = 'publish' | 'amplify' | 'fix-retention' | 'hold';

export interface Opportunity {
  kind: OpportunityKind;
  title: string;
  detail: string;
  priority: number; // 1–5 (stars)
  videoId: string | null;
}

export interface OpportunityInput {
  advice: { verdict: string; headline: string; recommendedDate: string | null } | null;
  topWinner: { videoId: string; title: string } | null; // strongest recent performer
  retentionLaggard: { videoId: string; title: string; retention: number } | null;
}

/** Build the ranked opportunity list (highest priority first; input order breaks ties). */
export function buildOpportunities(input: OpportunityInput): Opportunity[] {
  const out: Opportunity[] = [];

  if (input.advice) {
    const v = input.advice.verdict;
    if (v === 'ship-now') {
      out.push({ kind: 'publish', title: 'Publish a hero upload', detail: input.advice.headline, priority: 5, videoId: null });
    } else if (v === 'on-schedule') {
      out.push({ kind: 'publish', title: 'Publish on cadence', detail: input.advice.headline, priority: 3, videoId: null });
    } else if (v === 'hold-fix-content') {
      out.push({ kind: 'hold', title: 'Hold — fix retention first', detail: input.advice.headline, priority: 4, videoId: null });
    }
    // 'let-it-ride' intentionally produces no action card.
  }

  if (input.topWinner) {
    out.push({
      kind: 'amplify',
      title: `Amplify “${input.topWinner.title}”`,
      detail: 'Your strongest recent performer — cut a Short and share it on WhatsApp.',
      priority: 4,
      videoId: input.topWinner.videoId,
    });
  }

  if (input.retentionLaggard) {
    out.push({
      kind: 'fix-retention',
      title: `Strengthen the opening of “${input.retentionLaggard.title}”`,
      detail: `Long-form retention is ${input.retentionLaggard.retention.toFixed(0)}% — the first 15 seconds is the lever.`,
      priority: 3,
      videoId: input.retentionLaggard.videoId,
    });
  }

  // Stable sort by priority desc.
  return out
    .map((o, i) => ({ o, i }))
    .sort((a, b) => b.o.priority - a.o.priority || a.i - b.i)
    .map(({ o }) => o);
}
