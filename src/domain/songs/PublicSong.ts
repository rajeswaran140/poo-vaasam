/**
 * PublicSong — the read-model that projects the {@link Content} aggregate onto
 * the public, playable "song" contract shared by every client (the web player
 * today, the planned Expo app tomorrow).
 *
 * This is the read side of a CQRS-lite split: the Content aggregate owns writes
 * and the full editorial shape; PublicSong owns the narrow, stable view a
 * listener needs. Projection rules (playability, theme resolution, ISO dates)
 * live HERE so route handlers and pages stay thin and every client sees
 * identical data.
 *
 * ⚠️ A SONG IS PLAYABLE VIA AUDIO **OR** VIA YOUTUBE. Audio used to be
 * mandatory, which silently deleted the entire YouTube-synced catalogue from
 * the site: `/admin/content → Sync songs from YouTube` deliberately never
 * touches S3, so the pages it creates have no `audioUrl` — and every one of
 * them was discarded here. On 2026-08-16 that was 37 of 55 published songs,
 * absent from /songs AND 404 at their own URL while sitting PUBLISHED in the
 * database. `listableSongs()` exists precisely to show YouTube-only songs when
 * on-site playback is off, but it could never see them: they were dropped
 * before it ran.
 */

import type { Content } from '@/domain/entities/Content';
import { themeForSongWithOverride } from '@/config/song-themes';
import { AudioTrack } from './AudioTrack';

/** The serialised contract emitted by the API and consumed by clients. */
export interface PublicSongDTO {
  id: string;
  slug: string;
  title: string;
  artist: string;
  /** Absent when the song is watched on YouTube rather than played on-site. */
  audio?: { url: string; durationSeconds?: number; mimeType: string };
  coverUrl?: string;
  /** Absent when nobody has classified the song — never silently `love`. */
  theme?: string;
  youtubeVideoId?: string;
  /** ISO-8601 — interop-friendly across web + native clients. */
  publishedAt: string;
}

export class PublicSong {
  private constructor(
    public readonly id: string,
    public readonly slug: string,
    public readonly title: string,
    public readonly artist: string,
    public readonly audio: AudioTrack | undefined,
    public readonly theme: string | null,
    public readonly publishedAt: string,
    public readonly coverUrl: string | undefined,
    public readonly youtubeVideoId: string | undefined
  ) {}

  /**
   * Project a Content aggregate onto the public song read-model. Returns null
   * only when the song can be reached NOWHERE — no audio to play and no video
   * to watch. Such a record would render a dead page, so the catalogue still
   * drops it.
   */
  static fromContent(content: Content): PublicSong | null {
    const obj = content.toObject();

    const audioUrl = typeof obj.audioUrl === 'string' ? obj.audioUrl.trim() : '';
    const videoId =
      typeof obj.youtubeVideoId === 'string' && obj.youtubeVideoId.trim()
        ? obj.youtubeVideoId.trim()
        : '';

    // Reachable by EITHER route. Neither = nothing to show; drop it.
    if (!audioUrl && !videoId) return null;

    const audio = audioUrl
      ? AudioTrack.fromUrl(
          audioUrl,
          typeof obj.audioDuration === 'number' ? obj.audioDuration : undefined
        )
      : undefined;

    const cover =
      typeof obj.featuredImage === 'string' && obj.featuredImage.trim()
        ? obj.featuredImage.trim()
        : undefined;
    const youtubeVideoId = videoId || undefined;

    return new PublicSong(
      String(obj.id),
      String(obj.titleSlug || obj.id),
      String(obj.title ?? '').trim(),
      String(obj.author ?? '').trim(),
      audio,
      themeForSongWithOverride(String(obj.id), obj.theme),
      PublicSong.toIso(obj.publishedAt ?? obj.createdAt),
      cover,
      youtubeVideoId
    );
  }

  /** Coerce a Date | ISO string | epoch number into an ISO-8601 string. */
  private static toIso(value: unknown): string {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string' || typeof value === 'number') {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? '' : d.toISOString();
    }
    return '';
  }

  toJSON(): PublicSongDTO {
    return {
      id: this.id,
      slug: this.slug,
      title: this.title,
      artist: this.artist,
      audio: this.audio?.toJSON(),
      coverUrl: this.coverUrl,
      ...(this.theme ? { theme: this.theme } : {}),
      youtubeVideoId: this.youtubeVideoId,
      publishedAt: this.publishedAt,
    };
  }
}
