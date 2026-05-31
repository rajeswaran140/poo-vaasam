'use client';

/**
 * Responsive gallery of channel videos. Each card shows a thumbnail with a play
 * overlay; clicking swaps it for an inline YouTube embed (keeps viewers on-site
 * before the Subscribe CTA).
 */

import { useState } from 'react';
import { Play } from 'lucide-react';
import { YouTubeEmbed } from '@/components/YouTubeEmbed';
import type { ChannelVideo } from '@/lib/youtube-feed';
import { trackYouTubeOpen } from '@/lib/analytics-events';

export function VideoGallery({ videos }: { videos: ChannelVideo[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);

  if (!videos.length) {
    return (
      <p className="text-center text-gray-400 py-12 font-tamil">
        விரைவில் காணொளிகள் இங்கே தோன்றும்.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {videos.map((video) => (
        <div
          key={video.id}
          className="rounded-xl overflow-hidden bg-gray-800 border border-gray-700 shadow-sm"
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
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={video.thumbnail}
                alt={video.title}
                loading="lazy"
                className="w-full h-full object-cover opacity-90 transition group-hover:opacity-100"
              />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-orange-600/90 shadow-lg transition group-hover:bg-orange-600">
                  <Play className="ml-1 h-7 w-7 fill-white text-white" />
                </span>
              </span>
            </button>
          )}
          <div className="p-4">
            <h3 className="line-clamp-2 font-tamil text-sm text-gray-100">{video.title}</h3>
          </div>
        </div>
      ))}
    </div>
  );
}
