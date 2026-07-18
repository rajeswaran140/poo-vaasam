import { ADMIN_DOCS, docsByCategory, getDoc } from '@/content/admin-docs';
import { parseMarkdown } from '@/lib/markdown-blocks';
import { CREDIT_BLOCK } from '@/lib/youtube-description';

describe('admin docs registry', () => {
  it('has at least one doc, all with the required fields', () => {
    expect(ADMIN_DOCS.length).toBeGreaterThan(0);
    for (const d of ADMIN_DOCS) {
      expect(d.slug).toMatch(/^[a-z0-9-]+$/);
      expect(d.title.trim()).not.toBe('');
      expect(d.category.trim()).not.toBe('');
      expect(d.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(d.body.trim().length).toBeGreaterThan(0);
    }
  });

  it('has unique slugs', () => {
    const slugs = ADMIN_DOCS.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('every doc body parses into renderable blocks', () => {
    for (const d of ADMIN_DOCS) {
      expect(parseMarkdown(d.body).length).toBeGreaterThan(0);
    }
  });

  it('getDoc finds by slug and returns undefined otherwise', () => {
    expect(getDoc(ADMIN_DOCS[0].slug)?.slug).toBe(ADMIN_DOCS[0].slug);
    expect(getDoc('does-not-exist')).toBeUndefined();
  });

  it('docsByCategory groups every doc', () => {
    const grouped = docsByCategory();
    const total = Object.values(grouped).reduce((n, arr) => n + arr.length, 0);
    expect(total).toBe(ADMIN_DOCS.length);
  });
});

describe('credit-block doc stays in sync with the code (drift guard)', () => {
  const doc = getDoc('youtube-credit-block-policy');

  it('the policy doc exists', () => {
    expect(doc).toBeTruthy();
  });

  it('documents the current canonical CREDIT_BLOCK verbatim', () => {
    for (const line of CREDIT_BLOCK.split('\n')) {
      expect(doc!.body).toContain(line);
    }
  });

  it('reflects the rights + copyright wording, not the old 3-line block', () => {
    expect(doc!.body).toContain('(original, all rights reserved)');
    expect(doc!.body).toContain('© 2026 TamilAgaval / Raj Thangarajah');
  });
});

describe('publishing cadence guidance is coherent (no 1/week vs 2/week clash)', () => {
  it('the cadence doc states ~1 hero song per week', () => {
    expect(getDoc('upload-cadence-timing')!.body).toMatch(/1 strong hero song per week/i);
  });

  it('no Publishing doc still advises ~2 per week', () => {
    for (const d of docsByCategory()['Publishing']) {
      expect(d.body).not.toMatch(/2 per week|2 songs per week|2\/week/i);
    }
  });
});
