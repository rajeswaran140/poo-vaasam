/**
 * PublicSong read-model — projects the Content aggregate onto the public,
 * playable song contract the web player and Expo app consume. Domain rules
 * live here (audio required, theme resolution, ISO dates), NOT in the route.
 */

import { PublicSong } from '@/domain/songs/PublicSong';
import { Content } from '@/domain/entities/Content';
import { ContentType, ContentStatus } from '@/types/content';

/** Build a real Content aggregate from a raw row (mirrors the DB → entity path). */
function content(overrides: Record<string, unknown> = {}): Content {
  return Content.fromObject({
    id: 'cnt_1',
    type: ContentType.SONGS,
    title: 'காதல் பாடல்',
    titleSlug: 'kaadhal-paadal',
    body: 'lyrics',
    description: 'a love song',
    author: 'Rajeswaran',
    status: ContentStatus.PUBLISHED,
    featuredImage: 'https://cdn/cover.jpg',
    audioUrl: 'https://cdn/song.mp3',
    audioDuration: 212,
    youtubeVideoId: 'dQw4w9WgXcQ',
    theme: 'love',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    publishedAt: '2026-02-01T00:00:00.000Z',
    ...overrides,
  });
}

describe('PublicSong.fromContent', () => {
  it('maps a published song onto the public contract', () => {
    const dto = PublicSong.fromContent(content())!.toJSON();
    expect(dto).toEqual({
      id: 'cnt_1',
      slug: 'kaadhal-paadal',
      title: 'காதல் பாடல்',
      artist: 'Rajeswaran',
      audio: { url: 'https://cdn/song.mp3', durationSeconds: 212, mimeType: 'audio/mpeg' },
      coverUrl: 'https://cdn/cover.jpg',
      theme: 'love',
      youtubeVideoId: 'dQw4w9WgXcQ',
      publishedAt: '2026-02-01T00:00:00.000Z',
    });
  });

  /**
   * ⚠️ A SONG IS REACHABLE VIA AUDIO **OR** VIA YOUTUBE.
   *
   * Requiring audio silently deleted the whole YouTube-synced catalogue: the
   * sync deliberately never touches S3, so its pages have no `audioUrl` and
   * every one was dropped here. On 2026-08-16 that was 37 of 55 published
   * songs — invisible on /songs and 404 at their own URL while sitting
   * PUBLISHED in the database. `listableSongs()` was written to surface exactly
   * these, and could never see them.
   */
  it('keeps a YouTube-only song — no audio, but watchable', () => {
    const song = PublicSong.fromContent(content({ audioUrl: undefined }));
    expect(song).not.toBeNull();
    expect(song!.toJSON().audio).toBeUndefined();
    expect(song!.toJSON().youtubeVideoId).toBe('dQw4w9WgXcQ');
  });

  it('treats whitespace-only audio as absent, not as a URL', () => {
    expect(PublicSong.fromContent(content({ audioUrl: '   ' }))!.toJSON().audio).toBeUndefined();
  });

  it('keeps an audio-only song with no video', () => {
    const song = PublicSong.fromContent(content({ youtubeVideoId: undefined }));
    expect(song).not.toBeNull();
    expect(song!.toJSON().audio?.url).toBeTruthy();
  });

  /** Neither route = a dead page. That one is still dropped. */
  it('returns null only when the song is reachable NOWHERE', () => {
    expect(PublicSong.fromContent(content({ audioUrl: undefined, youtubeVideoId: undefined }))).toBeNull();
    expect(PublicSong.fromContent(content({ audioUrl: '  ', youtubeVideoId: '  ' }))).toBeNull();
  });

  it('lets a valid DB theme override win, else falls back to the config map', () => {
    expect(PublicSong.fromContent(content({ theme: 'mother' }))!.theme).toBe('mother');
    // invalid override → resolver falls back (DEFAULT or per-id config), never the junk value
    expect(PublicSong.fromContent(content({ theme: 'not-a-theme' }))!.theme).not.toBe('not-a-theme');
  });

  it('falls back to createdAt when publishedAt is absent', () => {
    const dto = PublicSong.fromContent(content({ publishedAt: undefined }))!.toJSON();
    expect(dto.publishedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('omits optional cover + youtubeVideoId when absent', () => {
    const dto = PublicSong
      .fromContent(content({ featuredImage: undefined, youtubeVideoId: undefined }))!
      .toJSON();
    expect(dto.coverUrl).toBeUndefined();
    expect(dto.youtubeVideoId).toBeUndefined();
  });

  it('omits duration when the source has none', () => {
    const dto = PublicSong.fromContent(content({ audioDuration: undefined }))!.toJSON();
    expect(dto.audio.durationSeconds).toBeUndefined();
    expect(dto.audio.url).toBe('https://cdn/song.mp3');
  });
});
