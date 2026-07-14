'use client';

/**
 * Responsive gallery of channel videos. Each card shows a thumbnail with a play
 * overlay; clicking swaps it for an inline YouTube embed (keeps viewers on-site
 * before the Subscribe CTA). A small "↗ YouTube" link in the footer gives
 * viewers who prefer the YouTube app a direct exit (also fires youtube_open).
 */

import Image from 'next/image';
import Link from 'next/link';
import { useState, useRef, useEffect } from 'react';
import { Play } from 'lucide-react';
import { YouTubeEmbed } from '@/components/YouTubeEmbed';
import { TrackedYouTubeOpen } from '@/components/TrackedYouTubeOpen';
import { WhatsAppShareButton } from '@/components/content/WhatsAppShareButton';
import type { ChannelVideo } from '@/lib/youtube-feed';
import { SITE } from '@/config/site';
import { trackYouTubeOpen } from '@/lib/analytics-events';
import { formatVideoDuration, relativeTimeTamil } from '@/lib/video-format';
import { absoluteUrl } from '@/lib/seo';

function excerpt(text: string, max = 140): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max - 1).trimEnd() + '…';
}

export function VideoGallery({
  videos,
  initialCount = 9,
  now = Date.now(),
  songPathById,
}: {
  videos: ChannelVideo[];
  initialCount?: number;
  /** Reference instant for relative dates; the server passes one so SSR and
   *  hydration format identically. */
  now?: number;
  /** video.id → on-site /content path, for videos that have a published song
   *  page. When present, the card title + footer link route to our indexable
   *  song page (which carries the embed + YouTube CTA) instead of straight to
   *  YouTube — the internal link the "Search → site → YouTube" funnel needs.
   *  Videos without a page fall back to the YouTube link. */
  songPathById?: Record<string, string>;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  // Only the first `initialCount` cards render initially — this is what the
  // server prerenders, so it bounds the SSR HTML (the page's main weight). The
  // rest reveal instantly from props (already passed) on "Load more"; no fetch.
  const [limit, setLimit] = useState(initialCount);
  const embedRef = useRef<HTMLDivElement>(null);
  const activeTitle = videos.find((v) => v.id === activeId)?.title ?? '';
  const visible = videos.slice(0, limit);

  // Swapping a card's play button for the inline embed removes the focused
  // button from the DOM. Move focus to the embed wrapper so keyboard / screen-
  // reader users keep their place (WCAG 2.4.3) instead of dropping to <body>.
  useEffect(() => {
    if (activeId) embedRef.current?.focus();
  }, [activeId]);

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
    <>
      {/* Announce the now-playing video to assistive tech. */}
      <div aria-live="polite" className="sr-only">{activeTitle ? `Now playing: ${activeTitle}` : ''}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {visible.map((video) => {
        const duration = formatVideoDuration(video.duration);
        const uploaded = relativeTimeTamil(video.publishedAt, now);
        const songPath = songPathById?.[video.id];
        return (
        <div
          key={video.id}
          className="group/card flex flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-800 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-orange-500/40 hover:shadow-xl hover:shadow-black/30"
        >
          {activeId === video.id ? (
            <div ref={embedRef} tabIndex={-1} aria-label={`Now playing: ${video.title}`} className="outline-none">
              <YouTubeEmbed url={video.watchUrl} title={video.title} playlist={SITE.youtube.allSongsPlaylistId} />
            </div>
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
                className="h-full w-full object-cover opacity-90 transition duration-300 group-hover:scale-105 group-hover:opacity-100"
              />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-orange-600/90 shadow-lg transition group-hover:scale-110 group-hover:bg-orange-600">
                  <Play className="ml-1 h-7 w-7 fill-white text-white" />
                </span>
              </span>
              {duration && (
                <span className="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white">
                  {duration}
                </span>
              )}
            </button>
          )}
          <div className="p-4 flex-1 flex flex-col gap-1.5">
            <h3 className="line-clamp-2 font-tamil text-sm text-gray-100">
              {songPath ? (
                <Link
                  href={songPath}
                  className="transition-colors hover:text-orange-300 focus-visible:text-orange-300 focus-visible:outline-none"
                >
                  {video.title}
                </Link>
              ) : (
                video.title
              )}
            </h3>
            {uploaded && <p className="font-tamil text-xs text-gray-500">{uploaded}</p>}
            {video.description && (
              <p className="mt-0.5 line-clamp-2 font-tamil text-xs text-gray-400">
                {excerpt(video.description)}
              </p>
            )}
            <div className="mt-auto flex items-center justify-between">
              {songPath ? (
                // Route to our indexable song page (it carries the embed + a
                // YouTube CTA) so the visitor stays on-site and the page earns
                // an internal link. The play button above still plays inline.
                <Link
                  href={songPath}
                  className="inline-flex min-h-[44px] items-center self-start py-2 text-xs font-medium text-orange-300 hover:text-orange-200"
                  aria-label={`${video.title} — பாடல் பக்கத்திற்குச் செல்லவும்`}
                >
                  இந்தப் பாடல் →
                </Link>
              ) : (
                <TrackedYouTubeOpen
                  href={video.watchUrl}
                  destination={`video:${video.id}`}
                  source="videos_card_link"
                  className="inline-flex min-h-[44px] items-center self-start py-2 text-xs text-orange-400 hover:text-orange-300"
                  ariaLabel={`Watch ${video.title} on YouTube`}
                >
                  YouTube ↗
                </TrackedYouTubeOpen>
              )}
              {/* Share the on-site song page when we have one: a wa.me link to
                  youtube.com strands the recipient where our UTMs are ignored and
                  InboundTracker can't run, so the return visit is unattributable. */}
              <WhatsAppShareButton
                url={songPath ? absoluteUrl(songPath) : video.watchUrl}
                title={video.title}
                verb="listen"
                compact
              />
            </div>
          </div>
        </div>
        );
      })}
      </div>
      {videos.length > limit && (
        <div className="mt-8 text-center">
          <button
            type="button"
            onClick={() => setLimit(videos.length)}
            className="inline-flex items-center gap-2 rounded-full border border-gray-700 px-6 py-3 font-tamil text-sm text-gray-200 transition-colors hover:border-orange-500/50 hover:text-orange-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/60"
          >
            மேலும் காண்க ({videos.length - limit})
          </button>
        </div>
      )}
    </>
  );
}
