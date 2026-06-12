/**
 * Responsive YouTube embed. Defaults to 16:9; pass `vertical` for a 9:16 frame
 * so Shorts play in their native portrait aspect instead of being letterboxed.
 *
 * Renders nothing if the URL isn't a recognizable YouTube link, so callers
 * can pass any stored video URL safely.
 */

import { getYouTubeEmbedUrl } from '@/lib/utils/youtube';

interface YouTubeEmbedProps {
  url: string;
  title?: string;
  /** Render a 9:16 portrait frame (for YouTube Shorts). */
  vertical?: boolean;
  /**
   * Start playback immediately. Only pass this when the embed is mounted in
   * response to a user gesture (e.g. a click-to-play poster) — the click is the
   * gesture that lets the autoplay start with sound AND makes YouTube count it
   * as a real view. Auto-mounting an `autoplay` embed on page load would be
   * muted by the browser and would NOT count.
   */
  autoplay?: boolean;
}

export function YouTubeEmbed({ url, title, vertical = false, autoplay = false }: YouTubeEmbedProps) {
  const embedUrl = getYouTubeEmbedUrl(url);

  if (!embedUrl) return null;

  // rel=0 keeps the post-play related strip to the same channel.
  const src = autoplay ? `${embedUrl}?autoplay=1&rel=0` : embedUrl;

  return (
    <div
      className="relative w-full overflow-hidden rounded-xl bg-black shadow-md"
      style={{ paddingBottom: vertical ? '177.78%' : '56.25%' }}
    >
      <iframe
        className="absolute inset-0 h-full w-full"
        src={src}
        title={title || 'YouTube video player'}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}
