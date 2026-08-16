/**
 * Songs Listing Page — Spotify-style music player.
 */

// MUST stay a build-time prerender. Songs come from DynamoDB, whose IAM
// credentials (APP_AWS_*) are only present at BUILD time (written to
// .env.production.local by amplify.yml); they are NOT inlined for the SSR
// runtime, so a `force-dynamic` render reads no creds and returns an empty
// list. The trade-off is that a newly published song only appears after the
// next deploy (Amplify doesn't run Next's ISR revalidation reliably either).
// To make this dynamic, first give the SSR runtime DB credentials — either
// inline APP_AWS_* in next.config.ts `env:` or grant the Amplify compute role
// DynamoDB read access. See HARDENING.md.
export const revalidate = 300;

import type { Metadata } from 'next';
import Header from '@/components/Header';
import { Footer } from '@/components/Footer';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { SongCatalog } from '@/application/use-cases/SongCatalog';
import { listableSongs } from '@/lib/songs-visibility';
import type { PublicSongDTO } from '@/domain/songs/PublicSong';
import { SongsPlaylist, type SongRow } from '@/components/music/SongsPlaylist';
import { StudioCta } from '@/components/StudioCta';
import { JsonLd } from '@/components/JsonLd';
import { SITE_NAME, absoluteUrl, alternatesFor, breadcrumbJsonLd } from '@/lib/seo';
import { isoDuration } from '@/lib/iso-duration';
import Link from 'next/link';
import { eligibleCollectionThemes, SONG_COLLECTIONS } from '@/config/song-collections';

// Crawler-facing title/description use romanised English so the page ranks for
// real queries (tamil songs / paadal varigal); the visible <h1> on the page
// stays "பாடல்கள்".
const META_TITLE = 'Tamil Songs & Paadal Varigal';
const META_DESCRIPTION =
  'Free Tamil songs and paadal varigal by Raj — listen, read the lyrics, share. Always free.';
const JSONLD_NAME = 'Tamil Songs & Paadal Varigal — Tamilagaval';

/**
 * Best available share image:
 * - First song's featuredImage if set
 * - Otherwise the top YouTube video's maxres thumbnail (real photo of the work)
 * Keeps WhatsApp/FB/X previews from being blank.
 */
const FALLBACK_OG_IMAGE =
  'https://i.ytimg.com/vi/gfywsN483lI/maxresdefault.jpg';

/**
 * Published, playable songs as the shared public DTO. Goes through the same
 * SongCatalog use case + PublicSong projection that backs GET /api/songs, so
 * the page and the API can never disagree about what a song is.
 */
async function getSongs(): Promise<PublicSongDTO[]> {
  try {
    // Funnel-to-YouTube: while on-site playback is off, hide songs with no
    // YouTube video (nothing to listen to). Same rule as GET /api/songs.
    return listableSongs(await new SongCatalog(new ContentRepository()).listPublished(100));
  } catch (error) {
    console.error('Failed to fetch songs:', error);
    return [];
  }
}

