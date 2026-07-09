/**
 * YouTube URL helpers
 *
 * Normalizes the various YouTube URL shapes a user might paste
 * (watch?v=, youtu.be/, /embed/, /shorts/, /live/) into a canonical
 * video ID and an embeddable iframe URL.
 */

/**
 * Extract the 11-character video ID from any common YouTube URL form.
 * Returns null if the string is not a recognizable YouTube link.
 */
export function getYouTubeId(url: string | null | undefined): string | null {
  if (!url) return null;

  const direct = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([\w-]{11})/
  );
  if (direct) return direct[1];

  // Fallback: a v= query param anywhere in the URL
  const query = url.match(/[?&]v=([\w-]{11})/);
  if (query) return query[1];

  return null;
}

export interface YouTubeEmbedOptions {
  /**
   * Play the video inside this playlist so it auto-advances to the next song
   * in our own catalogue when it ends, instead of stopping on YouTube's
   * suggested-video grid.
   */
  playlist?: string | null;
}

/**
 * Convert any YouTube URL into its /embed/ form, or null if not YouTube.
 *
 * Always sets `rel=0` so the end-screen "related" videos are restricted to our
 * own channel (YouTube no longer allows disabling them entirely) — a finished
 * song never links out to a third-party channel. Pass `playlist` to have the
 * video continue straight into the next song in that playlist.
 */
export function getYouTubeEmbedUrl(
  url: string | null | undefined,
  options: YouTubeEmbedOptions = {}
): string | null {
  const id = getYouTubeId(url);
  if (!id) return null;

  const params = new URLSearchParams({
    rel: '0', // keep end-screen suggestions on our channel only
    playsinline: '1', // play inline on mobile rather than forcing fullscreen
  });
  if (options.playlist) params.set('list', options.playlist);

  return `https://www.youtube.com/embed/${id}?${params.toString()}`;
}

/**
 * True when the string looks like a YouTube video link.
 */
export function isYouTubeUrl(url: string | null | undefined): boolean {
  return getYouTubeId(url) !== null;
}

/**
 * Canonical watch URL (used for "Watch on YouTube" links).
 */
export function getYouTubeWatchUrl(url: string | null | undefined): string | null {
  const id = getYouTubeId(url);
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}
