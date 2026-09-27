/** @jest-environment node */
/**
 * Attribution of AWS spend to Tamilagaval.
 *
 * ⚠️ WHY THIS IS TESTED SO CAREFULLY. The first hand-attribution of this bill
 * said $16.49 and was WRONG — it assumed Amplify and Route 53 were entirely
 * ours. They are not: the account carries five Amplify apps, six hosted zones,
 * 88 S3 buckets and 30 CloudFront distributions across talky, techsynergy,
 * crowvault, mobily and others. Tamilagaval is 6.3% of a $198 bill.
 *
 * So nothing here hardcodes a share. Every figure is computed from a live
 * inventory, and each line carries the BASIS it was derived from so the number
 * can be audited rather than trusted.
 */
import {
  amplifyShare,
  zoneShare,
  lambdaShare,
  summarise,
  type CostLine,
} from '@/lib/aws-cost';

describe('Amplify — apportioned by build minutes, not assumed', () => {
  it('gives us the whole line when only our app built', () => {
    const l = amplifyShare(11.8, { d3rkmepk4popv0: 989, other1: 0, other2: 0 }, 'd3rkmepk4popv0');
    expect(l.cost).toBeCloseTo(11.8, 2);
    expect(l.exact).toBe(true);
    expect(l.basis).toMatch(/989/);
  });

  /**
   * The case the hand-attribution would have got wrong. Amplify was 100% ours
   * only because the other four apps happened to build nothing that month —
   * a fact about September, not a property of the account.
   */
  it('splits the line the moment another app starts building', () => {
    const l = amplifyShare(20, { d3rkmepk4popv0: 750, prosevox: 250 }, 'd3rkmepk4popv0');
    expect(l.cost).toBeCloseTo(15, 2);
    expect(l.basis).toMatch(/750/);
  });

  it('claims nothing when nobody built — never divides by zero', () => {
    const l = amplifyShare(11.8, { d3rkmepk4popv0: 0, other: 0 }, 'd3rkmepk4popv0');
    expect(l.cost).toBe(0);
    expect(l.exact).toBe(false);
  });
});

describe('Route 53 — divided by the live zone count', () => {
  it('takes one zone\'s share of six', () => {
    const l = zoneShare(3.11, 'tamilagaval.com.', ['a.', 'b.', 'tamilagaval.com.', 'd.', 'e.', 'f.']);
    expect(l.cost).toBeCloseTo(3.11 / 6, 2);
    expect(l.basis).toMatch(/1 of 6/);
  });

  it('does not hardcode six — a seventh zone changes the answer', () => {
    const seven = ['a.', 'b.', 'tamilagaval.com.', 'd.', 'e.', 'f.', 'g.'];
    expect(zoneShare(3.11, 'tamilagaval.com.', seven).cost).toBeCloseTo(3.11 / 7, 2);
  });

  it('claims nothing if our zone is not in the account', () => {
    expect(zoneShare(3.11, 'tamilagaval.com.', ['a.', 'b.']).cost).toBe(0);
  });
});

describe('Lambda — 100% only while it is provably true', () => {
  it('takes the whole line when every function is ours', () => {
    const l = lambdaShare(0.1, ['tamilagaval-master-worker', 'tamilagaval-yt-snapshot']);
    expect(l.cost).toBeCloseTo(0.1, 2);
    expect(l.exact).toBe(true);
  });

  /**
   * The assumption must fail loudly, not silently over-report. A foreign
   * function in the region means the 100% claim is no longer sound.
   */
  it('stops claiming 100% as soon as a foreign function appears', () => {
    const l = lambdaShare(0.1, ['tamilagaval-master-worker', 'someone-elses-fn']);
    expect(l.exact).toBe(false);
    expect(l.basis).toMatch(/someone-elses-fn|not all/i);
    expect(l.cost).toBeLessThan(0.1);
  });
});

describe('summarise', () => {
  const lines: CostLine[] = [
    { service: 'Amplify', cost: 11.8, total: 11.8, basis: 'b', exact: true },
    { service: 'Route 53', cost: 0.52, total: 3.11, basis: 'b', exact: false },
  ];

  it('totals what is ours and what the account spent', () => {
    const s = summarise(lines, 198.13, 98.43);
    expect(s.tamilagaval).toBeCloseTo(12.32, 2);
    expect(s.accountTotal).toBe(198.13);
    expect(s.sharePct).toBeCloseTo(12.32 / 198.13 * 100, 1);
  });

  it('reports net position against revenue — the number actually being asked for', () => {
    const s = summarise(lines, 198.13, 98.43);
    expect(s.revenue).toBe(98.43);
    expect(s.net).toBeCloseTo(98.43 - 12.32, 2);
    expect(s.profitable).toBe(true);
  });

  it('flags when any line is an estimate, so the total is never read as exact', () => {
    expect(summarise(lines, 198.13, 98.43).allExact).toBe(false);
    expect(summarise([lines[0]], 198.13, 98.43).allExact).toBe(true);
  });
});
