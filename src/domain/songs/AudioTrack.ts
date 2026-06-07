/**
 * AudioTrack — a value object for a playable audio source.
 *
 * Immutable, validated, and value-equal. It captures the audio URL plus an
 * optional duration, and derives the MIME type from the file extension so
 * consumers (the web player, the future Expo app via react-native-track-player)
 * receive a ready-to-play descriptor instead of having to sniff the URL.
 *
 * Part of the Songs read-model — see {@link ./PublicSong}.
 */
export class AudioTrack {
  private constructor(
    public readonly url: string,
    public readonly durationSeconds: number | undefined,
    public readonly mimeType: string
  ) {}

  /**
   * Build an AudioTrack from a raw URL (+ optional duration in seconds).
   * Trims the URL and rejects empty input; normalises the duration (drops
   * zero/negative/NaN, rounds to whole seconds).
   */
  static fromUrl(url: string, durationSeconds?: number): AudioTrack {
    const trimmed = typeof url === 'string' ? url.trim() : '';
    if (!trimmed) {
      throw new Error('AudioTrack requires a non-empty url');
    }
    const duration =
      typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0
        ? Math.round(durationSeconds)
        : undefined;
    return new AudioTrack(trimmed, duration, AudioTrack.inferMimeType(trimmed));
  }

  /** Map a file extension to its audio MIME type; unknown → audio/mpeg. */
  static inferMimeType(url: string): string {
    const path = url.split('?')[0].toLowerCase();
    if (path.endsWith('.wav')) return 'audio/wav';
    if (path.endsWith('.m4a') || path.endsWith('.aac') || path.endsWith('.mp4')) return 'audio/mp4';
    if (path.endsWith('.ogg') || path.endsWith('.opus')) return 'audio/ogg';
    if (path.endsWith('.flac')) return 'audio/flac';
    return 'audio/mpeg'; // .mp3 and anything unrecognised
  }

  equals(other: AudioTrack): boolean {
    return (
      this.url === other.url &&
      this.durationSeconds === other.durationSeconds &&
      this.mimeType === other.mimeType
    );
  }

  toJSON(): { url: string; durationSeconds?: number; mimeType: string } {
    return { url: this.url, durationSeconds: this.durationSeconds, mimeType: this.mimeType };
  }
}
