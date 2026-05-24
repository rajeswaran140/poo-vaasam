/**
 * Responsive YouTube embed (16:9).
 *
 * Renders nothing if the URL isn't a recognizable YouTube link, so callers
 * can pass any stored video URL safely.
 */

import { getYouTubeEmbedUrl } from '@/lib/utils/youtube';

interface YouTubeEmbedProps {
  url: string;
  title?: string;
}

export function YouTubeEmbed({ url, title }: YouTubeEmbedProps) {
  const embedUrl = getYouTubeEmbedUrl(url);

  if (!embedUrl) return null;

  return (
    <div
      className="relative w-full overflow-hidden rounded-xl bg-black shadow-md"
      style={{ paddingBottom: '56.25%' }}
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
