import { appendUtm } from '@/lib/utm';

describe('appendUtm', () => {
  const P = { utm_source: 'whatsapp', utm_medium: 'share' };

  it('adds params to a query-less absolute URL', () => {
    const out = appendUtm('https://tamilagaval.com/thayagam', P);
    expect(out).toContain('utm_source=whatsapp');
    expect(out).toContain('utm_medium=share');
    expect(out.startsWith('https://tamilagaval.com/thayagam?')).toBe(true);
  });

  it('appends with & when the URL already has a query', () => {
    const out = appendUtm('https://tamilagaval.com/content/x?ref=a', P);
    expect(out).toContain('ref=a');
    expect(out).toContain('utm_source=whatsapp');
  });

  it('is idempotent — never duplicates an existing key', () => {
    const once = appendUtm('https://tamilagaval.com/x', P);
    const twice = appendUtm(once, P);
    expect(twice).toBe(once);
    expect((twice.match(/utm_source=/g) ?? []).length).toBe(1);
  });

  it('does not overwrite a pre-existing utm_source', () => {
    const out = appendUtm('https://tamilagaval.com/x?utm_source=facebook', P);
    expect(out).toContain('utm_source=facebook');
    expect(out).not.toContain('utm_source=whatsapp');
  });

  it('falls back to manual append for a relative URL', () => {
    expect(appendUtm('/content/x', P)).toBe('/content/x?utm_source=whatsapp&utm_medium=share');
    expect(appendUtm('/content/x?a=1', { utm_source: 'whatsapp' })).toBe('/content/x?a=1&utm_source=whatsapp');
  });

  it('returns the URL unchanged when there are no params', () => {
    expect(appendUtm('https://tamilagaval.com/x', {})).toBe('https://tamilagaval.com/x');
  });
});
