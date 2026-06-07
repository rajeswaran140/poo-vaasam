/**
 * PublicSong — the read-model that projects the {@link Content} aggregate onto
 * the public, playable "song" contract shared by every client (the web player
 * today, the planned Expo app tomorrow).
 *
 * This is the read side of a CQRS-lite split: the Content aggregate owns writes
 * and the full editorial shape; PublicSong owns the narrow, stable view a
 * listener needs. Projection rules (audio is mandatory, theme resolution, ISO
 * dates) live HERE so route handlers and pages stay thin and every client sees
 * identical data.
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
  audio: { url: string; durationSeconds?: number; mimeType: string };
  coverUrl?: string;
  theme: string;
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
    public readonly audio: AudioTrack,
    public readonly theme: string,
    public readonly publishedAt: string,
    public readonly coverUrl: string | undefined,
    public readonly youtubeVideoId: string | undefined
  ) {}

  /**
   * Project a Content aggregate onto the public song read-model. Returns null
   * when the content is not a playable song (no audio URL) — the catalog drops
   * these rather than emit an unplayable track.
   */
  static fromContent(content: Content): PublicSong | null {
    const obj = content.toObject();

    const audioUrl = typeof obj.audioUrl === 'string' ? obj.audioUrl.trim() : '';
    if (!audioUrl) return null;

    const audio = AudioTrack.fromUrl(
      audioUrl,
      typeof obj.audioDuration === 'number' ? obj.audioDuration : undefined
    );

    const cover =
      typeof obj.featuredImage === 'string' && obj.featuredImage.trim()
        ? obj.featuredImage.trim()
        : undefined;
    const youtubeVideoId =
      typeof obj.youtubeVideoId === 'string' && obj.youtubeVideoId ? obj.youtubeVideoId : undefined;

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
      audio: this.audio.toJSON(),
      coverUrl: this.coverUrl,
      theme: this.theme,
      youtubeVideoId: this.youtubeVideoId,
      publishedAt: this.publishedAt,
    };
  }
}
