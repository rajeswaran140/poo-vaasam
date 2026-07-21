/**
 * KaraokeAsset — a value object for a subscriber-gated karaoke track derived
 * from a published song's master.
 *
 * The audio is produced offline by stem separation (see the {@link
 * ../../application/ports/StemSeparator} port and its Demucs adapter): the
 * finished master is split and the vocal stem removed, leaving a backing track
 * subscribers can sing over. It is NOT a public asset — the crux of the
 * Performers feature is asset-level gating, so this holds the private S3 object
 * **key**, never a public URL. A playable URL is minted per request by a gated
 * streaming route that consults {@link isAccessibleBy}; the raw object is never
 * given a public address (the media CDN serves any *public* URL unsigned, so
 * exposing one would defeat the gate — the mistake this model prevents).
 *
 * Immutable, validated, value-equal — consistent with {@link ./AudioTrack}.
 *
 * IMPORTANT: this concerns the *instrumental* only. The standing rule that
 * lyrics are never publicly displayed or altered is unaffected — any lyric
 * pairing for karaoke is a separate, equally gated asset.
 */

/** Who may access a karaoke asset. Only one state today, but modelled as a
 *  union so a future "preview" tier is an additive change, not a refactor. */
export type KaraokeVisibility = 'subscribers';

export interface KaraokeViewer {
  /** True when the request is from an authenticated, entitled subscriber. */
  isSubscriber: boolean;
}

export class KaraokeAsset {
  private constructor(
    public readonly songId: string,
    /** Private S3 object key of the instrumental (NOT a public URL). */
    public readonly instrumentalKey: string,
    public readonly durationSeconds: number | undefined,
    /** Separation engine + version that produced the stem, e.g. "htdemucs".
     *  Recorded so a later model upgrade can identify assets to regenerate. */
    public readonly separationModel: string,
    public readonly createdAt: string,
    public readonly visibility: KaraokeVisibility
  ) {}

  /**
   * Build a KaraokeAsset. Requires a non-empty songId, instrumentalKey, and
   * separationModel, plus a valid ISO-8601 `createdAt`. A non-positive/NaN
   * duration normalises to undefined. Visibility is fixed to 'subscribers' —
   * the gate is not a caller decision.
   */
  static create(params: {
    songId: string;
    instrumentalKey: string;
    durationSeconds?: number;
    separationModel: string;
    createdAt: string;
  }): KaraokeAsset {
    const songId = params.songId?.trim();
    if (!songId) {
      throw new Error('KaraokeAsset requires a non-empty songId');
    }
    const instrumentalKey = params.instrumentalKey?.trim();
    if (!instrumentalKey) {
      throw new Error('KaraokeAsset requires a non-empty instrumentalKey');
    }
    // A gated asset must never carry a public URL — guard against a caller
    // passing one where the private object key belongs.
    if (/^https?:\/\//i.test(instrumentalKey)) {
      throw new Error('KaraokeAsset.instrumentalKey must be an S3 object key, not a URL');
    }
    const separationModel = params.separationModel?.trim();
    if (!separationModel) {
      throw new Error('KaraokeAsset requires a non-empty separationModel');
    }
    const createdAt = params.createdAt?.trim();
    if (!createdAt || Number.isNaN(Date.parse(createdAt))) {
      throw new Error('KaraokeAsset requires a valid ISO-8601 createdAt');
    }
    const duration =
      typeof params.durationSeconds === 'number' &&
      Number.isFinite(params.durationSeconds) &&
      params.durationSeconds > 0
        ? Math.round(params.durationSeconds)
        : undefined;

    return new KaraokeAsset(songId, instrumentalKey, duration, separationModel, createdAt, 'subscribers');
  }

  /**
   * The gate. A karaoke asset is accessible only to entitled subscribers.
   * Routes and the player MUST consult this rather than re-deriving the rule.
   */
  isAccessibleBy(viewer: KaraokeViewer): boolean {
    if (this.visibility === 'subscribers') {
      return viewer?.isSubscriber === true;
    }
    // Unreachable today; exhaustive guard for when the union grows.
    return false;
  }

  equals(other: KaraokeAsset): boolean {
    return (
      this.songId === other.songId &&
      this.instrumentalKey === other.instrumentalKey &&
      this.durationSeconds === other.durationSeconds &&
      this.separationModel === other.separationModel &&
      this.createdAt === other.createdAt &&
      this.visibility === other.visibility
    );
  }

  toJSON(): {
    songId: string;
    instrumentalKey: string;
    durationSeconds?: number;
    separationModel: string;
    createdAt: string;
    visibility: KaraokeVisibility;
  } {
    return {
      songId: this.songId,
      instrumentalKey: this.instrumentalKey,
      durationSeconds: this.durationSeconds,
      separationModel: this.separationModel,
      createdAt: this.createdAt,
      visibility: this.visibility,
    };
  }
}
