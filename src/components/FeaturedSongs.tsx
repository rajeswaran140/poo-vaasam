/**
 * "Most-loved songs" — a curated rail of the top-5 featured songs. Used on the
 * homepage (with a link to /popular) and on the /popular page itself. Each card
 * drives to YouTube (watch → subscribe = the funnel goal) and carries a WhatsApp
 * share button (the #1 diaspora reach lever); a song with an on-site content
 * page also links there. Server component; the share button is a client island.
 */

import Image from 'next/image';
import Link from 'next/link';
import { FEATURED_SONGS, featuredWatchUrl, featuredThumbUrl, type FeaturedSong } from '@/config/featured-songs';
import { WhatsAppShareButton } from '@/components/content/WhatsAppShareButton';
import { absoluteUrl } from '@/lib/seo';

function PlayGlyph() {
  return (
    <span className="pointer-events-none absolute inset-0 grid place-items-center">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-black/55 text-white ring-1 ring-white/30 transition-transform group-hover:scale-110">
        <svg viewBox="0 0 24 24" fill="currentColor" className="ml-0.5 h-6 w-6" aria-hidden>
          <path d="M8 5v14l11-7z" />
        </svg>
      </span>
    </span>
  );
}

function FeaturedSongCard({ song }: { song: FeaturedSong }) {
  const watch = featuredWatchUrl(song.videoId);
  // SHARE the on-site song page, not the YouTube watch URL. A wa.me link to
  // youtube.com lands the recipient on YouTube, where our UTMs are ignored and
  // InboundTracker never runs — so the return leg was structurally
  // unmeasurable, even though the link looked instrumented. The song page
  // carries the embed + a YouTube CTA, so the funnel still ends at YouTube.
  const shareUrl = song.contentId ? absoluteUrl(`/content/${song.contentId}`) : watch;
  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5 transition-all hover:border-white/20 hover:bg-white/[0.07]">
      <a
        href={watch}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${song.title} — YouTube-ல் பாருங்கள்`}
        className="relative block aspect-video overflow-hidden"
      >
        <Image
          src={featuredThumbUrl(song.videoId)}
          alt={song.title}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          className="object-cover transition-transform duration-300 group-hover:scale-105"
        />
        <PlayGlyph />
      </a>
      <div className="flex flex-1 flex-col gap-1 p-4">
        <a href={watch} target="_blank" rel="noopener noreferrer" className="block">
          <h3 className="font-tamil text-lg font-bold leading-snug text-white">{song.title}</h3>
          <p className="text-sm text-gray-400">{song.romanized}</p>
        </a>
        <div className="mt-auto flex items-center gap-3 pt-3">
          <WhatsAppShareButton url={shareUrl} title={song.title} verb="listen" songId={song.contentId} compact />
          {song.contentId && (
            <Link
              href={`/content/${song.contentId}`}
              className="inline-flex min-h-[44px] items-center rounded-md px-2 py-2 font-tamil text-sm font-medium text-orange-400 hover:text-orange-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/60"
            >
              விவரங்கள் →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

export function FeaturedSongs({
  heading = 'மிகவும் விரும்பப்பட்ட பாடல்கள்',
  showAllLink = false,
}: {
  heading?: string;
  showAllLink?: boolean;
}) {
  return (
    <section aria-labelledby="featured-songs-heading" className="bg-gray-900 py-16">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-6xl">
          {/* Header row: on mobile stacks vertically (heading first, "see all"
              link underneath); on sm+ goes back to the side-by-side spread.
              The old side-by-side layout with `shrink-0` on the link forced
              a 409 px width on a 320 px viewport — the primary cause of the
              horizontal-scroll bug across the whole site. Verified by the
              mobile audit at scripts/mobile-audit.mjs on 2026-08-30. */}
          <div className="mb-8 flex flex-col items-start gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
            <div>
              <h2 id="featured-songs-heading" className="font-tamil text-3xl font-bold text-white sm:text-4xl">
                {heading}
              </h2>
              <p className="mt-2 font-tamil text-gray-400">
                அதிகம் கேட்கப்பட்ட பாடல்கள் — YouTube-ல் முழுமையாக அனுபவியுங்கள், நண்பர்களுடன் பகிருங்கள்.
              </p>
            </div>
            {showAllLink && (
              <Link
                href="/popular"
                className="inline-flex min-h-[44px] items-center rounded-md py-2 font-tamil text-orange-400 hover:text-orange-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/60 sm:shrink-0"
              >
                எல்லாம் பார்க்க →
              </Link>
            )}
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURED_SONGS.map((song) => (
              <FeaturedSongCard key={song.videoId} song={song} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
