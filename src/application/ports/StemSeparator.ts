/**
 * StemSeparator — port for an audio source-separation engine.
 *
 * The application depends on this interface, not on a concrete engine, so the
 * separator is swappable (Demucs today; a future engine, a hosted API, or a
 * faster model later) without touching the use case — the same "prompt layer +
 * swappable engine" split used elsewhere in the codebase.
 *
 * Implementations run offline/batch (they are heavy ML) and produce a local
 * file; uploading and persistence are the use case's concern, not the port's.
 */

export interface StemSeparationInput {
  /** The song this master belongs to (for logging/label only). */
  songId: string;
  /** Local filesystem path to the finished master to separate. */
  sourceAudioPath: string;
}

export interface StemSeparationOutput {
  /** Local filesystem path to the produced instrumental (vocals removed). */
  instrumentalPath: string;
  /** Engine + version that produced it, e.g. "htdemucs". */
  model: string;
  /** Instrumental duration in whole seconds, when the engine reports it. */
  durationSeconds?: number;
}

export interface StemSeparator {
  /** Stable identifier of the engine+model, surfaced on the asset. */
  readonly model: string;
  /**
   * Separate `sourceAudioPath` and return the instrumental stem as a local
   * file. Rejects if the engine is unavailable or produces no output — the use
   * case translates that into a discriminated failure.
   */
  separate(input: StemSeparationInput): Promise<StemSeparationOutput>;
}
