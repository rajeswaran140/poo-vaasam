/**
 * Music Lab insights — turn logged generations into "what's working" patterns
 * and plain-language recommendations. Pure + deterministic (no I/O), so it's
 * fully unit-tested and safe to run in the client.
 *
 * Honesty guard: this is descriptive statistics over a human-labelled log, not
 * a model. Small samples lie, so every claim is gated behind a minimum count
 * (MIN_TOTAL overall, MIN_GROUP per breakdown bucket). Below threshold we say
 * "not enough data yet" instead of inventing a 100%-from-1-sample pattern.
 */

import type { Generation, GenerationVerdict } from '@/types/generation';
import type { ComposerAnalysis } from '@/services/ai/composerSchema';

/** Minimum logged generations before we surface recommendations at all. */
export const MIN_TOTAL = 8;
/** Minimum bucket size before a per-group rate is considered meaningful. */
export const MIN_GROUP = 4;

const SCORE_AXES = ['melody', 'vocals', 'lyrics', 'mix'] as const;
type ScoreAxis = (typeof SCORE_AXES)[number];

export interface AvgContrast {
  /** Mean over successes, or null if none had a value. */
  success: number | null;
  /** Mean over non-successes (partial+failed), or null. */
  failed: number | null;
  /** success − failed when both exist (positive = successes score higher). */
  gap: number | null;
}

export interface GroupRate {
  key: string;
  total: number;
  success: number;
  /** success / total, 0–1. */
  rate: number;
  /** true when total >= MIN_GROUP (rate is trustworthy). */
  reliable: boolean;
}

export interface InsightsReport {
  total: number;
  byVerdict: Record<GenerationVerdict, number>;
  /** success / total, 0–1, or null when total is 0. */
  successRate: number | null;
  scoreContrast: Record<ScoreAxis, AvgContrast>;
  /** Failure reasons across partial+failed, ranked most→least common. */
  failureReasons: { reason: string; count: number }[];
  byEngine: GroupRate[];
  byStyle: GroupRate[];
  settingsContrast: { weirdness: AvgContrast; styleInfluence: AvgContrast };
  /** Success rate grouped by the brief's dominant emotion / lead raga / top voice. */
  genome: { dimension: 'emotion' | 'raga' | 'voice'; value: string; total: number; success: number; rate: number; reliable: boolean }[];
  /** Plain-language, sample-gated takeaways. Always at least one entry. */
  recommendations: string[];
  /** True once total >= MIN_TOTAL (recommendations are real, not a placeholder). */
  hasEnoughData: boolean;
}

const isSuccess = (g: Generation) => g.verdict === 'success';
const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (r: number) => `${Math.round(r * 100)}%`;

function contrast(gens: Generation[], pick: (g: Generation) => number | undefined): AvgContrast {
  const s: number[] = [];
  const f: number[] = [];
  for (const g of gens) {
    const v = pick(g);
    if (typeof v !== 'number') continue;
    (isSuccess(g) ? s : f).push(v);
  }
  const success = mean(s);
  const failed = mean(f);
  return { success, failed, gap: success != null && failed != null ? success - failed : null };
}

function groupRates(gens: Generation[], key: (g: Generation) => string | undefined): GroupRate[] {
  const m = new Map<string, { total: number; success: number }>();
  for (const g of gens) {
    const k = key(g);
    if (!k) continue;
    const e = m.get(k) ?? { total: 0, success: 0 };
    e.total += 1;
    if (isSuccess(g)) e.success += 1;
    m.set(k, e);
  }
  return [...m.entries()]
    .map(([k, e]) => ({ key: k, total: e.total, success: e.success, rate: e.success / e.total, reliable: e.total >= MIN_GROUP }))
    // Best hit-rate first; break ties by larger sample.
    .sort((a, b) => b.rate - a.rate || b.total - a.total);
}

