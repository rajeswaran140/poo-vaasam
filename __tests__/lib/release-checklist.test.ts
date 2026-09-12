import { youtubeSubscribeUrl } from '@/config/site';
import {
  SUBSCRIBE_URL,
  checkRelease,
  summariseRelease,
  hasRomanizedTitle,
  SHORTS_PLAYLIST_ID,
  ALL_SONGS_PLAYLIST_ID,
  LATEST_PLAYLIST_ID,
  type VideoSnapshot,
 } from '@/lib/release-checklist';

/** A fully-correct song upload — the shape everything else deviates from. */
const good: VideoSnapshot = {
  videoId: 'abc12345678',
  title: 'எழுதாத வரியிலே... ❤️ Ezhudhaadha Variyile | Romantic Tamil Duet Song',
  description: [
    '❤️ எழுதாத வரியிலே...',
    '',
    '✍️ Lyrics: Raj (original, all rights reserved)',
    '🔔 Subscribe: https://www.youtube.com/@Tamilagaval?sub_confirmation=1',
    '🌐 https://tamilagaval.com/?utm_source=youtube&utm_medium=description',
    `▶️ All Songs: https://www.youtube.com/playlist?list=${ALL_SONGS_PLAYLIST_ID}`,
    '#TamilSong #TamilMelody',
  ].join('\n'),
  tags: Array.from({ length: 24 }, (_, i) => `tag${i}`),
  categoryId: '10',
  defaultLanguage: 'ta',
  defaultAudioLanguage: 'ta',
  hasCustomThumbnail: true,
  isShort: false,
  playlistIds: [ALL_SONGS_PLAYLIST_ID, LATEST_PLAYLIST_ID],
  captionTracks: [{ trackKind: 'standard', language: 'ta' }],
};

const ids = (v: VideoSnapshot) => checkRelease(v).map((f) => f.id);

describe('a correct upload', () => {
  it('raises nothing mechanical', () => {
    const s = summariseRelease(good);
    expect(s.blockers).toBe(0);
    expect(s.gaps).toBe(0);
    expect(s.ready).toBe(true);
  });

  it('still surfaces the pinned comment, which no API can verify', () => {
    const pinned = checkRelease(good).find((f) => f.id === 'pinned-comment');
    expect(pinned?.manual).toBe(true);
    expect(pinned?.severity).toBe('note');
  });
});

describe('the real failures from 2026-07-28..30', () => {
  it('catches defaultAudioLanguage en-US on a Tamil song (the duet)', () => {
    const f = checkRelease({ ...good, defaultAudioLanguage: 'en-US' }).find(
      (x) => x.id === 'audio-language'
    );
    expect(f?.severity).toBe('blocker');
    expect(f?.fix).toBe('ta');
  });

  it('catches an unset audio language, not just a wrong one', () => {
    expect(ids({ ...good, defaultAudioLanguage: undefined })).toContain('audio-language');
  });

  it('catches a Short that names its premiere but never links it', () => {
    const short = {
      ...good,
      isShort: true,
      playlistIds: [SHORTS_PLAYLIST_ID],
      description: '❤️ Full song premiere July 31\n✍️ Lyrics: Raj\n#Shorts',
    };
    const f = checkRelease(short).find((x) => x.id === 'short-full-song-link');
    expect(f?.severity).toBe('blocker');
  });

  it('catches an English auto-caption on a Tamil song', () => {
    const f = checkRelease({
      ...good,
      captionTracks: [{ trackKind: 'asr', language: 'en' }],
    }).find((x) => x.id === 'asr-wrong-language');
    expect(f?.severity).toBe('blocker');
  });

  it('treats a Tamil auto-caption as a gap, not a blocker', () => {
    const f = checkRelease({
      ...good,
      captionTracks: [{ trackKind: 'asr', language: 'ta' }],
    }).find((x) => x.id === 'asr-track');
    expect(f?.severity).toBe('gap');
  });

  it('does not complain about a proper uploaded lyric track', () => {
    expect(ids(good)).not.toContain('asr-track');
    expect(ids(good)).not.toContain('asr-wrong-language');
  });

  it('catches a bare site link with no UTM', () => {
    expect(ids({ ...good, description: good.description.replace(/\?utm_source[^\s]*/, '') })).toContain(
      'utm-site-link'
    );
  });

  it('catches a dangling heading with nothing under it', () => {
    const f = checkRelease({
      ...good,
      description: good.description + '\n\n🎵 About Tamilagaval\n\n',
    }).find((x) => x.id === 'empty-section');
    expect(f).toBeDefined();
  });
});

