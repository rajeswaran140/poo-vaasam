/** @jest-environment node */
/**
 * song-video-match — link a song to its YouTube upload by title. Song titles
 * are the clean core ("செவ்விழி ஓவியமே"); video titles are decorated
 * ("செவ்விழி ஓவியமே. . . | தாய் மகள் பாச பாடல்"), so matching is normalised +
 * prefix-based. A wrong link is a visible bug, so every branch is tested.
 */

import { normalizeTitle, matchVideoByTitle } from '@/lib/song-video-match';

describe('normalizeTitle', () => {
  it('keeps Tamil + alphanumerics, drops spaces/dots/emoji/punctuation', () => {
    expect(normalizeTitle('செவ்விழி ஓவியமே. . . ❤️ | காவியமே')).toBe(
      normalizeTitle('செவ்விழிஓவியமேகாவியமே')
    );
    expect(normalizeTitle('Anbenum Theril!')).toBe('anbenumtheril');
  });
});

describe('matchVideoByTitle', () => {
  const videos = [
    { id: 'DozdKmt0cLY', title: 'கண்ணோடு நீர் அள்ளி' },
    { id: 'h1WgaJW9khI', title: 'செவ்விழி ஓவியமே. . .  செந்தமிழ்க் காவியமே. . .' },
    { id: 's9mRAyfxrSQ', title: 'செவ்விழி ஓவியமே ❤️ செந்தமிழ்க் காவியமே | தாய் மகள் பாச பாடல்' },
    { id: 'd3puwsvsZdI', title: 'பொன்வானம் சாயுதே' },
  ];

  it('matches an exact clean title', () => {
    expect(matchVideoByTitle('கண்ணோடு நீர் அள்ளி', videos)?.id).toBe('DozdKmt0cLY');
    expect(matchVideoByTitle('பொன்வானம் சாயுதே', videos)?.id).toBe('d3puwsvsZdI');
  });

  it('matches when the song title is the clean prefix of a decorated video title', () => {
    // two candidates start with the song title; the shorter (full video, not the
    // longer Short title) wins the tie.
    expect(matchVideoByTitle('செவ்விழி ஓவியமே', videos)?.id).toBe('h1WgaJW9khI');
  });

  it('returns null when nothing matches', () => {
    expect(matchVideoByTitle('முற்றிலும் வேறு பாடல்', videos)).toBeNull();
  });

  it('refuses to match on a too-short / empty title (avoids false positives)', () => {
    expect(matchVideoByTitle('', videos)).toBeNull();
    expect(matchVideoByTitle('அ', videos)).toBeNull();
  });
});
