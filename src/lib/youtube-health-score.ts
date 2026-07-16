/**
 * Channel Health Score — a single 0–100 glance, broken into the four dimensions
 * that actually drive a music channel: Reach, Satisfaction, Growth, Publishing.
 *
 * Built deliberately to NOT misread a normal post-peak settle as a collapse
 * (the exact failure mode behind the "we're collapsing!" false alarms): the
 * Reach dimension is scored RELATIVE TO THE PRE-SURGE BASELINE, never the
 * all-time peak — so views at or above baseline score healthy even when they're
 * far below a past spike. It reads only finalized data (the caller drops the
 * lagging days). Satisfaction is the reach/satisfaction counterweight: reach can
 * be down while the channel is perfectly healthy if retention holds.
 *
 * PURE + deterministic (no clock, no I/O, no LLM). The dashboard page computes
 * this from data it already fetched and renders it inline.
 */

export type HealthStatus = 'strong' | 'healthy' | 'watch' | 'concern';
export type DimensionKey = 'reach' | 'satisfaction' | 'growth' | 'publishing';

export interface HealthInput {
  recentViewsPerDay: number;
  baselineViewsPerDay?: number; // pre-surge baseline; default 5000
  viewsDeclining: boolean;
  longFormRetention: number | null; // %
  netSubsPerDay: number | null;
  subsToTier2: number | null;
  daysSinceLastUpload: number | null;
}

export interface HealthDimension {
  key: DimensionKey;
  label: string;
  score: number | null; // null = not measurable (excluded from the overall)
  note: string;
}

export interface ChannelHealth {
  overall: number; // 0–100, weighted over the measurable dimensions
  status: HealthStatus;
  headline: string;
  dimensions: HealthDimension[];
}

export const DEFAULT_BASELINE_VPD = 5000;
const WEIGHTS: Record<DimensionKey, number> = { reach: 0.3, satisfaction: 0.3, growth: 0.25, publishing: 0.15 };

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const round = (n: number): number => Math.round(n);

function statusOf(overall: number): HealthStatus {
  if (overall >= 85) return 'strong';
  if (overall >= 70) return 'healthy';
  if (overall >= 55) return 'watch';
  return 'concern';
}

const STATUS_WORD: Record<HealthStatus, string> = {
  strong: 'Strong',
  healthy: 'Healthy',
  watch: 'Worth watching',
  concern: 'Needs attention',
};

/** Score the channel's health from already-derived signals. */
export function computeChannelHealth(input: HealthInput): ChannelHealth {
  const baseline = input.baselineViewsPerDay ?? DEFAULT_BASELINE_VPD;

  // ── Reach (distribution) — RELATIVE TO BASELINE, not the peak ──────────────
  const ratio = baseline > 0 ? input.recentViewsPerDay / baseline : 1;
  let reachScore = clamp(round(60 + (ratio - 1) * 40), 20, 100); // baseline→60, 2×→100, ½×→40
  if (input.viewsDeclining) reachScore = Math.max(20, reachScore - 10);
  const reach: HealthDimension = {
    key: 'reach',
    label: 'Reach',
    score: reachScore,
    note: `~${round(input.recentViewsPerDay)} views/day (${round(ratio * 100)}% of the ~${baseline} baseline)${input.viewsDeclining ? ', trending down' : ''}. A post-peak settle above baseline is normal, not a decline.`,
  };

  // ── Satisfaction (retention) — the counterweight to reach ──────────────────
  const satisfaction: HealthDimension = {
    key: 'satisfaction',
    label: 'Satisfaction',
    score: input.longFormRetention == null ? null : clamp(round(input.longFormRetention * 2), 0, 100),
    note:
      input.longFormRetention == null
        ? 'Long-form retention unavailable.'
        : `Long-form retention ${input.longFormRetention.toFixed(0)}% (the first 15s is the ceiling).`,
  };

  // ── Growth (subscriber momentum) ───────────────────────────────────────────
  const growth: HealthDimension = {
    key: 'growth',
    label: 'Growth',
    score: input.netSubsPerDay == null ? null : clamp(round(40 + input.netSubsPerDay * 3), 0, 100),
    note:
      input.netSubsPerDay == null
        ? 'Subscriber pace unavailable.'
        : `${input.netSubsPerDay >= 0 ? '+' : ''}${round(input.netSubsPerDay)} net subs/day${input.subsToTier2 != null && input.subsToTier2 > 0 ? `, ~${input.subsToTier2} to Tier-2` : ''}.`,
  };

  // ── Publishing (cadence) — fresher is better; staleness costs ──────────────
  const d = input.daysSinceLastUpload;
  const publishing: HealthDimension = {
    key: 'publishing',
    label: 'Publishing',
    score: d == null ? null : d <= 9 ? 100 : d <= 14 ? 80 : d <= 21 ? 60 : d <= 30 ? 40 : 20,
    note: d == null ? 'Last-upload date unavailable.' : `Last upload ${d} day${d === 1 ? '' : 's'} ago.`,
  };

  const dimensions = [reach, satisfaction, growth, publishing];

  // Weighted overall over the MEASURABLE dimensions (renormalize the weights).
  let weight = 0;
  let acc = 0;
  for (const dim of dimensions) {
    if (dim.score == null) continue;
    weight += WEIGHTS[dim.key];
    acc += WEIGHTS[dim.key] * dim.score;
  }
  const overall = weight > 0 ? round(acc / weight) : 0;
  const status = statusOf(overall);

  const measured = dimensions.filter((x): x is HealthDimension & { score: number } => x.score != null);
  const strongest = measured.reduce((a, b) => (b.score > a.score ? b : a), measured[0]);
  const weakest = measured.reduce((a, b) => (b.score < a.score ? b : a), measured[0]);
  const headline =
    measured.length === 0
      ? 'Not enough data to score channel health yet.'
      : `${STATUS_WORD[status]} — ${strongest.label.toLowerCase()} is the strongest signal` +
        (weakest.key !== strongest.key ? `; ${weakest.label.toLowerCase()} is the one to watch.` : '.');

  return { overall, status, headline, dimensions };
}
