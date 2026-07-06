/**
 * YouTube Partner Program (YPP) monetization gates — PURE math, no I/O.
 *
 * The channel unlocks monetization features in two tiers, each gated on TWO
 * axes (subscriber count AND rolling-365-day public watch-hours):
 *   - Tier 1 (Fan-Funding: Super Thanks / channel memberships / Shopping):
 *       500 subscribers + 3,000 watch-hours
 *   - Tier 2 (Ad-Revenue: mid/pre-roll ads via a Google AdSense link):
 *       1,000 subscribers + 4,000 watch-hours
 *
 * `computeYppGates` turns a live snapshot + growth pace into per-tier progress
 * (current/target/pct/met per axis) plus an ETA to close the tier. All values
 * are derived deterministically here so the route + panel stay dumb and the
 * math is unit-tested.
 */

export const TIER1 = { subs: 500, hours: 3000 } as const;
export const TIER2 = { subs: 1000, hours: 4000 } as const;

export interface GateAxis {
  current: number;
  target: number;
  /** Progress toward the target, 0–100, capped at 100. */
  pct: number;
  met: boolean;
}

export interface TierProgress {
  subs: GateAxis;
  hours: GateAxis;
  /** True only when BOTH axes are met. */
  met: boolean;
  /**
   * Estimated days to close this tier (both axes met), or null when it's
   * already met OR the pace on a still-unmet axis is <= 0 (can't estimate).
   * When both axes are unmet, this is the LARGER of the two per-axis ETAs
   * (the tier isn't closed until the slower axis catches up).
   */
  etaDays: number | null;
}

export interface YppGates {
  tier1: TierProgress;
  tier2: TierProgress;
}

export interface YppGateInput {
  subscribers: number;
  watchHours365: number;
  netSubsPerDay: number;
  watchHoursPerDay: number;
}

function axis(current: number, target: number): GateAxis {
  const safeTarget = target > 0 ? target : 1;
  const pct = Math.min(100, (current / safeTarget) * 100);
  return { current, target, pct, met: current >= target };
}

/**
 * ETA (days) to close a single unmet axis at the given pace, rounded up.
 * Returns null when the axis is already met (gap <= 0) OR the pace is <= 0
 * (a stalled or shrinking metric can't be projected to a finite date).
 */
function axisEta(gap: number, perDay: number): number | null {
  if (gap <= 0) return null; // already there
  if (perDay <= 0) return null; // stalled/negative — no finite estimate
  return Math.ceil(gap / perDay);
}

function tierProgress(input: YppGateInput, gate: { subs: number; hours: number }): TierProgress {
  const subs = axis(input.subscribers, gate.subs);
  const hours = axis(input.watchHours365, gate.hours);
  const met = subs.met && hours.met;

  let etaDays: number | null = null;
  if (!met) {
    const subsEta = subs.met ? null : axisEta(gate.subs - input.subscribers, input.netSubsPerDay);
    const hoursEta = hours.met ? null : axisEta(gate.hours - input.watchHours365, input.watchHoursPerDay);
    // The tier closes only when the SLOWEST still-unmet axis catches up. If any
    // unmet axis can't be estimated (pace <= 0), the whole tier ETA is unknown.
    const unmetEtas = [subsEta, hoursEta].filter((_, i) => (i === 0 ? !subs.met : !hours.met));
    if (unmetEtas.some((e) => e === null)) {
      etaDays = null;
    } else {
      etaDays = Math.max(...(unmetEtas as number[]));
    }
  }

  return { subs, hours, met, etaDays };
}

export function computeYppGates(input: YppGateInput): YppGates {
  return {
    tier1: tierProgress(input, TIER1),
    tier2: tierProgress(input, TIER2),
  };
}
