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
describe('song video render doc keeps the findings that cost four rejected renders', () => {
  const doc = getDoc('song-video-render');

  it('the doc exists and is filed under Publishing', () => {
    expect(doc).toBeTruthy();
    expect(doc!.category).toBe('Publishing');
  });

  it('carries the accepted filter chain, not a cropped or letterboxed one', () => {
    const body = doc!.body;
    // increase+crop FILLS the frame. `decrease`+pad would pillarbox, and a zoom
    // would trim the artwork — Raj rejected both ("it is masked", "do not mask").
    expect(body).toContain('force_original_aspect_ratio=increase');
    expect(body).toContain('crop=2560:1440');
    expect(body).toContain('flags=lanczos');
  });

  it('targets 1440p, which is what earns VP9 rather than AVC', () => {
    expect(doc!.body).toContain('scale=2560:1440');
    expect(doc!.body).toMatch(/VP9/);
  });

  it('records that a moving overlay, not the CRF, is what starved the picture', () => {
    const body = doc!.body;
    expect(body).toMatch(/1\.37 Mbps/);
    expect(body).toMatch(/7\.09 Mbps/);
    expect(body).toMatch(/every frame differs from the last/i);
  });

  it('keeps the never-crop-the-artwork rule explicit', () => {
    expect(doc!.body).toMatch(/Never crop his artwork/i);
  });

  it('requires loudness to be verified on the finished MP4, not the source WAV', () => {
    const body = doc!.body;
    expect(body).toContain('ebur128');
    expect(body).toMatch(/off the finished MP4/i);
    expect(body).toMatch(/-14\.0 LUFS/);
  });

  it('warns that a YouTube video file cannot be replaced in place', () => {
    const body = doc!.body;
    expect(body).toMatch(/cannot swap the file on an existing video/i);
    expect(body).toMatch(/verify it \*\*before\*\* deleting the original/i);
  });

  /**
   * Both defects are FIXED (the aspect probe, and Re-render). The doc keeps
   * naming them because the manual recipe above was written while they were
   * live, and a reader who finds the recipe without the correction will keep
   * doing by hand what the portal now does.
   */
  it('names both render-button defects and records that they are fixed', () => {
    const body = doc!.body;
    expect(body).toMatch(/buildVideoFilter/);
    expect(body).toMatch(/art = height \* 0\.82/);
    expect(body).toMatch(/Re-render/);
    expect(body).toMatch(/both fixed/i);
    // And it must not still tell the operator the button is unusable.
    expect(body).not.toMatch(/Both are live/);
  });

  /**
   * The vertical clip is a public-feed deliverable, and two of its rules are
   * the kind that get "improved" away by someone who does not know the cost:
   * no burned Tamil (ffmpeg cannot shape the clusters), and the backdrop stays
   * (a 16:9 cover cannot fill 9:16 without cropping the artwork).
   */
  it('documents the vertical clip, including why it burns no lyrics', () => {
    const body = doc!.body;
    expect(body).toMatch(/Make a short/);
    expect(body).toMatch(/1080.{0,3}1920/);
    expect(body).toMatch(/No lyrics are burned in/i);
    expect(body).toMatch(/blurred backdrop/i);
    expect(body).toMatch(/Denied to CloudFront/i);
  });

  /**
   * The picker is the part an operator has to be TOLD about — the loop-drag
   * gesture already existed for months and went unused because nothing said it
   * could feed a clip. A doc that only describes the automatic behaviour leaves
   * them back where they started, picking by loudness.
   */
  it('tells the operator how to choose the window by ear', () => {
    const body = doc!.body;
    expect(body).toMatch(/drag across the waveform/i);
    expect(body).toMatch(/Use for the short/);
    expect(body).toMatch(/30-60s|30-60 seconds/);
    // And is honest that the automatic pick answers a different question.
    expect(body).toMatch(/finds the chorus, not the best lines/i);
  });
});
