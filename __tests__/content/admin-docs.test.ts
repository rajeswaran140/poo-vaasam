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
      // AdminDoc.updatedAt accepts EITHER a date-only string ('YYYY-MM-DD',
      // legacy) OR a full ISO 8601 timestamp ('YYYY-MM-DDTHH:MM:SSZ') — the
      // per-minute form is what a NEW edit should use so the sidebar list
      // shows an accurate time. See formatDocUpdatedAt in admin-docs.ts.
      expect(d.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}Z)?$/);
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

describe('publishing cadence guidance is coherent (both docs state the adopted policy)', () => {
  const CADENCE_DOCS = ['upload-cadence-timing', 'release-calendar-queue'];

  // Raj adopted 1-2 songs/week on 2026-08-31, retiring the 3-4/week themed-day
  // trial. These guards were previously written around that trial and passed
  // vacuously once it was retired, because the docs still MENTION it
  // historically. They now assert the live policy instead.

  it('both docs state the 1-2 per week policy', () => {
    for (const slug of CADENCE_DOCS) {
      expect(getDoc(slug)!.body).toMatch(/1[–-]2 songs per week/i);
    }
  });

  it('both docs carry the 3-4 day minimum spacing rule', () => {
    for (const slug of CADENCE_DOCS) {
      expect(getDoc(slug)!.body).toMatch(/3[–-]4 days/i);
    }
  });

  it('neither doc presents 3-4/week as current guidance', () => {
    // Mentioning the retired trial is fine; presenting it as the rhythm is not.
    for (const slug of CADENCE_DOCS) {
      const body = getDoc(slug)!.body;
      expect(body).not.toMatch(/TESTING themed-day/i);
      expect(body).not.toMatch(/^##.*3[–-]4\/week/im);
    }
  });

  it('does not resurrect the retired flat "1/week" rule as current guidance', () => {
    for (const slug of CADENCE_DOCS) {
      expect(getDoc(slug)!.body).not.toMatch(/Cadence — ~?1 strong hero song per week/i);
      expect(getDoc(slug)!.body).not.toMatch(/publish \*\*one strong hero song per week\*\*/i);
    }
  });
});