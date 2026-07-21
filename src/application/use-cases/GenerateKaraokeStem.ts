/**
 * GenerateKaraokeStem — produce a subscriber-gated karaoke instrumental for an
 * existing song by separating its master, storing the instrumental, and
 * recording the asset.
 *
 * Offline/batch use case (stem separation is heavy ML) — invoked from the CLI
 * (`scripts/generate-karaoke-stem.ts`), not the request path, consistent with
 * the codebase rule that no ML runs during render.
 *
 * Follows the constructor-injected-ports pattern (see CreateContentUseCase) and
 * returns a discriminated result — it never throws, so a script or admin route
 * can decide how to surface each failure.
 */

import { KaraokeAsset } from '@/domain/songs/KaraokeAsset';
import type { StemSeparator } from '@/application/ports/StemSeparator';
import type {
  SongMasterSource,
  KaraokeInstrumentalStorage,
  KaraokeAssetRepository,
} from '@/application/ports/karaoke';

export type GenerateKaraokeStemResult =
  | { ok: true; asset: KaraokeAsset }
  | { ok: false; status: number; error: string };

export class GenerateKaraokeStem {
  constructor(
    private readonly masters: SongMasterSource,
    private readonly separator: StemSeparator,
    private readonly storage: KaraokeInstrumentalStorage,
    private readonly repository: KaraokeAssetRepository,
    /** Injected clock so the asset timestamp is deterministic under test. */
    private readonly now: () => Date = () => new Date()
  ) {}

  async execute(songId: string): Promise<GenerateKaraokeStemResult> {
    const id = songId?.trim();
    if (!id) {
      return { ok: false, status: 400, error: 'A songId is required.' };
    }

    // 1. Resolve the master. A missing song/master is a 404, not an error.
    let master: { localPath: string } | null;
    try {
      master = await this.masters.fetchMaster(id);
    } catch (err) {
      return this.fail(502, 'Failed to load the song master.', err);
    }
    if (!master) {
      return { ok: false, status: 404, error: 'Song master audio not found.' };
    }

    // 2. Separate — remove the vocal stem, keep the backing track.
    let separated;
    try {
      separated = await this.separator.separate({
        songId: id,
        sourceAudioPath: master.localPath,
      });
    } catch (err) {
      return this.fail(502, 'Stem separation failed.', err);
    }

    // 3. Store the instrumental in gated storage.
    let stored;
    try {
      stored = await this.storage.store({ songId: id, localPath: separated.instrumentalPath });
    } catch (err) {
      return this.fail(502, 'Separated the track but failed to store it.', err);
    }

    // 4. Build the gated domain asset (validates URL + timestamp).
    let asset: KaraokeAsset;
    try {
      asset = KaraokeAsset.create({
        songId: id,
        instrumentalKey: stored.objectKey,
        durationSeconds: stored.durationSeconds ?? separated.durationSeconds,
        separationModel: separated.model,
        createdAt: this.now().toISOString(),
      });
    } catch (err) {
      return this.fail(502, 'Produced an instrumental but it was invalid.', err);
    }

    // 5. Persist the reference against the song.
    try {
      await this.repository.save(asset);
    } catch (err) {
      return this.fail(502, 'Stored the instrumental but failed to record it.', err);
    }

    return { ok: true, asset };
  }

  private fail(status: number, error: string, err: unknown): GenerateKaraokeStemResult {
    console.error(`[GenerateKaraokeStem] ${error}`, err instanceof Error ? err.message : String(err));
    return { ok: false, status, error };
  }
}
