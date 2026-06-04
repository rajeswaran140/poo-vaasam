'use client';

/**
 * Responsive gallery of channel videos. Each card shows a thumbnail with a play
 * overlay; clicking swaps it for an inline YouTube embed (keeps viewers on-site
 * before the Subscribe CTA). A small "↗ YouTube" link in the footer gives
 * viewers who prefer the YouTube app a direct exit (also fires youtube_open).
 */

import Image from 'next/image';
import { useState } from 'react';
import { Play } from 'lucide-react';
import { YouTubeEmbed } from '@/components/YouTubeEmbed';
import { TrackedYouTubeOpen } from '@/components/TrackedYouTubeOpen';
import type { ChannelVideo } from '@/lib/youtube-feed';
import { SITE } from '@/config/site';
import { trackYouTubeOpen } from '@/lib/analytics-events';

function excerpt(text: string, max = 140): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max - 1).trimEnd() + '…';
}

export function VideoGallery({ videos }: { videos: ChannelVideo[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);

  if (!videos.length) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-400 font-tamil mb-4">
          விரைவில் காணொளிகள் இங்கே தோன்றும்.
        </p>
        <TrackedYouTubeOpen
          href={`https://www.youtube.com/channel/${SITE.youtube.channelId}`}
          destination="channel"
          source="videos_empty_state"
          className="inline-flex items-center gap-2 text-orange-400 hover:text-orange-300 font-tamil text-sm"
        >
          YouTube சேனலுக்கு செல்லவும் ↗
        </TrackedYouTubeOpen>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {videos.map((video) => (
        <div
          key={video.id}
          className="rounded-xl overflow-hidden bg-gray-800 border border-gray-700 shadow-sm flex flex-col"
        >
          {activeId === video.id ? (
            <YouTubeEmbed url={video.watchUrl} title={video.title} />
          ) : (
            <button
              type="button"
              onClick={() => {
                setActiveId(video.id);
                trackYouTubeOpen(`video:${video.id}`, 'videos_page');
              }}
              className="group relative block w-full aspect-video bg-black"
              aria-label={`Play: ${video.title}`}
            >
              <Image
                src={video.thumbnail}
                alt={video.title}
                width={480}
                height={360}
                loading="lazy"
                sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                className="w-full h-full object-cover opacity-90 transition group-hover:opacity-100"
              />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-orange-600/90 shadow-lg transition group-hover:bg-orange-600">
                  <Play className="ml-1 h-7 w-7 fill-white text-white" />
                </span>
              </span>
            </button>
          )}
          <div className="p-4 flex-1 flex flex-col gap-2">
            <h3 className="line-clamp-2 font-tamil text-sm text-gray-100">{video.title}</h3>
            {video.description && (
              <p className="line-clamp-2 font-tamil text-xs text-gray-400">
                {excerpt(video.description)}
              </p>
            )}
            <TrackedYouTubeOpen
              href={video.watchUrl}
              destination={`video:${video.id}`}
              source="videos_card_link"
              className="mt-auto inline-flex items-center self-start text-xs text-orange-400 hover:text-orange-300"
              ariaLabel={`Watch ${video.title} on YouTube`}
            >
              YouTube ↗
            </TrackedYouTubeOpen>
          </div>
        </div>
      ))}
    </div>
  );
}
