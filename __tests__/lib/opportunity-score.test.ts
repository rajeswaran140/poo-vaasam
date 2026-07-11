import { positionWeight, opportunityScore, opportunityGap } from '@/lib/opportunity-score';
import { querySetFor, type TrackedQuery } from '@/config/song-search-queries';

const q = (intent: TrackedQuery['intent'], conversion: TrackedQuery['conversion']): TrackedQuery => ({
  query: 'x',
  intent,
  conversion,
});

describe('positionWeight', () => {
  it('is 1.0 at #1 and 0 when not found', () => {
    expect(positionWeight(1)).toBeCloseTo(1.0);
    expect(positionWeight(null)).toBe(0);
    expect(positionWeight(0)).toBe(0);
  });

  it('decays monotonically with position', () => {
    expect(positionWeight(1)).toBeGreaterThan(positionWeight(2));
    expect(positionWeight(2)).toBeGreaterThan(positionWeight(5));
    expect(positionWeight(3)).toBeCloseTo(0.5); // 1 / log2(4)
  });
});

describe('opportunityScore', () => {
  it('maxes at 1.0 for a top-intent, top-conversion query at #1', () => {
    expect(opportunityScore(q('father_loss', 'high'), 1)).toBeCloseTo(1.0);
  });

  it('is 0 when the song is not found for the query', () => {
    expect(opportunityScore(q('father_loss', 'high'), null)).toBe(0);
  });

  it('ranks a high-value query above a low-value one at the same position', () => {
    const high = opportunityScore(q('father_loss', 'high'), 1);
    const low = opportunityScore(q('discovery', 'low'), 1);
    expect(high).toBeGreaterThan(low);
    expect(low).toBeCloseTo(0.15); // 0.5 × 0.3 × 1
  });
});

describe('opportunityGap', () => {
  it('is the full ceiling when not ranking, and 0 when already #1', () => {
    expect(opportunityGap(q('father_loss', 'high'), null)).toBeCloseTo(1.0);
    expect(opportunityGap(q('father_loss', 'high'), 1)).toBeCloseTo(0);
  });
});

describe('the Anbai Sumanthu query set', () => {
  it('tracks 20 queries with exactly 5 high-conversion ones', () => {
    const set = querySetFor('kOpNZHlE9FE');
    expect(set).toBeDefined();
    expect(set!.queries).toHaveLength(20);
    expect(set!.queries.filter((x) => x.conversion === 'high')).toHaveLength(5);
  });
});
