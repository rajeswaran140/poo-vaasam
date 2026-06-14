import { summariseContentViews } from '@/lib/site-analytics';

describe('summariseContentViews', () => {
  const items = [
    { id: 'cnt_1781049094952_wstyqacm4', title: 'எங்கள் தேசம்', type: 'SONGS', viewCount: 12 },
    { id: 'cnt_a', title: 'A', type: 'POEMS', viewCount: 40 },
    { id: 'cnt_b', title: 'B', type: 'SONGS' }, // missing viewCount → 0
  ];

  it('sums view counts and counts items (missing viewCount → 0)', () => {
    const s = summariseContentViews(items);
    expect(s.totalViews).toBe(52);
    expect(s.itemCount).toBe(3);
  });

  it('ranks top items descending and resolves the canonical path (vanity URL)', () => {
    const s = summariseContentViews(items);
    expect(s.top.map((t) => t.id)).toEqual(['cnt_a', 'cnt_1781049094952_wstyqacm4', 'cnt_b']);
    // The vanity-mapped song uses its clean path, others fall back to /content/<id>.
    expect(s.top.find((t) => t.id === 'cnt_1781049094952_wstyqacm4')!.path).toBe('/thayagam');
    expect(s.top.find((t) => t.id === 'cnt_a')!.path).toBe('/content/cnt_a');
  });

  it('respects topN and handles an empty catalogue', () => {
    expect(summariseContentViews(items, 1).top).toHaveLength(1);
    expect(summariseContentViews([])).toEqual({ totalViews: 0, itemCount: 0, top: [] });
  });
});