describe('hasRomanizedTitle', () => {
  it('accepts a transliterated hook', () => {
    expect(hasRomanizedTitle('ஈழத்து மண்ணே | Eelathu Manne Kaalathu Ponne')).toBe(true);
  });

  it('rejects a title whose only Latin text is the English descriptor', () => {
    // This is the exact trap: "Tamil Duet Love Song" is Latin but carries no
    // searchable transliteration of the song's name.
    expect(hasRomanizedTitle('எழுதாத வரியிலே... ❤️ | Tamil Duet Love Song #Shorts')).toBe(false);
  });

  it('rejects a Tamil-only title', () => {
    expect(hasRomanizedTitle('நெஞ்சக் கூட்டினிலே')).toBe(false);
  });

  it('is not fooled by the brand name alone', () => {
    expect(hasRomanizedTitle('ஒத்த பனங்கீத்தே | TamilAgaval')).toBe(false);
  });
});

describe('playlist rules differ for Shorts and songs', () => {
  it('wants a Short in the Shorts playlist', () => {
    expect(ids({ ...good, isShort: true, playlistIds: [] })).toContain('playlist-membership');
  });

  it('does not demand Latest membership for a Short', () => {
    expect(
      ids({ ...good, isShort: true, playlistIds: [SHORTS_PLAYLIST_ID] })
    ).not.toContain('latest-playlist');
  });

  it('does not demand a custom thumbnail for a Short', () => {
    expect(
      ids({ ...good, isShort: true, hasCustomThumbnail: false, playlistIds: [SHORTS_PLAYLIST_ID] })
    ).not.toContain('thumbnail');
  });

  it('does demand one for a full song', () => {
    expect(ids({ ...good, hasCustomThumbnail: false })).toContain('thumbnail');
  });
});

describe('summary ordering and counts', () => {
  it('lists blockers before gaps before notes', () => {
    const sevs = checkRelease({
      ...good,
      defaultAudioLanguage: 'en-US',
      tags: [],
    }).map((f) => f.severity);
    const rank = { blocker: 0, gap: 1, note: 2 } as const;
    for (let i = 1; i < sevs.length; i++) {
      expect(rank[sevs[i]]).toBeGreaterThanOrEqual(rank[sevs[i - 1]]);
    }
  });

  it('is not ready while any blocker or gap remains', () => {
    expect(summariseRelease({ ...good, tags: [] }).ready).toBe(false);
  });

  it('counts each severity', () => {
    const s = summariseRelease({ ...good, defaultAudioLanguage: 'en-US', tags: [] });
    expect(s.blockers).toBeGreaterThan(0);
    expect(s.gaps).toBeGreaterThan(0);
    expect(s.notes).toBeGreaterThan(0);
  });
});

describe('what the checklist deliberately does NOT judge', () => {
  it('says nothing about duration — Raj ruled it out of scope', () => {
    const all = JSON.stringify(checkRelease({ ...good, isShort: true, playlistIds: [SHORTS_PLAYLIST_ID] }));
    expect(all.toLowerCase()).not.toContain('duration');
    expect(all).not.toMatch(/too long|seconds long/i);
  });

  it('says nothing about ஈழம் or other Tamil vocabulary', () => {
    const f = checkRelease({ ...good, title: 'ஈழத்து மண்ணே | Eelathu Manne', description: good.description + '\n#ஈழம்' });
    expect(JSON.stringify(f)).not.toContain('ஈழம்');
  });
});

