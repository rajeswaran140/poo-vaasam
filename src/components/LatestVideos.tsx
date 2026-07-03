'use client';

/**
 * Home-page "Latest videos" funnel — a client island.
 *
 * Fetches the public, always-fresh GET /api/youtube/videos (force-dynamic) on
 * the client so the landing page itself stays static/CDN-cached. This avoids the
 * Amplify ISR freeze that would otherwise pin a server-rendered feed to build
 * time. Renders nothing until real long-form videos load, so the section only
 * appears when there's something to show.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SubscribeButton } from '@/components/SubscribeButton';
import { TrackedYouTubeOpen } from '@/components/TrackedYouTubeOpen';
import { partitionShorts } from '@/lib/youtube-shorts';

interface FeedVideo {
  id: string;
  title: string;
  thumbnail: string;
  watchUrl: string;
  duration?: string;
}

export function LatestVideos() {
  // null = still loading; [] = loaded-but-empty (both render nothing).
  const [videos, setVideos] = useState<FeedVideo[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/youtube/videos');
        const json = (await res.json()) as { data?: { videos?: FeedVideo[] } };
        if (!alive) return;
        const all = json?.data?.videos ?? [];
        // Drop Shorts (they get their own row on /videos) and cap at 4 for the grid.
        setVideos(partitionShorts(all).videos.slice(0, 4));
      } catch {
        if (alive) setVideos([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!videos || videos.length === 0) return null;

  return (
    <section className="bg-gray-900 pt-16 pb-4">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <h2 className="text-3xl font-bold text-white font-kavivanar">சமீபத்திய காணொளிகள்</h2>
          <div className="flex items-center gap-4">
            <SubscribeButton label="YouTube" source="home_latest_videos" />
            <Link
              href="/videos"
              className="rounded text-orange-400 hover:text-orange-300 font-tamil font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
            >
              அனைத்தும் →
            </Link>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {videos.map((video) => (
            <TrackedYouTubeOpen
              key={video.id}
              href={video.watchUrl}
              destination={`video:${video.id}`}
              source="home_latest_videos"
              className="group block rounded-xl overflow-hidden bg-gray-800 border border-gray-700 hover:border-orange-500/50 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/70 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
            >
              <div className="relative aspect-video bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={video.thumbnail}
                  alt={video.title}
                  width={480}
                  height={270}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition"
                />
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-600/90 shadow-lg">
                    <svg className="w-6 h-6 text-white ml-0.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </span>
                </span>
              </div>
              <div className="p-3">
                <h3 className="line-clamp-2 text-sm text-gray-200 font-tamil">{video.title}</h3>
              </div>
            </TrackedYouTubeOpen>
          ))}
        </div>
      </div>
    </section>
  );
}
