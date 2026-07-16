/** @jest-environment node */
/** Tests for src/lib/youtube-opportunities.ts — card generation + ranking. */

import { buildOpportunities, type OpportunityInput } from '@/lib/youtube-opportunities';

const advice = (verdict: string): OpportunityInput['advice'] => ({
  verdict,
  headline: `headline for ${verdict}`,
  recommendedDate: '2026-07-17',
});

describe('buildOpportunities', () => {
  it('ship-now → a top-priority publish card', () => {
    const [first] = buildOpportunities({ advice: advice('ship-now'), topWinner: null, retentionLaggard: null });
    expect(first.kind).toBe('publish');
    expect(first.priority).toBe(5);
  });

  it('hold-fix-content → a hold card, no publish', () => {
    const ops = buildOpportunities({ advice: advice('hold-fix-content'), topWinner: null, retentionLaggard: null });
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('hold');
  });

  it('let-it-ride produces no action card from advice', () => {
    const ops = buildOpportunities({ advice: advice('let-it-ride'), topWinner: null, retentionLaggard: null });
    expect(ops).toHaveLength(0);
  });

  it('emits amplify + fix-retention cards with video ids', () => {
    const ops = buildOpportunities({
      advice: null,
      topWinner: { videoId: 'win', title: 'Winner Song' },
      retentionLaggard: { videoId: 'lag', title: 'Lagging Song', retention: 28 },
    });
    const amp = ops.find((o) => o.kind === 'amplify')!;
    const fix = ops.find((o) => o.kind === 'fix-retention')!;
    expect(amp.videoId).toBe('win');
    expect(amp.title).toContain('Winner Song');
    expect(fix.videoId).toBe('lag');
    expect(fix.detail).toMatch(/28%/);
  });

  it('ranks by priority (publish 5 > amplify 4 > fix 3), stable within ties', () => {
    const ops = buildOpportunities({
      advice: advice('ship-now'),
      topWinner: { videoId: 'win', title: 'W' },
      retentionLaggard: { videoId: 'lag', title: 'L', retention: 25 },
    });
    expect(ops.map((o) => o.kind)).toEqual(['publish', 'amplify', 'fix-retention']);
  });

  it('empty when there is nothing to act on', () => {
    expect(buildOpportunities({ advice: null, topWinner: null, retentionLaggard: null })).toEqual([]);
  });
});
