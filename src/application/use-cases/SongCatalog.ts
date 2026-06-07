/**
 * SongCatalog — the read-side application service for the public song feed.
 *
 * Depends only on the IContentRepository abstraction (dependency inversion), so
 * it is fully unit-testable with an in-memory fake and carries no DynamoDB or
 * Next.js coupling. It orchestrates: query published SONGS → project each onto
 * the PublicSong read-model → drop the unplayable ones → emit plain DTOs.
 */

import type { IContentRepository } from '@/domain/repositories/IContentRepository';
import { ContentType, ContentStatus } from '@/types/content';
import { PublicSong, type PublicSongDTO } from '@/domain/songs/PublicSong';

export class SongCatalog {
  constructor(private readonly contentRepo: IContentRepository) {}

  /**
   * Every published, playable song as the public DTO, newest first (the
   * repository's GSI ordering). `limit` caps the page; the catalog is small,
   * so one page is the whole list today.
   */
  async listPublished(limit = 100): Promise<PublicSongDTO[]> {
    const page = await this.contentRepo.findByType(ContentType.SONGS, {
      status: ContentStatus.PUBLISHED,
      limit,
    });

    const out: PublicSongDTO[] = [];
    for (const content of page.items) {
      const song = PublicSong.fromContent(content);
      if (song) out.push(song.toJSON());
    }
    return out;
  }
}
