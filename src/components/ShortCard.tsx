'use client';

/**
 * One Short: a 9:16 thumbnail that swaps to an inline vertical embed on click.
 *
 * Extracted from ShortsRow so the rail (/videos) and the grid (/shorts) render
 * the SAME card. Duplicating it would mean the badge, the focus handling and —
 * the part that matters — the playlist chaining drifting apart between two
 * surfaces showing the same videos.
 *
 * The caller owns the list item and its width, because that is the only thing
 * a rail and a grid genuinely disagree about.
 */

import Image from 'next/image';
import { Play } from 'lucide-react';
import { YouTubeEmbed } from '@/components/YouTubeEmbed';
import { TrackedYouTubeOpen } from '@/components/TrackedYouTubeOpen';
import type { ChannelVideo } from '@/lib/youtube-feed';
import { trackYouTubeOpen } from '@/lib/analytics-events';
import { relativeTimeTamil } from '@/lib/video-format';
import { SITE } from '@/config/site';

export function ShortCard({
  short,
  now,
  isActive,
  onPlay,
  embedRef,
  source,
}: {
  short: ChannelVideo;
  now: number;
  isActive: boolean;
  onPlay: () => void;
  embedRef?: React.Ref<HTMLDivElement>;
  /** Analytics surface, e.g. 'videos_shorts' or 'shorts_page'. */
  source: string;
}) {
  const uploaded = relativeTimeTamil(short.publishedAt, now);
  return (
    <>
      <div className="group/card overflow-hidden rounded-xl border border-gray-700 bg-gray-800 transition-all duration-200 hover:-translate-y-0.5 hover:border-orange-500/40 hover:shadow-xl hover:shadow-black/30">
        {isActive ? (
          <div ref={embedRef} tabIndex={-1} aria-label={`Now playing: ${short.title}`} className="outline-none">
            {/*
              Chained into OUR Shorts playlist, so what follows a finished Short
              is another Tamilagaval Short and never a third-party suggestion.
            */}
            <YouTubeEmbed
              url={short.watchUrl}
              title={short.title}
              vertical
              playlist={SITE.youtube.shortsPlaylistId}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              onPlay();
              trackYouTubeOpen(`video:${short.id}`, source);
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
              className="h-full w-full object-cover opacity-90 transition duration-300 group-hover:scale-105 group-hover:opacity-100"
            />
            <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              Short
            </span>
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-600/90 shadow-lg transition group-hover:scale-110 group-hover:bg-orange-600">
                <Play className="ml-0.5 h-6 w-6 fill-white text-white" />
              </span>
            </span>
          </button>
        )}
      </div>
      <h3 className="mt-2 line-clamp-2 font-tamil text-xs text-gray-200">{short.title}</h3>
      {uploaded && <p className="mt-0.5 font-tamil text-[11px] text-gray-500">{uploaded}</p>}
      <TrackedYouTubeOpen
        href={short.watchUrl}
        destination={`video:${short.id}`}
        source={`${source}_link`}
        className="mt-1 inline-flex min-h-[44px] items-center py-2 text-xs text-orange-400 hover:text-orange-300"
        ariaLabel={`Watch ${short.title} on YouTube`}
      >
        YouTube ↗
      </TrackedYouTubeOpen>
    </>
  );
}
