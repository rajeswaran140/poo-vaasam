import { mapTimeseriesRows, mapPageRows, mapDimRows } from '@/lib/ga4-api';

describe('mapTimeseriesRows', () => {
  it('formats YYYYMMDD dates to ISO and parses the 3 metrics', () => {
    const out = mapTimeseriesRows([
      { dimensionValues: [{ value: '20260612' }], metricValues: [{ value: '10' }, { value: '12' }, { value: '25' }] },
    ]);
    expect(out[0]).toEqual({ date: '2026-06-12', users: 10, sessions: 12, pageViews: 25 });
  });

  it('sorts oldest-first regardless of input order', () => {
    const out = mapTimeseriesRows([
      { dimensionValues: [{ value: '20260614' }], metricValues: [{ value: '3' }] },
      { dimensionValues: [{ value: '20260612' }], metricValues: [{ value: '1' }] },
      { dimensionValues: [{ value: '20260613' }], metricValues: [{ value: '2' }] },
    ]);
    expect(out.map((p) => p.date)).toEqual(['2026-06-12', '2026-06-13', '2026-06-14']);
  });

  it('defaults missing metrics to 0 and leaves a non-8-digit date untouched; [] for empty', () => {
    const out = mapTimeseriesRows([{ dimensionValues: [{ value: 'x' }] }]);
    expect(out[0]).toEqual({ date: 'x', users: 0, sessions: 0, pageViews: 0 });
    expect(mapTimeseriesRows([])).toEqual([]);
    expect(mapTimeseriesRows(undefined as unknown as unknown[])).toEqual([]);
  });
});

describe('mapPageRows', () => {
  it('maps path/title/pageViews and falls back when path is missing', () => {
    const out = mapPageRows([
      { dimensionValues: [{ value: '/songs' }, { value: 'Songs | Tamilagaval' }], metricValues: [{ value: '40' }] },
      { dimensionValues: [{ value: '' }, { value: '' }], metricValues: [{ value: '5' }] },
    ]);
    expect(out[0]).toEqual({ path: '/songs', title: 'Songs | Tamilagaval', pageViews: 40 });
    expect(out[1]).toEqual({ path: '(not set)', title: '', pageViews: 5 });
  });
});

describe('mapDimRows', () => {
  it('maps single dimension/metric to {key,value} with a fallback key', () => {
    const out = mapDimRows([
      { dimensionValues: [{ value: 'Organic Search' }], metricValues: [{ value: '30' }] },
      { dimensionValues: [{ value: '' }], metricValues: [{ value: '7' }] },
    ]);
    expect(out).toEqual([
      { key: 'Organic Search', value: 30 },
      { key: '(not set)', value: 7 },
    ]);
  });
});