export function computeInsights(
  gens: Generation[],
  briefsById: Record<string, { analysis?: ComposerAnalysis } | undefined> = {}
): InsightsReport {
  const byVerdict: Record<GenerationVerdict, number> = { success: 0, partial: 0, failed: 0 };
  for (const g of gens) byVerdict[g.verdict] = (byVerdict[g.verdict] ?? 0) + 1;
  const total = gens.length;
  const successRate = total ? byVerdict.success / total : null;

  const scoreContrast = Object.fromEntries(
    SCORE_AXES.map((axis) => [axis, contrast(gens, (g) => g.scores?.[axis])])
  ) as Record<ScoreAxis, AvgContrast>;

  const reasonCounts = new Map<string, number>();
  for (const g of gens) {
    if (!isSuccess(g) && g.failureReason) reasonCounts.set(g.failureReason, (reasonCounts.get(g.failureReason) ?? 0) + 1);
  }
  const failureReasons = [...reasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  const byEngine = groupRates(gens, (g) => g.engine);
  const byStyle = groupRates(gens, (g) => g.chosenStyle);

  const settingsContrast = {
    weirdness: contrast(gens, (g) => g.settings?.weirdness),
    styleInfluence: contrast(gens, (g) => g.settings?.styleInfluence),
  };

  // Genome: roll the brief's dominant emotion / lead raga / top voice onto each
  // generation, then rate-by-value (keeps only buckets that actually appear).
  const genomeMap = new Map<string, { dimension: 'emotion' | 'raga' | 'voice'; value: string; total: number; success: number }>();
  for (const g of gens) {
    const a = briefsById[g.briefId]?.analysis;
    if (!a) continue;
    const dims: [('emotion' | 'raga' | 'voice'), string | undefined][] = [
      ['emotion', a.emotion],
      ['raga', a.suggested_ragas?.[0]],
      ['voice', a.recommended_voice?.[0]],
    ];
    for (const [dimension, value] of dims) {
      if (!value) continue;
      const k = `${dimension}:${value}`;
      const e = genomeMap.get(k) ?? { dimension, value, total: 0, success: 0 };
      e.total += 1;
      if (isSuccess(g)) e.success += 1;
      genomeMap.set(k, e);
    }
  }
  const genome = [...genomeMap.values()]
    .map((e) => ({ ...e, rate: e.success / e.total, reliable: e.total >= MIN_GROUP }))
    .sort((a, b) => b.total - a.total || b.rate - a.rate);

  const hasEnoughData = total >= MIN_TOTAL;
  const recommendations = buildRecommendations({
    total, byVerdict, successRate, scoreContrast, failureReasons, byStyle, byEngine, settingsContrast, genome, hasEnoughData,
  });

  return {
    total, byVerdict, successRate, scoreContrast, failureReasons,
    byEngine, byStyle, settingsContrast, genome, recommendations, hasEnoughData,
  };
}

function buildRecommendations(r: Omit<InsightsReport, 'recommendations'>): string[] {
  if (r.total === 0) return ['No generations logged yet — log your takes (keepers and rejects) to see what works.'];
  if (!r.hasEnoughData) {
    return [`Only ${r.total} logged. Log at least ${MIN_TOTAL} (and ${MIN_GROUP}+ per style/engine) before trusting any pattern.`];
  }

  const out: string[] = [];
  out.push(`${r.byVerdict.success}/${r.total} succeeded (${pct(r.successRate ?? 0)}). ${r.byVerdict.failed} failed, ${r.byVerdict.partial} partial.`);

  // The score axis that most separates keepers from rejects.
  const ranked = SCORE_AXES
    .map((axis) => ({ axis, gap: r.scoreContrast[axis].gap }))
    .filter((x): x is { axis: ScoreAxis; gap: number } => x.gap != null)
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  if (ranked[0] && Math.abs(ranked[0].gap) >= 1) {
    const { axis, gap } = ranked[0];
    out.push(gap > 0
      ? `Keepers score higher on ${axis} (+${gap.toFixed(1)} vs rejects) — it's your strongest differentiator.`
      : `Rejects actually score higher on ${axis} — it's not what's separating your wins; look elsewhere.`);
  }

  if (r.failureReasons[0]) {
    const top = r.failureReasons[0];
    const totalFails = r.failureReasons.reduce((n, x) => n + x.count, 0);
    out.push(`Most common failure: ${top.reason.replace(/_/g, ' ')} (${top.count}/${totalFails} labelled failures) — the highest-leverage thing to fix.`);
  }

  const bestStyle = r.byStyle.find((s) => s.reliable);
  if (bestStyle) out.push(`Best style so far: "${bestStyle.key}" at ${pct(bestStyle.rate)} (${bestStyle.success}/${bestStyle.total}).`);

  const w = r.settingsContrast.weirdness;
  if (w.gap != null && Math.abs(w.gap) >= 8) {
    out.push(w.gap < 0
      ? `Higher weirdness tracks with failures (rejects avg ${w.failed?.toFixed(0)} vs keepers ${w.success?.toFixed(0)}) — try dialing it down.`
      : `Your keepers used higher weirdness (${w.success?.toFixed(0)} vs ${w.failed?.toFixed(0)}) — the bolder settings are paying off.`);
  }

  const bestGenome = r.genome.find((x) => x.reliable);
  if (bestGenome) out.push(`${bestGenome.dimension} "${bestGenome.value}" lands ${pct(bestGenome.rate)} of the time (${bestGenome.success}/${bestGenome.total}).`);

  return out;
}
