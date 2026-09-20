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
 * ⚠️ A SHARED HOOK IS NOT A DUPLICATE. Every one of the six shared hooks on the
 * channel is a rendition pair — the same song issued as an instrumental, a
 * duet, a female version, a male version. Reading the flag as "re-upload"
 * repointed four song pages onto their instrumental on 2026-09-20.
 *
 * The fixtures below are those six real pairs, verbatim from YouTube.
 */
describe('a shared Tamil hook means the same song, not the same recording', () => {
  /** [hook, on-site title + views, on-YouTube title + views] — real, 2026-09-20. */
  const PAIRS: Array<[string, string, number, string, number]> = [
    [
      'நீ சிரிச்ச நேரம்',
      'நீ சிரிச்ச நேரம் தான். .❤️ | Nee Sirichcha Neram Thaan | Tamil Love Melody', 61924,
      'நீ சிரிச்ச நேரம் தான் 🎋 Nee Sirichcha Neram Thaan | Soothing Tamil Bamboo Flute Instrumental', 1531,
    ],
    [
      'செவ்வந்தி பூவே',
      'செவ்வந்தி பூவே... சிரிக்கும் நிலவே. . .❤️🌸 | Sevvanthi Poove | Tamil Love Melody', 50098,
      'செவ்வந்தி பூவே... சிரிக்கும் நிலவே... 🌺 | Sevvanthi Poove | Tamil Instrumental', 2242,
    ],
    [
      'என் பொன்மணி',
      'என் பொன்மணி என் கண்மணி ❤️ En Ponmani En Kanmani | Tamil Love Melody', 22425,
      'என் பொன்மணி... என் கண்மணி... 🎶 En Ponmani En Kanmani | Tamil Bamboo Flute Instrumental', 2170,
    ],
    [
      'எழுதாத வரியிலே',
      'எழுதாத வரியிலே... என்ன பெயர் வந்ததோ ❤️ Ezhudhaadha Variyile | Tamil Love Melody', 12991,
      'எழுதாத வரியிலே... என்ன பெயர் வந்ததோ ❤️ Ezhudhaadha Variyile | Romantic Tamil Duet Song', 13420,
    ],
    [
      'ஈழத்து மண்ணே',
      'ஈழத்து மண்ணே காலத்து பொன்னே | Eelathu Manne | Tamil Melody (பெண் குரல்)', 10659,
      'ஈழத்து மண்ணே காலத்து பொன்னே | Eelathu Manne | Tamil Melody (ஆண் குரல்)', 8852,
    ],
    [
      'பூபாளம் பாடும் நேரம்',
      'பூபாளம் பாடும் நேரம் ☀️ | Joyful Tamil Folk Song | Female Version', 3352,
      'பூபாளம் பாடும் நேரம்🎶 | ❤️ Tamil Romantic Duet Song | Poopaalam Paadum Neram', 2489,
    ],
  ];

  const gapFor = (onSite: string, onYouTube: string, views: number) => {
    const ch = [channel('vNew', views)];
    ch[0].title = onYouTube;
    const st: StoredSong[] = [{ id: 'c1', title: onSite, youtubeVideoId: 'vOld', status: 'PUBLISHED' }];
    return assessCatalogue(ch, st, [{ id: 'c1' }]).ingestionGap[0];
  };

  it.each(PAIRS)('%s — matches its other rendition on the hook', (_hook, onSite, _v1, onYouTube, views) => {
    expect(gapFor(onSite, onYouTube, views).sharesHookWith?.id).toBe('c1');
  });

  /**
   * The whole point of the fix: the report must hand back BOTH full titles.
   * The hook is identical on either side, so the descriptor — "Tamil Love
   * Melody" against "Bamboo Flute Instrumental" — is the only thing that can
   * tell a reader these are different recordings.
   */
  it.each(PAIRS)('%s — keeps both full titles so the two can be told apart', (_hook, onSite, _v1, onYouTube, views) => {
    const g = gapFor(onSite, onYouTube, views);
    expect(g.sharesHookWith?.title).toBe(onSite);
    expect(g.title).toBe(onYouTube);
    expect(g.title).not.toBe(g.sharesHookWith?.title);
  });

  /**
   * The id is the part that survives cleanSongTitle. A stored title has had its
   * descriptor stripped, so only the two video ids can tell a reader which
   * recording each side actually is.
   */
  it.each(PAIRS)('%s — names the video the site page already points at', (_hook, onSite, _v1, onYouTube, views) => {
    expect(gapFor(onSite, onYouTube, views).sharesHookWith?.youtubeVideoId).toBe('vOld');
  });

  it('omits the video id when the matched record has none', () => {
    const g = assessCatalogue(
      [{ videoId: 'vNew', title: 'ஒரே பாடல்', views: 10 }],
      [{ id: 'c1', title: 'ஒரே பாடல்', youtubeVideoId: '  ', status: 'PUBLISHED' }],
      [{ id: 'c1' }]
    ).ingestionGap[0];
    expect(g.sharesHookWith?.id).toBe('c1');
    expect(g.sharesHookWith?.youtubeVideoId).toBeUndefined();
  });

  it('leaves a genuinely different song unflagged', () => {
    const g = gapFor('செவ்வந்தி பூவே', 'நல்லதோர் வீணை செய்தே | Bharathiyar', 100);
    expect(g.sharesHookWith).toBeUndefined();
  });

  /** Advisory only — it must never change the count or the health verdict. */
  it('does not suppress the song from the gap or alter health', () => {
    const g = assessCatalogue(
      [{ videoId: 'vNew', title: 'ஒரே பாடல்', views: 10 }],
      [{ id: 'c1', title: 'ஒரே பாடல்', youtubeVideoId: 'vOld', status: 'PUBLISHED' }],
      [{ id: 'c1' }]
    );
    expect(g.ingestionGap).toHaveLength(1);
    expect(g.healthy).toBe(true);
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
    expect(g.sharesHookWith?.id).toBe('c1');
  });

  it('still distinguishes two genuinely different Tamil hooks', () => {
    const g = gapFor('கண்ணே என் உயிர்த்தமிழே ❤️ Kanne', 'நீ சிரிச்ச நேரம் தான் | Nee');
    expect(g.sharesHookWith).toBeUndefined();
  });

  /** An English-titled song has no Tamil prefix — it must not collapse to ''. */
  it('does not collapse English titles into one another', () => {
    const g = gapFor('Maple Breeze', 'Winter Lane');
    expect(g.sharesHookWith).toBeUndefined();
  });
});
