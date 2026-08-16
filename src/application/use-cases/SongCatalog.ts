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
    return (await this.listPublishedDetailed(limit)).songs;
  }

  /**
   * Same projection, but it also RETURNS WHAT IT THREW AWAY.
   *
   * ⚠️ The 37-song outage was invisible because the loop below used to be
   * `if (song) out.push(...)` and nothing else — a published record that failed
   * projection left no trace anywhere: no log, no count, no error. The site
   * simply served fewer songs than it had, and did so confidently for weeks.
   *
   * A discard is a legitimate outcome (a record with neither audio nor a video
   * really is unshowable), so this does not throw. But it must be COUNTABLE,
   * because "we dropped 37 of 55" and "we dropped 0 of 55" have to look
   * different to a monitor. `scripts/catalogue-completeness.ts` reads this.
   */
  async listPublishedDetailed(
    limit = 100
  ): Promise<{ songs: PublicSongDTO[]; dropped: Array<{ id: string; title: string }> }> {
    const page = await this.contentRepo.findByType(ContentType.SONGS, {
      status: ContentStatus.PUBLISHED,
      limit,
    });

    const songs: PublicSongDTO[] = [];
    const dropped: Array<{ id: string; title: string }> = [];
    for (const content of page.items) {
      const song = PublicSong.fromContent(content);
      if (song) {
        songs.push(song.toJSON());
      } else {
        const obj = content.toObject();
        dropped.push({ id: String(obj.id), title: String(obj.title ?? '').trim() });
      }
    }
    return { songs, dropped };
  }
}
