/**
 * BigQuery client — pure helper tests (config detection + DOW conversion).
 * The query function itself hits a real BigQuery dataset and can't be
 * meaningfully unit-tested here without mocking the whole SDK; it stays a
 * post-deploy verification step.
 */

import {
  isBigQueryConfigured,
  ga4DatasetName,
  bqDayOfWeekToIso,
  isoDayLabel,
} from '@/lib/bigquery-api';

describe('isBigQueryConfigured', () => {
  const original = {
    proj: process.env.BIGQUERY_PROJECT_ID,
    prop: process.env.GA4_PROPERTY_ID,
    bqKey: process.env.BIGQUERY_SERVICE_ACCOUNT_KEY,
    gaKey: process.env.GA4_SERVICE_ACCOUNT_KEY,
  };
  afterEach(() => {
    process.env.BIGQUERY_PROJECT_ID = original.proj;
    process.env.GA4_PROPERTY_ID = original.prop;
    process.env.BIGQUERY_SERVICE_ACCOUNT_KEY = original.bqKey;
    process.env.GA4_SERVICE_ACCOUNT_KEY = original.gaKey;
  });

  it('returns false when any of the three required inputs is missing', () => {
    delete process.env.BIGQUERY_PROJECT_ID;
    process.env.GA4_PROPERTY_ID = '123';
    process.env.GA4_SERVICE_ACCOUNT_KEY = 'x';
    expect(isBigQueryConfigured()).toBe(false);
  });

  it('accepts GA4_SERVICE_ACCOUNT_KEY as a fallback for the BQ key (SA-reuse)', () => {
    process.env.BIGQUERY_PROJECT_ID = 'my-project';
    process.env.GA4_PROPERTY_ID = '456';
    delete process.env.BIGQUERY_SERVICE_ACCOUNT_KEY;
    process.env.GA4_SERVICE_ACCOUNT_KEY = 'x';
    expect(isBigQueryConfigured()).toBe(true);
  });

  it('prefers BIGQUERY_SERVICE_ACCOUNT_KEY when both are set', () => {
    process.env.BIGQUERY_PROJECT_ID = 'my-project';
    process.env.GA4_PROPERTY_ID = '789';
    process.env.BIGQUERY_SERVICE_ACCOUNT_KEY = 'x';
    process.env.GA4_SERVICE_ACCOUNT_KEY = 'y';
    expect(isBigQueryConfigured()).toBe(true);
  });
});

describe('ga4DatasetName', () => {
  const original = process.env.GA4_PROPERTY_ID;
  afterEach(() => { process.env.GA4_PROPERTY_ID = original; });

  it('derives the export dataset name from GA4_PROPERTY_ID', () => {
    process.env.GA4_PROPERTY_ID = '312345678';
    expect(ga4DatasetName()).toBe('analytics_312345678');
  });

  it('returns null when the property id is missing', () => {
    delete process.env.GA4_PROPERTY_ID;
    expect(ga4DatasetName()).toBeNull();
  });
});

describe('bqDayOfWeekToIso', () => {
  // BQ: 1=Sun..7=Sat  →  ISO: 1=Mon..7=Sun
  it.each([
    [1, 7], // Sun
    [2, 1], // Mon
    [3, 2], // Tue
    [4, 3], // Wed
    [5, 4], // Thu
    [6, 5], // Fri
    [7, 6], // Sat
  ])('BQ %i → ISO %i', (bq, iso) => {
    expect(bqDayOfWeekToIso(bq)).toBe(iso);
  });
});

describe('isoDayLabel', () => {
  it('labels every ISO day', () => {
    expect(isoDayLabel(1)).toBe('Mon');
    expect(isoDayLabel(7)).toBe('Sun');
  });
  it('returns ? for out-of-range values rather than crashing', () => {
    expect(isoDayLabel(0)).toBe('?');
    expect(isoDayLabel(9)).toBe('?');
  });
});