export async function generateMetadata(): Promise<Metadata> {
  // Pick the first song's cover image if any has one set, otherwise fall back
  // to a static thumbnail so share previews are never blank.
  const songs = await getSongs();
  const firstCover = songs.map((s) => s.coverUrl).find((src): src is string => !!src);
  const ogImage = firstCover || FALLBACK_OG_IMAGE;
  return {
    title: META_TITLE,
    description: META_DESCRIPTION,
    alternates: alternatesFor('/songs'),
    openGraph: {
      title: `${META_TITLE} | ${SITE_NAME}`,
      description: META_DESCRIPTION,
      url: '/songs',
      type: 'music.playlist',
      siteName: SITE_NAME,
      images: [{ url: ogImage, width: 1280, height: 720 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${META_TITLE} | ${SITE_NAME}`,
      description: META_DESCRIPTION,
      images: [ogImage],
    },
  };
}

export default async function SongsPage() {
  const songs = await getSongs();
  // Adapt the public DTO to the playlist UI's row shape (presentation only —
  // the domain rules already ran in SongCatalog/PublicSong).
  const tracks: SongRow[] = songs.map((s) => ({
    id: s.id,
    title: s.title,
    artist: s.artist,
    // '' is the documented Track sentinel for "no audio yet" — a YouTube-only
    // song routes to YouTube in SongList rather than to the on-site player.
    src: s.audio?.url ?? '',
    cover: s.coverUrl,
    duration: s.audio?.durationSeconds,
    addedAt: Date.parse(s.publishedAt) || undefined,
    theme: s.theme,
    youtubeVideoId: s.youtubeVideoId,
  }));
  const playableCount = tracks.filter((t) => t.src).length;
  // Crawlable internal links to the SEO theme collection pages (only themes
  // with enough songs to have a page).
  // Unclassified songs contribute to no collection.
  const collectionThemes = eligibleCollectionThemes(
    songs.map((s) => s.theme).filter((t): t is string => !!t)
  );

  const firstCover = tracks.map((t) => t.cover).find((c) => !!c);
  const playlistImage = firstCover || FALLBACK_OG_IMAGE;

  const playlistJsonLd =
    playableCount > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'MusicPlaylist',
          name: JSONLD_NAME,
          description: META_DESCRIPTION,
          url: absoluteUrl('/songs'),
          inLanguage: 'ta',
          image: playlistImage,
          numTracks: playableCount,
          track: tracks
            .filter((t) => t.src)
            .map((t, i) => ({
              '@type': 'MusicRecording',
              position: i + 1,
              name: t.title,
              url: absoluteUrl(`/content/${t.id}`),
              inLanguage: 'ta',
              byArtist: { '@type': 'Person', name: t.artist },
              audio: { '@type': 'AudioObject', contentUrl: t.src },
              ...(t.duration ? { duration: isoDuration(t.duration) } : {}),
            })),
        }
      : null;

  // SERP breadcrumb (முகப்பு › பாடல்கள்) — mirrors the /songs/[theme] crumb
  // convention so the section reads consistently in search results.
  const breadcrumbLd = breadcrumbJsonLd([
    { name: 'முகப்பு', path: '/' },
    { name: 'பாடல்கள்', path: '/songs' },
  ]);

  return (
    <div className="min-h-screen flex flex-col">
      <JsonLd data={breadcrumbLd} />
      {playlistJsonLd && <JsonLd data={playlistJsonLd} />}
      <Header />
      <main id="main" className="flex-1">
        <SongsPlaylist tracks={tracks} />
        {collectionThemes.length > 0 && (
          <nav
            aria-label="Browse Tamil songs by theme"
            className="container mx-auto max-w-6xl px-4 pb-12 sm:px-6"
          >
            <h2 className="mb-3 font-tamil text-sm font-semibold uppercase tracking-wide text-gray-400">
              தலைப்பு வாரியாக · Browse by theme
            </h2>
            <ul className="flex flex-wrap gap-2">
              {collectionThemes.map((t) => (
                <li key={t}>
                  <Link
                    href={`/songs/${t}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:border-orange-500/50 hover:text-orange-400"
                  >
                    <span className="font-tamil">{SONG_COLLECTIONS[t].tamilTitle}</span>
                    <span className="text-gray-500">· {SONG_COLLECTIONS[t].englishTitle}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {/* The stronger contextual CTA. On /songs specifically, because a
            visitor browsing a catalogue of finished songs is the closest this
            site gets to a creator audience — and the mastering pilot needs
            QUALIFIED exposure, not maximum exposure. */}
        <div className="container mx-auto max-w-6xl px-4 pb-12 sm:px-6">
          <StudioCta placement="songs_list" variant="panel" />
        </div>
      </main>
      <Footer />
    </div>
  );
}
