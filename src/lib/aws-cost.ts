/**
 * Attributing AWS spend to Tamilagaval.
 *
 * ⚠️ NOTHING HERE HARDCODES A SHARE, AND THAT IS THE WHOLE POINT. The first
 * hand-attribution of this bill came out at $16.49 because it assumed Amplify
 * and Route 53 were entirely ours. They are not — the account carries five
 * Amplify apps, six hosted zones, 88 S3 buckets and 30 CloudFront
 * distributions across talky, techsynergy, crowvault, mobily and others.
 * Tamilagaval is about 6.3% of a $198 bill.
 *
 * Every figure below is computed from a LIVE inventory passed in by the
 * caller, so the numbers self-correct when the account changes. And every line
 * carries the `basis` it was derived from, so a reader can audit the figure
 * instead of trusting it. A single opaque total is what made the first attempt
 * wrong and hard to catch.
 *
 * Pure — no AWS SDK, no I/O. The route fetches the inventory; this decides what
 * it means.
 */

/** One attributed line of the bill. */
export interface CostLine {
  service: string;
  /** Dollars attributed to Tamilagaval. */
  cost: number;
  /** Dollars the whole service line cost, all projects included. */
  total: number;
  /** How `cost` was derived, in words. Rendered in the UI — never hidden. */
  basis: string;
  /**
   * True when the figure is computed or provably complete; false when it is a
   * share, an estimate, or an assumption that no longer holds. The summary
   * propagates this so a total is never presented as more certain than its
   * least certain line.
   */
  exact: boolean;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Amplify, apportioned by build minutes.
 *
 * Build duration dominates this line — for September it was $10.25 of $12.33,
 * because every build runs the full test suite as a deploy gate. So minutes
 * are a fair proxy for who incurred the cost, and unlike a fixed percentage
 * they update themselves the moment another app starts building. Amplify's
 * list-jobs API is free, so this costs nothing to compute.
 */
export function amplifyShare(
  totalCost: number,
  buildMinutesByApp: Record<string, number>,
  ourAppId: string
): CostLine {
  const all = Object.values(buildMinutesByApp).reduce((a, b) => a + b, 0);
  const ours = buildMinutesByApp[ourAppId] ?? 0;

  if (all <= 0) {
    // Nobody built. Claiming the line would be inventing a number; claiming
    // none of it is at least honest, and `exact: false` says so.
    return {
      service: 'Amplify',
      cost: 0,
      total: totalCost,
      basis: 'no builds in this period on any app — nothing attributable',
      exact: false,
    };
  }

  const others = Object.entries(buildMinutesByApp).filter(([k, v]) => k !== ourAppId && v > 0);
  return {
    service: 'Amplify',
    cost: round((totalCost * ours) / all),
    total: totalCost,
    basis:
      others.length === 0
        ? `${Math.round(ours)} build minutes, and no other app built — the whole line is ours`
        : `${Math.round(ours)} of ${Math.round(all)} build minutes across ${
            others.length + 1
          } apps`,
    exact: others.length === 0,
  };
}

/**
 * Route 53, divided by the live hosted-zone count.
 *
 * The hosted-zone charge is flat per zone, so an equal split is exactly right
 * for that component; query charges are not split this way but are pennies at
 * this traffic. Counting zones live matters — a seventh zone silently changes
 * the answer, and the count is the kind of thing that drifts.
 */
export function zoneShare(totalCost: number, ourZone: string, allZones: string[]): CostLine {
  const n = allZones.length;
  const present = allZones.includes(ourZone);

  if (!present || n === 0) {
    return {
      service: 'Route 53',
      cost: 0,
      total: totalCost,
      basis: `${ourZone} is not a hosted zone in this account`,
      exact: false,
    };
  }

  return {
    service: 'Route 53',
    cost: round(totalCost / n),
    total: totalCost,
    basis: `1 of ${n} hosted zones (flat per-zone charge, split evenly)`,
    exact: false,
  };
}

/** Functions belonging to Tamilagaval are named for it. */
const OURS = /^tamilagaval-/;

/**
 * Lambda — the whole line, but only while that is provably true.
 *
 * Every function in ca-central-1 is `tamilagaval-*` today, so 100% is correct.
 * That is a fact about the account, not a law, so it is re-checked on every
 * read: a foreign function appearing must degrade the claim rather than
 * silently over-report. This is the same failure mode as the Amplify
 * assumption, caught earlier this time.
 */
export function lambdaShare(totalCost: number, functionNames: string[]): CostLine {
  const foreign = functionNames.filter((f) => !OURS.test(f));

  if (foreign.length === 0) {
    return {
      service: 'Lambda',
      cost: round(totalCost),
      total: totalCost,
      basis: `all ${functionNames.length} functions in the region are tamilagaval-*`,
      exact: true,
    };
  }

  const ours = functionNames.length - foreign.length;
  return {
    service: 'Lambda',
    cost: round((totalCost * ours) / Math.max(functionNames.length, 1)),
    total: totalCost,
    basis: `not all ours: ${foreign.length} foreign function(s) in the region (${foreign
      .slice(0, 3)
      .join(', ')}) — split by count, which is a rough proxy for invocations`,
    exact: false,
  };
}

export interface CostSummary {
  lines: CostLine[];
  /** Total attributed to Tamilagaval. */
  tamilagaval: number;
  /** What the whole AWS account spent in the period. */
  accountTotal: number;
  /** Tamilagaval as a percentage of the account. */
  sharePct: number;
  /** YouTube revenue over the same period. */
  revenue: number;
  /** revenue − tamilagaval. The number actually being asked for. */
  net: number;
  profitable: boolean;
  /** False when any line is a share or an estimate. */
  allExact: boolean;
}

export function summarise(lines: CostLine[], accountTotal: number, revenue: number): CostSummary {
  const tamilagaval = round(lines.reduce((a, l) => a + l.cost, 0));
  return {
    lines,
    tamilagaval,
    accountTotal,
    sharePct: accountTotal > 0 ? round((tamilagaval / accountTotal) * 100) : 0,
    revenue,
    net: round(revenue - tamilagaval),
    profitable: revenue > tamilagaval,
    allExact: lines.every((l) => l.exact),
  };
}