describe('defects found by auditing against the live catalogue (2026-07-30)', () => {
  it('does not claim the thumbnail is fine — maxres is present on 100% of the catalogue', () => {
    // YouTube auto-generates maxres for HD uploads, so the old boolean check
    // could never fire. It must not report a passing gap it never tested.
    const withThumb = checkRelease(good).find((x) => x.id === 'thumbnail');
    const withoutThumb = checkRelease({ ...good, hasCustomThumbnail: false }).find(
      (x) => x.id === 'thumbnail'
    );
    // Same verdict either way, because the input is not trustworthy.
    expect(withThumb?.severity).toBe('note');
    expect(withoutThumb?.severity).toBe('note');
    expect(withThumb?.manual).toBe(true);
  });

  it('a vacuous thumbnail note never blocks readiness', () => {
    expect(summariseRelease({ ...good, hasCustomThumbnail: false }).ready).toBe(true);
  });

  it('skips caption findings for an unaired premiere', () => {
    const premiere = { ...good, isUpcoming: true, captionTracks: [] as VideoSnapshot['captionTracks'] };
    expect(ids(premiere)).not.toContain('asr-track');
    expect(ids(premiere)).toContain('upcoming-premiere');
  });

  it('does not flag a premiere for an ASR track it cannot have yet', () => {
    const premiere = { ...good, isUpcoming: true, captionTracks: [{ trackKind: 'asr', language: 'en' }] };
    expect(ids(premiere)).not.toContain('asr-wrong-language');
  });

  it('still flags wrong-language ASR once the premiere has aired', () => {
    const aired = { ...good, isUpcoming: false, captionTracks: [{ trackKind: 'asr', language: 'en' }] };
    expect(ids(aired)).toContain('asr-wrong-language');
  });
});

describe('the retired full name (catalogue sweep, 2026-07-31)', () => {
  it('catches it as a tag — the form 21 of 23 videos actually had', () => {
    const f = checkRelease({
      ...good,
      tags: [...good.tags, 'Rajeswaran Thangarajah'],
    }).find((x) => x.id === 'retired-name');
    expect(f?.severity).toBe('gap');
    expect(f?.detail).toContain('tag');
    expect(f?.fix).toBe('Raj Thangarajah');
  });

  it('catches the hashtag form, which has no space between the words', () => {
    const f = checkRelease({
      ...good,
      description: `${good.description}\n#RajeswaranThangarajah`,
    }).find((x) => x.id === 'retired-name');
    expect(f?.detail).toContain('description');
  });

  it('catches it in a title', () => {
    const f = checkRelease({
      ...good,
      title: `${good.title} — Rajeswaran Thangarajah`,
    }).find((x) => x.id === 'retired-name');
    expect(f?.detail).toContain('title');
  });

  it('does not fire on the approved shortened form', () => {
    expect(
      ids({ ...good, description: `${good.description}\n© 2026 TamilAgaval / Raj Thangarajah` })
    ).not.toContain('retired-name');
  });

  it('reports every field it appears in, not just the first', () => {
    const f = checkRelease({
      ...good,
      description: `${good.description}\n#RajeswaranThangarajah`,
      tags: [...good.tags, 'Rajeswaran Thangarajah'],
    }).find((x) => x.id === 'retired-name');
    expect(f?.detail).toContain('description');
    expect(f?.detail).toContain('tag');
  });

  it('keeps a clean upload ready', () => {
    expect(summariseRelease(good).ready).toBe(true);
  });
});

/**
 * ⚠️ The checklist's `fix` text is pasted into NEW video descriptions, so a
 * hardcoded handle here outlives any config change — in published descriptions
 * that cannot be bulk-edited cheaply. It must derive from the canonical URL.
 */
describe('SUBSCRIBE_URL derives from the canonical channel URL', () => {
  it('is the immutable /channel/UC… form, not a @handle', () => {
    expect(SUBSCRIBE_URL).toMatch(/youtube\.com\/channel\/UC[A-Za-z0-9_-]{22}\?sub_confirmation=1$/);
    expect(SUBSCRIBE_URL).not.toContain('/@');
  });

  it('is not a second hardcoded copy — it equals youtubeSubscribeUrl()', () => {
    expect(SUBSCRIBE_URL).toBe(youtubeSubscribeUrl());
  });
});

