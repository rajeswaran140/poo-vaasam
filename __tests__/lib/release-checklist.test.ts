import {
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
