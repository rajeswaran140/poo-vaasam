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
   * Play the video within this playlist so it auto-continues to the next song
   * in our own catalogue at the end, instead of YouTube's third-party
   * suggestions.
   */
  playlist?: string;
}

export function YouTubeEmbed({ url, title, vertical = false, playlist }: YouTubeEmbedProps) {
  const embedUrl = getYouTubeEmbedUrl(url, { playlist });

  if (!embedUrl) return null;

  return (
    <div
      className="relative w-full overflow-hidden rounded-xl bg-black shadow-md"
      style={{ paddingBottom: vertical ? '177.78%' : '56.25%' }}
    >
      <iframe
        className="absolute inset-0 h-full w-full"
        src={embedUrl}
        title={title || 'YouTube video player'}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}
