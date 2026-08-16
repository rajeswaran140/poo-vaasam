/** @jest-environment node */
/**
 * The check that would have caught the 37 hidden songs.
 *
 * ⚠️ The bug it exists for: 39 songs sat in DynamoDB marked PUBLISHED, and
 * `/songs` rendered 16 of them. Every song had been ingested — the INGESTION
 * gap was zero — so any check that only compared "YouTube vs the database"
 * would have reported a perfectly healthy catalogue while two thirds of it was
 * invisible to the public. That is the specific false-negative these tests pin.
 */

import {
  assessCatalogue,
  summariseCatalogue,
  type ChannelSong,
  type StoredSong,
} from '@/lib/catalogue-completeness';

const channel = (id: string, views: number): ChannelSong => ({ videoId: id, title: `song ${id}`, views });
const stored = (id: string, videoId: string | null, status = 'PUBLISHED'): StoredSong => ({
  id, title: `song ${id}`, youtubeVideoId: videoId, status,
});

describe('the visibility gap — a published song the public cannot see', () => {
  /** The exact 2026-08-16 shape: fully ingested, mostly invisible. */
  it('reports unhealthy when published records never reach the public surface', () => {
    const ch = [channel('v1', 100), channel('v2', 200), channel('v3', 300)];
    const st = [stored('c1', 'v1'), stored('c2', 'v2'), stored('c3', 'v3')];
    const visible = [{ id: 'c1' }];

    const r = assessCatalogue(ch, st, visible);

    expect(r.ingestionGap).toHaveLength(0);   // nothing missing from the DB…
    expect(r.visibilityGap).toHaveLength(2);  // …yet two songs are unreachable
    expect(r.healthy).toBe(false);
    expect(r.visibilityGap.map((g) => g.id)).toEqual(['c2', 'c3']);
  });

  /**
   * The false negative itself. A check built only on YouTube-vs-database would
   * pass this input; this one must not.
   */
  it('does NOT call a fully-ingested but invisible catalogue healthy', () => {
    const r = assessCatalogue([channel('v1', 10)], [stored('c1', 'v1')], []);
    expect(r.ingestionGap).toHaveLength(0);
    expect(r.healthy).toBe(false);
  });

  it('is healthy when every published record is visible', () => {
    const r = assessCatalogue([channel('v1', 10)], [stored('c1', 'v1')], [{ id: 'c1' }]);
    expect(r.healthy).toBe(true);
    expect(r.visibilityGap).toHaveLength(0);
  });

  /** A draft is *supposed* to be invisible — counting it would cry wolf daily. */
  it('ignores unpublished records', () => {
    const st = [stored('c1', 'v1'), stored('c2', 'v2', 'DRAFT')];
    const r = assessCatalogue([channel('v1', 10), channel('v2', 10)], st, [{ id: 'c1' }]);
    expect(r.healthy).toBe(true);
    expect(r.storedPublished).toBe(1);
  });
});

describe('the ingestion gap — on the channel, not on the site', () => {
  it('lists channel songs with no record, worst-first by views', () => {
    const ch = [channel('v1', 100), channel('v2', 900), channel('v3', 500)];
    const r = assessCatalogue(ch, [stored('c1', 'v1')], [{ id: 'c1' }]);

    expect(r.ingestionGap.map((g) => g.videoId)).toEqual(['v2', 'v3']);
    expect(r.ingestionGapViews).toBe(1400);
  });

  /**
   * View-weighting is the whole point — Raj's own remediation rule. Nine songs
   * is a number; "9 songs carrying 34% of the traffic" is a decision.
   */
  it('weights the gap by views, not by song count', () => {
    const ch = [channel('v1', 10), channel('v2', 990)];
    const r = assessCatalogue(ch, [stored('c1', 'v1')], [{ id: 'c1' }]);

    expect(r.ingestionGap).toHaveLength(1);          // 1 of 2 songs…
    expect(r.ingestionGapShare).toBeCloseTo(0.99);   // …but 99% of the views
  });

  /**
   * ⚠️ An ingestion gap must NOT flip `healthy`. Syncing is Raj-driven and a
   * song published this morning legitimately has no page yet; alerting on it
   * would make the signal noise, and noise is how the visibility bug survived.
   */
  it('does not mark the catalogue unhealthy merely for being unsynced', () => {
    const r = assessCatalogue([channel('v1', 10), channel('v2', 10)], [stored('c1', 'v1')], [{ id: 'c1' }]);
    expect(r.ingestionGap).toHaveLength(1);
    expect(r.healthy).toBe(true);
  });

  it('treats a blank youtubeVideoId as no link at all', () => {
    // Site-only songs (அம்மா சொன்ன கதை) carry '' or null here — they must not
    // accidentally "cover" a channel video via an empty-string match.
    const st = [stored('c1', ''), stored('c2', null), { ...stored('c3', '  ') }];
    const r = assessCatalogue([channel('v1', 10)], st, [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]);
    expect(r.ingestionGap.map((g) => g.videoId)).toEqual(['v1']);
  });
});

