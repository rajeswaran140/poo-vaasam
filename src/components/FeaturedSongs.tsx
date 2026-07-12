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
          <WhatsAppShareButton url={watch} title={song.title} verb="listen" compact />
          {song.contentId && (
            <Link href={`/content/${song.contentId}`} className="font-tamil text-xs font-medium text-orange-400 hover:text-orange-300">
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
          <div className="mb-8 flex items-end justify-between gap-4">
            <div>
              <h2 id="featured-songs-heading" className="font-tamil text-3xl font-bold text-white sm:text-4xl">
                {heading}
              </h2>
              <p className="mt-2 font-tamil text-gray-400">
                அதிகம் கேட்கப்பட்ட பாடல்கள் — YouTube-ல் முழுமையாக அனுபவியுங்கள், நண்பர்களுடன் பகிருங்கள்.
              </p>
            </div>
            {showAllLink && (
              <Link href="/popular" className="shrink-0 font-tamil text-orange-400 hover:text-orange-300">
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
