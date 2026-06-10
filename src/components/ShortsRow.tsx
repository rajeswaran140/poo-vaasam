'use client';

/**
 * Horizontal, swipeable row of YouTube Shorts. Mirrors VideoGallery's
 * click-to-embed pattern but in portrait (9:16): each card shows a cropped
 * thumbnail with a "Short" badge and a play overlay; clicking swaps it for an
 * inline vertical embed. Kept separate from the 16:9 video grid so Shorts no
 * longer render letterboxed alongside full songs.
 */

import Image from 'next/image';
import { useState, useRef, useEffect } from 'react';
import { Play } from 'lucide-react';
import { YouTubeEmbed } from '@/components/YouTubeEmbed';
import { TrackedYouTubeOpen } from '@/components/TrackedYouTubeOpen';
import type { ChannelVideo } from '@/lib/youtube-feed';
import { trackYouTubeOpen } from '@/lib/analytics-events';

export function ShortsRow({ shorts }: { shorts: ChannelVideo[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const embedRef = useRef<HTMLDivElement>(null);
  const activeTitle = shorts.find((s) => s.id === activeId)?.title ?? '';

  // Move focus to the embed wrapper when a Short swaps in its inline player, so
  // keyboard / screen-reader users keep their place (WCAG 2.4.3).
  useEffect(() => {
    if (activeId) embedRef.current?.focus();
  }, [activeId]);

  if (!shorts.length) return null;

  return (
    <>
      <div aria-live="polite" className="sr-only">{activeTitle ? `Now playing: ${activeTitle}` : ''}</div>
      <ul className="flex gap-4 overflow-x-auto pb-3 snap-x" aria-label="Shorts">
      {shorts.map((short) => (
        <li key={short.id} className="w-44 shrink-0 snap-start sm:w-48">
          <div className="overflow-hidden rounded-xl border border-gray-700 bg-gray-800">
            {activeId === short.id ? (
              <div ref={embedRef} tabIndex={-1} aria-label={`Now playing: ${short.title}`} className="outline-none">
                <YouTubeEmbed url={short.watchUrl} title={short.title} vertical />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setActiveId(short.id);
                  trackYouTubeOpen(`video:${short.id}`, 'videos_shorts');
                }}
                className="group relative block w-full overflow-hidden bg-black"
                style={{ aspectRatio: '9 / 16' }}
                aria-label={`Play Short: ${short.title}`}
              >
                <Image
                  src={short.thumbnail}
                  alt={short.title}
                  width={216}
                  height={384}
                  loading="lazy"
                  sizes="192px"
                  className="h-full w-full object-cover opacity-90 transition group-hover:opacity-100"
                />
                <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  Short
                </span>
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-600/90 shadow-lg transition group-hover:bg-orange-600">
                    <Play className="ml-0.5 h-6 w-6 fill-white text-white" />
                  </span>
                </span>
              </button>
            )}
          </div>
          <h3 className="mt-2 line-clamp-2 font-tamil text-xs text-gray-200">{short.title}</h3>
          <TrackedYouTubeOpen
            href={short.watchUrl}
            destination={`video:${short.id}`}
            source="videos_shorts_link"
            className="mt-1 inline-flex min-h-[44px] items-center py-2 text-xs text-orange-400 hover:text-orange-300"
            ariaLabel={`Watch ${short.title} on YouTube`}
          >
            YouTube ↗
          </TrackedYouTubeOpen>
        </li>
      ))}
      </ul>
    </>
  );
}