describe('summary line', () => {
  it('leads with the code fault when songs are invisible', () => {
    const r = assessCatalogue([channel('v1', 10)], [stored('c1', 'v1')], []);
    expect(summariseCatalogue(r)).toMatch(/^⚠️ 1 PUBLISHED but INVISIBLE/);
  });

  it('reads as routine when only a sync is outstanding', () => {
    const r = assessCatalogue([channel('v1', 10), channel('v2', 10)], [stored('c1', 'v1')], [{ id: 'c1' }]);
    const line = summariseCatalogue(r);
    expect(line).not.toMatch(/INVISIBLE/);
    expect(line).toContain('1/1 published songs visible');
    expect(line).toContain('1 not yet synced');
  });

  it('survives an empty channel without dividing by zero', () => {
    const r = assessCatalogue([], [], []);
    expect(r.ingestionGapShare).toBe(0);
    expect(summariseCatalogue(r)).toContain('0.0% of views');
  });
});

/**
 * ⚠️ Raj publishes improved lyrics as a NEW upload and never unlists the
 * original, so near-duplicate titles on the channel are DELIBERATE. Syncing one
 * blindly would create a second page for the same song and split its traffic —
 * so the gap flags them rather than hiding or auto-merging them.
 */
describe('re-recordings are flagged, not silently synced', () => {
  it('marks an unsynced song whose title already exists on the site', () => {
    const ch = [channel('vNew', 2123)];
    ch[0].title = 'செவ்வந்தி பூவே... சிரிக்கும் நிலவே... 🌺 | Sevvanthi';
    const st: StoredSong[] = [
      { id: 'c1', title: 'செவ்வந்தி பூவே... சிரிக்கும் நிலவே. . .❤️🌸', youtubeVideoId: 'vOld', status: 'PUBLISHED' },
    ];

    const r = assessCatalogue(ch, st, [{ id: 'c1' }]);

    expect(r.ingestionGap).toHaveLength(1);
    expect(r.ingestionGap[0].likelyRevisionOf).toEqual({ id: 'c1', title: st[0].title });
  });

  it('leaves a genuinely new song unflagged', () => {
    const ch = [channel('vNew', 100)];
    ch[0].title = 'நல்லதோர் வீணை செய்தே | Bharathiyar';
    const st: StoredSong[] = [
      { id: 'c1', title: 'செவ்வந்தி பூவே', youtubeVideoId: 'vOld', status: 'PUBLISHED' },
    ];

    const r = assessCatalogue(ch, st, [{ id: 'c1' }]);
    expect(r.ingestionGap[0].likelyRevisionOf).toBeUndefined();
  });

  /** A flag is advisory — it must not change the health verdict or the count. */
  it('does not suppress the song from the gap or alter health', () => {
    const ch = [channel('vNew', 10)];
    ch[0].title = 'ஒரே பாடல்';
    const st: StoredSong[] = [{ id: 'c1', title: 'ஒரே பாடல்', youtubeVideoId: 'vOld', status: 'PUBLISHED' }];

    const r = assessCatalogue(ch, st, [{ id: 'c1' }]);
    expect(r.ingestionGap).toHaveLength(1);
    expect(r.healthy).toBe(true);
  });
});

/**
 * ⚠️ Bilingual titles separate the Tamil hook from its romanization
 * inconsistently — sometimes "|", sometimes just a space. Matching on the raw
 * string made a song miss its own re-recording.
 */
describe('bilingual title matching', () => {
  const gapFor = (channelTitle: string, storedTitle: string) => {
    const ch = [channel('vNew', 10)];
    ch[0].title = channelTitle;
    const st: StoredSong[] = [{ id: 'c1', title: storedTitle, youtubeVideoId: 'vOld', status: 'PUBLISHED' }];
    return assessCatalogue(ch, st, [{ id: 'c1' }]).ingestionGap[0];
  };

  it('matches across a pipe separator and a bare space', () => {
    const g = gapFor(
      'நீ சிரிச்ச நேரம் தான் 🎋 Nee Sirichcha Neram Thaan',
      'நீ சிரிச்ச நேரம் தான். .❤️ | Nee Sirichcha Neram Thaan'
    );
    expect(g.likelyRevisionOf?.id).toBe('c1');
  });

  it('still distinguishes two genuinely different Tamil hooks', () => {
    const g = gapFor('கண்ணே என் உயிர்த்தமிழே ❤️ Kanne', 'நீ சிரிச்ச நேரம் தான் | Nee');
    expect(g.likelyRevisionOf).toBeUndefined();
  });

  /** An English-titled song has no Tamil prefix — it must not collapse to ''. */
  it('does not collapse English titles into one another', () => {
    const g = gapFor('Maple Breeze', 'Winter Lane');
    expect(g.likelyRevisionOf).toBeUndefined();
  });
});