// ---------------------------------------------------------------------------
// Premiere reach — added 2026-09-12 after QDJG1P7D0Aw drew 2 views in its first
// 89 minutes against a 200–500 baseline. Nothing about that upload was
// misconfigured: it was public, HD, `ta`, category 10, 24 tags, a maxres
// thumbnail, in all three playlists, at position 0 of the uploads feed. Every
// existing check passed, and the release still reached nobody.
//
// What was different was the SCHEDULE, which no check looked at. These two do.
// ---------------------------------------------------------------------------

/** A snapshot that passes every pre-existing check, so only the new ones fire. */
function cleanUpcoming(over: Partial<VideoSnapshot> = {}): VideoSnapshot {
  return {
    ...good,
    isUpcoming: true,
    uploadedAt: '2026-09-19T09:00:00Z',
    scheduledStartTime: '2026-09-19T12:45:00Z',
    siblingReleases: [],
    ...over,
  };
}

describe('premiere-window', () => {
  it('does not fire when a premiere airs the same day it is uploaded', () => {
    const ids = checkRelease(cleanUpcoming()).map((x) => x.id);
    expect(ids).not.toContain('premiere-window');
  });

  it('fires when the video sits as an unaired premiere for more than 48h', () => {
    const found = checkRelease(
      cleanUpcoming({
        uploadedAt: '2026-09-09T12:57:00Z',
        scheduledStartTime: '2026-09-12T12:33:00Z', // QDJG: 71.6h
      })
    ).find((x) => x.id === 'premiere-window');

    expect(found).toBeDefined();
    expect(found!.severity).toBe('gap');
    expect(found!.detail).toMatch(/71|72/); // reports the actual gap in hours
  });

  it('is silent on a video that has already aired', () => {
    const ids = checkRelease(
      cleanUpcoming({
        isUpcoming: false,
        uploadedAt: '2026-09-09T12:57:00Z',
        scheduledStartTime: '2026-09-12T12:33:00Z',
      })
    ).map((x) => x.id);
    expect(ids).not.toContain('premiere-window');
  });

  it('is silent when the schedule is unknown rather than guessing', () => {
    const ids = checkRelease(
      cleanUpcoming({ uploadedAt: undefined, scheduledStartTime: undefined })
    ).map((x) => x.id);
    expect(ids).not.toContain('premiere-window');
  });
});

describe('release-density', () => {
  it('does not fire when the nearest other release is a week away', () => {
    const ids = checkRelease(
      cleanUpcoming({
        siblingReleases: [{ videoId: 'other1', publishedAt: '2026-09-12T12:00:00Z' }],
      })
    ).map((x) => x.id);
    expect(ids).not.toContain('release-density');
  });

  it('fires when another release lands within 36h', () => {
    const found = checkRelease(
      cleanUpcoming({
        scheduledStartTime: '2026-09-12T12:33:00Z',
        siblingReleases: [
          { videoId: 'NlVv9R0nzYE', publishedAt: '2026-09-11T12:33:05Z' }, // 24h before
          { videoId: 'fH7O5jqj554', publishedAt: '2026-09-11T15:43:05Z' }, // 20.8h before
        ],
      })
    ).find((x) => x.id === 'release-density');

    expect(found).toBeDefined();
    expect(found!.severity).toBe('gap');
    expect(found!.title).toContain('2 other releases');
    // and it names them, so the operator knows which ones competed
    expect(found!.detail).toContain('NlVv9R0nzYE');
    expect(found!.detail).toContain('fH7O5jqj554');
  });

  it('ignores the video itself when counting neighbours', () => {
    const snap = cleanUpcoming({
      videoId: 'SELF',
      scheduledStartTime: '2026-09-12T12:33:00Z',
      siblingReleases: [{ videoId: 'SELF', publishedAt: '2026-09-12T12:33:00Z' }],
    });
    expect(checkRelease(snap).map((x) => x.id)).not.toContain('release-density');
  });

  it('is silent when sibling data was not supplied', () => {
    const ids = checkRelease(cleanUpcoming({ siblingReleases: undefined })).map((x) => x.id);
    expect(ids).not.toContain('release-density');
  });
});
