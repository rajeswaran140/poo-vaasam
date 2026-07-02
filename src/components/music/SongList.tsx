'use client';

/**
 * Presentational track list. Renders the rows it is given (already filtered +
 * sorted by SongsPlaylist) and drives the global MusicPlayerProvider — clicking
 * a row sets the player queue to exactly these rows, so the persistent bottom
 * bar continues playback as the visitor navigates away.
 */

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { Play, Pause, Music, ChevronRight } from 'lucide-react';
import { useMusicPlayer, formatTime, type Track } from './MusicPlayerProvider';
import { TrackedYouTubeOpen } from '@/components/TrackedYouTubeOpen';
import { WhatsAppShareButton } from '@/components/content/WhatsAppShareButton';
import { contentPath } from '@/config/vanity-paths';
import { absoluteUrl } from '@/lib/seo';
import { isAudioPlaybackEnabled } from '@/config/features';

/** Inline YouTube glyph (lucide has no youtube icon in this version). */
function YouTubeGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

/** A track plus the metadata the listing needs for sorting and filtering. */
export interface SongRow extends Track {
  /** createdAt as epoch ms, for "newest" sort. */
  addedAt?: number;
  /** Theme key from src/config/song-themes.ts, for the filter chips. */
  theme?: string;
  /** Linked YouTube video ID, if the song has been published as a video. */
  youtubeVideoId?: string;
}

export function SongList({ rows }: { rows: SongRow[] }) {
  const player = useMusicPlayer();
  const currentId = player.current?.id;
  const onSitePlayback = isAudioPlaybackEnabled();

  // When on-site playback is off, a song WITH a YouTube video routes to YouTube;
  // a song WITHOUT one keeps on-site playback (fallback), so nothing is orphaned.
  const routesToYouTube = (t: SongRow) => !onSitePlayback && !!t.youtubeVideoId;
  const canPlayOnSite = (t: SongRow) => !!t.src && !routesToYouTube(t);
  // The bottom-player queue contains only the on-site-playable rows.
  const playableRows = rows.filter(canPlayOnSite);

  const onPlay = (t: SongRow) => {
    if (!canPlayOnSite(t)) return;
    if (t.id === currentId) player.toggle();
    else {
      const idx = playableRows.findIndex((r) => r.id === t.id);
      if (idx >= 0) player.playQueue(playableRows, idx);
    }
  };

  // Keep the playing row visible as next/prev advances through the queue.
  const activeRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [currentId]);

  return (
    <ol className="max-w-3xl mx-auto divide-y divide-white/5">
      {rows.map((t, i) => {
        const active = t.id === currentId;
        const isPlayable = canPlayOnSite(t);
        const toYouTube = routesToYouTube(t);
        const watchUrl = `https://www.youtube.com/watch?v=${t.youtubeVideoId}`;

        const lead = (
          <>
            <span className="w-6 shrink-0 text-center text-sm text-gray-400">
              {isPlayable ? (
                active && player.isPlaying ? (
                  <>
                    <span className="eq text-orange-400 group-hover:hidden" aria-hidden>
                      <span /><span /><span /><span />
                    </span>
                    <Pause className="mx-auto hidden h-4 w-4 text-orange-400 group-hover:block" aria-hidden />
                  </>
                ) : active ? (
                  <Play className="mx-auto h-4 w-4 text-orange-400" aria-hidden />
                ) : (
                  <>
                    <span className="group-hover:hidden">{i + 1}</span>
                    <Play className="mx-auto hidden h-4 w-4 text-white group-hover:block" aria-hidden />
                  </>
                )
              ) : toYouTube ? (
                // Routed to YouTube — a red YouTube glyph makes it obvious the
                // row opens the video rather than playing on-site.
                <YouTubeGlyph className="mx-auto h-4 w-4 text-red-500" />
              ) : (
                <Music className="mx-auto h-4 w-4 text-gray-600" aria-hidden />
              )}
            </span>
            {/* Uniform music-note tile instead of per-song cover art. */}
            <span
              aria-hidden
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded bg-gradient-to-br from-orange-500/30 to-orange-700/30 shadow-sm ring-1 ring-white/10 transition duration-200 group-hover:scale-105 group-hover:shadow-md"
            >
              <Music className="h-5 w-5 text-orange-300" />
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block truncate font-tamil transition-colors ${active ? 'text-orange-400' : 'text-white'}`}>{t.title}</span>
              <span className="block truncate text-sm text-gray-400 font-tamil">{t.artist}</span>
            </span>
          </>
        );

        return (
          <li key={t.id} ref={active ? activeRef : undefined}>
            <div
              className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-200 sm:gap-4 sm:px-4 ${
                isPlayable || toYouTube
                  ? 'hover:bg-gradient-to-r hover:from-white/10 hover:to-transparent'
                  : 'opacity-60'
              } ${active ? 'bg-white/10 shadow-sm shadow-black/20 ring-1 ring-white/10' : ''}`}
            >
              {isPlayable ? (
                <button
                  type="button"
                  onClick={() => onPlay(t)}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-400/60 sm:gap-4"
                >
                  {lead}
                </button>
              ) : toYouTube ? (
                <TrackedYouTubeOpen
                  href={watchUrl}
                  destination={`video:${t.youtubeVideoId}`}
                  source="songs_list_row"
                  ariaLabel={`Watch ${t.title} on YouTube`}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-400/60 sm:gap-4"
                >
                  {lead}
                </TrackedYouTubeOpen>
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">{lead}</div>
              )}

              {t.youtubeVideoId && !toYouTube && (
                <TrackedYouTubeOpen
                  href={`https://www.youtube.com/watch?v=${t.youtubeVideoId}`}
                  destination={`video:${t.youtubeVideoId}`}
                  source="songs_list"
                  ariaLabel={`Watch ${t.title} on YouTube`}
                  className="hidden shrink-0 items-center px-2 py-2.5 text-xs text-gray-400 hover:text-orange-400 focus-visible:text-orange-400 focus-visible:outline-none sm:inline-flex"
                >
                  YouTube ↗
                </TrackedYouTubeOpen>
              )}
              {/* Routed to YouTube — a visible red badge (decorative; the whole
                  row is already the accessible YouTube link). */}
              {toYouTube && (
                <span
                  aria-hidden
                  className="hidden shrink-0 items-center gap-1 rounded-full bg-red-600/15 px-2.5 py-1 text-[11px] font-semibold text-red-400 sm:inline-flex"
                >
                  <YouTubeGlyph className="h-3.5 w-3.5" /> Watch
                </span>
              )}
              {/* WhatsApp share — the #1 diaspora channel, on every row so a song
                  can be forwarded to a chat/group/Status straight from browsing. */}
              <WhatsAppShareButton url={absoluteUrl(contentPath(t.id))} title={t.title} verb="listen" compact />
              <Link
                href={contentPath(t.id)}
                aria-label={`${t.title} — பாடல் வரிகள்`}
                className="flex shrink-0 items-center px-2 py-2.5 font-tamil text-gray-400 hover:text-orange-400 focus-visible:text-orange-400 focus-visible:outline-none"
              >
                <span className="hidden text-xs sm:inline">பாடல் வரிகள்</span>
                <ChevronRight className="h-4 w-4 sm:hidden" aria-hidden />
              </Link>
              <span className="w-10 shrink-0 text-right text-xs tabular-nums text-gray-500">
                {t.duration && (isPlayable || toYouTube) ? formatTime(t.duration) : ''}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
