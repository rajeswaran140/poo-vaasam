'use client';

/**
 * Featured (latest) video on /videos. Renders a poster facade; the visitor's
 * click swaps it for an inline autoplaying embed. The click is the user gesture
 * that (a) lets the embed start with sound and (b) makes YouTube count it as a
 * real view. We deliberately do NOT auto-mount the embed on page load — that
 * would be muted by the browser and would not count (and would be view
 * manipulation). A persistent "Watch on YouTube" link preserves the option of a
 * full YouTube session (more watch-time, which the algorithm rewards).
 */

import Image from 'next/image';
import { useState, useRef, useEffect } from 'react';
import { YouTubeEmbed } from '@/components/YouTubeEmbed';
import { trackYouTubeOpen } from '@/lib/analytics-events';
import type { ChannelVideo } from '@/lib/youtube-feed';

export function FeaturedVideoHero({ video }: { video: ChannelVideo }) {
  const [playing, setPlaying] = useState(false);
  const embedRef = useRef<HTMLDivElement>(null);

  // Swapping the poster button for the embed removes the focused element; move
  // focus to the embed wrapper so keyboard / screen-reader users keep their
  // place (WCAG 2.4.3) instead of dropping to <body>.
  useEffect(() => {
    if (playing) embedRef.current?.focus();
  }, [playing]);

  return (
    <div className="w-full">
      <div aria-live="polite" className="sr-only">
        {playing ? `Now playing: ${video.title}` : ''}
      </div>
      <div className="group relative block w-full overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/25 animate-fade-in">
        {playing ? (
          <div ref={embedRef} tabIndex={-1} aria-label={`Now playing: ${video.title}`} className="outline-none">
            <YouTubeEmbed url={video.watchUrl} title={video.title} autoplay />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setPlaying(true);
              trackYouTubeOpen(`video:${video.id}`, 'videos_hero');
            }}
            aria-label={`Play: ${video.title}`}
            className="relative block aspect-video w-full bg-black"
          >
            <Image
              src={video.thumbnail}
              alt={video.title}
              width={1280}
              height={720}
              priority
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="aspect-video w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
            <span aria-hidden className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/55 ring-2 ring-white/70 transition group-hover:bg-orange-600/90">
                <svg className="ml-1 h-7 w-7 fill-white text-white" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
            </span>
            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-4 pt-10 text-left">
              <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-orange-200">சமீபத்தியது</span>
              <span className="line-clamp-2 font-tamil text-sm font-medium text-white drop-shadow">{video.title}</span>
            </span>
          </button>
        )}
      </div>
      <a
        href={video.watchUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => trackYouTubeOpen(`video:${video.id}`, 'videos_hero_external')}
        className="mt-3 inline-flex items-center gap-1.5 font-tamil text-sm text-white/80 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        YouTube-ல் பார்க்க ↗
      </a>
    </div>
  );
}
