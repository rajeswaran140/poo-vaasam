import { ADMIN_DOCS, docsByCategory, getDoc } from '@/content/admin-docs';
import { parseMarkdown } from '@/lib/markdown-blocks';

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
