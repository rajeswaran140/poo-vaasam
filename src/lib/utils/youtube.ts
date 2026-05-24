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

/**
 * Convert any YouTube URL into its /embed/ form, or null if not YouTube.
 */
export function getYouTubeEmbedUrl(url: string | null | undefined): string | null {
  const id = getYouTubeId(url);
  return id ? `https://www.youtube.com/embed/${id}` : null;
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
