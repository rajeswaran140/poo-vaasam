/**
 * PerformerSong — the GATED read-model for the "For Performers" portal. Projects
 * the {@link Content} aggregate onto the performer contract (lyrics + backing
 * track) that only authenticated performers may see.
 *
 * Parallel to {@link PublicSong} but deliberately separate: PublicSong is the
 * anonymous, lyrics-free contract; PerformerSong carries the withheld lyrics and
 * the backing-track reference. The two never share a serializer, so the gated
 * fields can't accidentally leak onto the public feed.
 *
 * `instrumentalKey` is an S3 object key kept SERVER-SIDE — it is intentionally
 * absent from both client JSON shapes. The route presigns it into a short-lived
 * URL; the raw key never reaches the browser.
 */

import type { Content } from '@/domain/entities/Content';
import { ContentStatus } from '@/types/content';
import { themeForSongWithOverride } from '@/config/song-themes';

/** List item — no lyrics, no track reference (shown in the portal catalogue). */
export interface PerformerListItemDTO {
  id: string;
  slug: string;
  title: string;
  artist: string;
  theme: string;
  coverUrl?: string;
  durationSeconds?: number;
}

/** Detail — adds lyrics. The presigned instrumental URL is attached by the
 *  route (it isn't part of the durable projection). */
export interface PerformerSongDetailDTO {
  id: string;
  slug: string;
  title: string;
  artist: string;
  theme: string;
  coverUrl?: string;
  lyrics: string;
  durationSeconds?: number;
}

export class PerformerSong {
  private constructor(
    public readonly id: string,
    public readonly slug: string,
    public readonly title: string,
    public readonly artist: string,
    public readonly theme: string,
    public readonly lyrics: string,
    /** SERVER-ONLY — S3 object key for the backing track; never serialized. */
    public readonly instrumentalKey: string,
    public readonly coverUrl: string | undefined,
    public readonly durationSeconds: number | undefined
  ) {}

  /**
   * Project a Content aggregate onto the performer read-model. Returns null
   * unless the song is PUBLISHED and performable (has both gated lyrics and a
   * backing-track key) — so the portal never lists an un-performable song.
   */
  static fromContent(content: Content): PerformerSong | null {
    if (content.status !== ContentStatus.PUBLISHED) return null;
    if (!content.isPerformable()) return null;

    const obj = content.toObject();
    const lyrics = typeof obj.lyrics === 'string' ? obj.lyrics.trim() : '';
    const instrumentalKey = typeof obj.instrumentalKey === 'string' ? obj.instrumentalKey.trim() : '';
    if (!lyrics || !instrumentalKey) return null; // defensive — isPerformable already covers this

    const cover =
      typeof obj.featuredImage === 'string' && obj.featuredImage.trim() ? obj.featuredImage.trim() : undefined;

    return new PerformerSong(
      String(obj.id),
      String(obj.titleSlug || obj.id),
      String(obj.title ?? '').trim(),
      String(obj.author ?? '').trim(),
      themeForSongWithOverride(String(obj.id), obj.theme),
      lyrics,
      instrumentalKey,
      cover,
      typeof obj.instrumentalDuration === 'number' ? obj.instrumentalDuration : undefined
    );
  }

  toListJSON(): PerformerListItemDTO {
    return {
      id: this.id,
      slug: this.slug,
      title: this.title,
      artist: this.artist,
      theme: this.theme,
      coverUrl: this.coverUrl,
      durationSeconds: this.durationSeconds,
    };
  }

  toDetailJSON(): PerformerSongDetailDTO {
    return {
      id: this.id,
      slug: this.slug,
      title: this.title,
      artist: this.artist,
      theme: this.theme,
      coverUrl: this.coverUrl,
      lyrics: this.lyrics,
      durationSeconds: this.durationSeconds,
    };
  }
}
