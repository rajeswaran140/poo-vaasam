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
      hasLyrics: false,
      publishedAt: '2026-02-01T00:00:00.000Z',
    });
  });

  it('reports hasLyrics=true when the song carries structured lyrics', () => {
    const song = PublicSong.fromContent(
      content({ lyrics: { sections: [{ kind: 'pallavi', lines: [{ text: 'வரி' }] }] } })
    )!;
    expect(song.toJSON().hasLyrics).toBe(true);
  });

  it('reports hasLyrics=false when lyrics are absent or empty', () => {
    expect(PublicSong.fromContent(content())!.toJSON().hasLyrics).toBe(false);
    expect(
      PublicSong.fromContent(content({ lyrics: { sections: [] } }))!.toJSON().hasLyrics
    ).toBe(false);
  });

  it('returns null for content with no audio (unplayable → dropped)', () => {
    expect(PublicSong.fromContent(content({ audioUrl: undefined }))).toBeNull();
    expect(PublicSong.fromContent(content({ audioUrl: '   ' }))).toBeNull();
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
